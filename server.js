const net = require("net");
const { ProtocolParser, parseIMEI } = require("complete-teltonika-parser");
const { mainConnection } = require("./db");
const { updateLocationGps } = require("./updateLocationGps");

// Redis publisher مع error handling
let publishGPSUpdate;
try {
  const redisPublisher = require("./redisPublisher");
  publishGPSUpdate = redisPublisher.publishGPSUpdate;
  console.log('✅ Redis publisher loaded successfully');
} catch (err) {
  console.warn('⚠️ Redis publisher not available:', err.message);
  publishGPSUpdate = (data) => {
    console.log('📍 GPS data received (Redis disabled):', data.imei);
  };
}

let gpsDataStore = [];
const socketIMEIMap = new Map();

async function initializeServer() {
  await mainConnection();
}
initializeServer();

// Organize and save GPS data
function organizeGPSData(records, deviceIMEI) {
  const organizedData = records.map((record) => ({
    imei: deviceIMEI,
    timestamp: record.Timestamp,
    latitude: record.GPSelement.Latitude,
    longitude: record.GPSelement.Longitude,
    altitude: record.GPSelement.Altitude,
    speed: record.GPSelement.Speed,
    angle: record.GPSelement.Angle,
    satellites: record.GPSelement.Satellites,
    priority: record.Priority,
    ioElements: record.IOelement.Elements,
    receivedAt: new Date().toISOString(),
  }));

  gpsDataStore.push(...organizedData);
  if (gpsDataStore.length > 1000) {
    gpsDataStore = gpsDataStore.slice(-1000);
  }

  console.log("=== start update Location GPS data to database...");
  updateLocationGps(organizedData).catch((err) =>
    console.error("Failed to update GPS data:", err)
  );
  console.log("=== end update Location GPS data to database...");

  // ✅ انشر آخر تحديث لـ Redis (مع error handling)
  organizedData.forEach((record) => {
    try {
      publishGPSUpdate(record);
    } catch (err) {
      console.error('Error publishing to Redis:', err.message);
    }
  });

  return organizedData;
}

// IMEI parsing (defensive)
function parseIMEIFromPacket(buffer) {
  try {
    console.log("=== IMEI Parsing Debug ===");
    console.log("Buffer length:", buffer.length);
    console.log("Buffer hex:", buffer.toString("hex"));

    let imei;
    const hexPacket = buffer.toString("hex");
    imei = parseIMEI(hexPacket);
    console.log("Library parsed IMEI:", imei);

    // Teltonika IMEI with length prefix
    if (!imei && buffer.length >= 17) {
      const lengthField = buffer.readUInt16BE(0);
      console.log("Length field:", lengthField);

      if (lengthField === 15) {
        const imeiBytes = buffer.slice(2, 17);
        const manualIMEI = imeiBytes.toString("ascii").replace(/\0/g, "");
        if (/^\d{15}$/.test(manualIMEI)) {
          imei = manualIMEI;
          console.log("Manual IMEI (length prefix):", imei);
        }
      }
    }

    // Direct 15-byte IMEI
    if (!imei && buffer.length === 15) {
      const directIMEI = buffer.toString("ascii").replace(/\0/g, "");
      if (/^\d{15}$/.test(directIMEI)) {
        imei = directIMEI;
        console.log("Direct IMEI:", imei);
      }
    }

    // Brute-force search
    if (!imei && buffer.length >= 15) {
      for (let start = 0; start <= buffer.length - 15; start++) {
        const testBytes = buffer.slice(start, start + 15);
        const testIMEI = testBytes
          .toString("ascii")
          .replace(/\0/g, "")
          .replace(/[^\d]/g, "");
        if (/^\d{15}$/.test(testIMEI)) {
          imei = testIMEI;
          console.log(`Found IMEI at pos ${start}: ${imei}`);
          break;
        }
      }
    }

    // Hex-to-ASCII search
    if (!imei) {
      const hexString = buffer.toString("hex");
      for (let i = 0; i <= hexString.length - 30; i += 2) {
        const testHex = hexString.substr(i, 30);
        const testAscii = Buffer.from(testHex, "hex")
          .toString("ascii")
          .replace(/[^\d]/g, "");
        if (/^\d{15}$/.test(testAscii)) {
          imei = testAscii;
          console.log(`IMEI found in hex at ${i / 2}: ${imei}`);
          break;
        }
      }
    }

    console.log("Final extracted IMEI:", imei);
    return imei;
  } catch (err) {
    console.error("IMEI parsing error:", err);
    return null;
  }
}

const server = net.createServer((socket) => {
  console.log("GPS device connected:", socket.remoteAddress);

  let buffer = Buffer.alloc(0);
  const socketId = `${socket.remoteAddress}:${socket.remotePort}`;

  socket.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    processBuffer();
  });

  function processBuffer() {
    while (buffer.length > 0) {
      try {
        // Handle IMEI (first packet)
        if (!socketIMEIMap.has(socketId)) {
          if (buffer.length >= 17) {
            const lengthField = buffer.readUInt16BE(0);
            if (lengthField === 15) {
              const imeiBuffer = buffer.slice(0, 2 + 15);
              const deviceIMEI = parseIMEIFromPacket(imeiBuffer);
              if (deviceIMEI) {
                socketIMEIMap.set(socketId, deviceIMEI);
                console.log(`Device IMEI: ${deviceIMEI} connected.`);
                socket.write(Buffer.from([0x01]));
                buffer = buffer.slice(2 + 15); // ✅ correct slice
                continue;
              }
            }
          }
          if (buffer.length === 15) {
            const deviceIMEI = parseIMEIFromPacket(buffer);
            if (deviceIMEI) {
              socketIMEIMap.set(socketId, deviceIMEI);
              console.log(`Device IMEI: ${deviceIMEI} connected.`);
              socket.write(Buffer.from([0x01]));
            }
            buffer = Buffer.alloc(0);
            return;
          }
        }

        const currentIMEI = socketIMEIMap.get(socketId);

        // Look for AVL packet
        if (buffer.length < 8) return;

        if (
          buffer[0] === 0x00 &&
          buffer[1] === 0x00 &&
          buffer[2] === 0x00 &&
          buffer[3] === 0x00
        ) {
          const dataLength = buffer.readUInt32BE(4);
          const totalPacketLength = 8 + dataLength + 4;
          if (buffer.length < totalPacketLength) return;

          const completePacket = buffer.slice(0, totalPacketLength);
          const parser = new ProtocolParser(completePacket.toString("hex"));

          if (parser.CodecType === "data sending" && parser.Content) {
            const organizedRecords = organizeGPSData(
              parser.Content.AVL_Datas,
              currentIMEI
            );
            organizedRecords.forEach((record, index) => {
              console.log(`\n--- Record ${index + 1} ---`);
              console.log("IMEI:", record.imei || "NULL - CHECK IMEI PARSING!");
              console.log("Latitude:", record.latitude);
              console.log("Longitude:", record.longitude);
              console.log("Speed:", record.speed);
              console.log("Timestamp:", record.timestamp);
              console.log("Angle:", record.angle);
              console.log("Satellites:", record.satellites);
              console.log("Altitude:", record.altitude);
              console.log("Priority:", record.priority);
              console.log("IO Elements:", record.ioElements);
              console.log("Received At:", record.receivedAt);
              console.log("---");
            });
            const response = Buffer.alloc(4);
            response.writeUInt32BE(parser.Content.AVL_Datas.length, 0);
            socket.write(response);
            console.log(
              `Sent ack for ${parser.Content.AVL_Datas.length} records`
            );
          }

          buffer = buffer.slice(totalPacketLength);
        } else {
          console.log("No valid packet header, discarding...");
          buffer = Buffer.alloc(0);
        }
      } catch (err) {
        console.error("Error parsing data:", err.message);
        buffer = Buffer.alloc(0);
      }
    }
  }

  socket.on("close", () => {
    const imei = socketIMEIMap.get(socketId);
    console.log(`Device ${imei || "unknown"} disconnected`);
    socketIMEIMap.delete(socketId);
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
    socketIMEIMap.delete(socketId);
  });
});

// Helper functions
function getAllGPSData() {
  return gpsDataStore;
}
function getGPSDataByIMEI(imei) {
  return gpsDataStore.filter((r) => r.imei === imei);
}
function getLatestPositions() {
  const latest = {};
  gpsDataStore.forEach((r) => {
    if (
      !latest[r.imei] ||
      new Date(r.timestamp) > new Date(latest[r.imei].timestamp)
    ) {
      latest[r.imei] = r;
    }
  });
  return Object.values(latest);
}

const PORT = 8080;
const HOST = "127.0.0.1";

// const HOST = "82.112.227.155";
server.listen(PORT, HOST, () => {
  console.log(`GPS server listening on ${HOST}:${PORT}`);
});

module.exports = { getAllGPSData, getGPSDataByIMEI, getLatestPositions };
