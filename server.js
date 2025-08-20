const net = require("net");
const { ProtocolParser, parseIMEI } = require("complete-teltonika-parser");
const { mainConnection } = require("./db");
const { updateLocationGps } = require("./updateLocationGps");

// Array to store organized GPS data
let gpsDataStore = [];
// Map to store IMEI for each socket connection
const socketIMEIMap = new Map();

// Initialize database connection and create table
async function initializeServer() {
  await mainConnection();
}

initializeServer();

// Function to organize GPS data into clean objects
function organizeGPSData(records, deviceIMEI) {
  const organizedData = records.map((record) => {
    return {
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
    };
  });

  gpsDataStore.push(...organizedData);

  if (gpsDataStore.length > 1000) {
    gpsDataStore = gpsDataStore.slice(-1000);
  }

  // Save to database
  console.log(
    " =============================== start update Location GPS data to database..."
  );
  updateLocationGps(organizedData).catch((error) => {
    console.error("Failed to update Location GPS data to database:", error);
  });

  console.log(
    " =============================== end update Location GPS data to database..."
  );

  return organizedData;
}

// Enhanced IMEI parsing function
function parseIMEIFromPacket(buffer) {
  try {
    console.log("=== IMEI Parsing Debug ===");
    // console.log('Buffer length:', buffer.length);
    // console.log('Buffer hex:', buffer.toString('hex'));

    // Method 1: Use the library parser
    const hexPacket = buffer.toString("hex");
    let imei = parseIMEI(hexPacket);
    console.log("Library parsed IMEI:", imei);

    // Method 2: Manual parsing (alternative approach)
    if (!imei && buffer.length >= 15) {
      // Skip first 2 bytes (length) and extract next 15 bytes as IMEI
      const imeiBytes = buffer.slice(2, 17);
      const manualIMEI = imeiBytes.toString("ascii").replace(/\0/g, "");
      console.log("Manual IMEI extraction:", manualIMEI);

      // Validate IMEI format (15 digits)
      if (/^\d{15}$/.test(manualIMEI)) {
        imei = manualIMEI;
        console.log("Using manually extracted IMEI:", imei);
      }
    }

    // Method 3: Try different starting positions
    if (!imei && buffer.length >= 15) {
      for (let start = 0; start <= buffer.length - 15; start++) {
        const testBytes = buffer.slice(start, start + 15);
        const testIMEI = testBytes.toString("ascii").replace(/\0/g, "");
        if (/^\d{15}$/.test(testIMEI)) {
          console.log(`Found IMEI at position ${start}:`, testIMEI);
          imei = testIMEI;
          break;
        }
      }
    }

    console.log("Final extracted IMEI:", imei);
    return imei;
  } catch (error) {
    console.error("IMEI parsing error:", error);
    return null;
  }
}

const server = net.createServer((socket) => {
  console.log("GPS device connected:", socket.remoteAddress);
  console.log("Connection time:", new Date().toISOString());

  let buffer = Buffer.alloc(0);
  const socketId = `${socket.remoteAddress}:${socket.remotePort}`;

  socket.on("data", (data) => {
    console.log("\n--- New Data Received ---");
    // console.log('Socket ID:', socketId);
    // console.log('Received at:', new Date().toISOString());
    // console.log('Raw Hex:', data.toString('hex'));
    // console.log('Data length:', data.length);

    buffer = Buffer.concat([buffer, data]);
    processBuffer();
  });

  function processBuffer() {
    while (buffer.length > 0) {
      try {
        const hexPacket = buffer.toString("hex");

        // Handle single byte packets (keepalive)
        if (buffer.length === 1) {
          console.log(
            "Received single byte packet (likely keepalive):",
            hexPacket
          );
          buffer = Buffer.alloc(0);
          return;
        }

        // Handle IMEI packet detection - try multiple approaches
        if (buffer.length >= 15 && !socketIMEIMap.has(socketId)) {
          console.log("\n=== IMEI Packet Detection ===");

          // Check if it's a 15-byte IMEI packet
          if (buffer.length === 15) {
            console.log("Detected 15-byte packet - likely IMEI");
            const deviceIMEI = parseIMEIFromPacket(buffer);

            if (deviceIMEI) {
              socketIMEIMap.set(socketId, deviceIMEI);
              console.log(`Device IMEI: ${deviceIMEI} has connected.`);

              socket.write(Buffer.from([0x01]));
              console.log("Sent IMEI acknowledgment (0x01) to device.");
            } else {
              console.log("Failed to parse IMEI from 15-byte packet");
            }

            buffer = Buffer.alloc(0);
            return;
          }

          // Check if IMEI is embedded in a longer packet
          else if (buffer.length > 15) {
            console.log("Checking for IMEI in longer packet...");

            // Look for IMEI at the beginning after length bytes
            if (buffer.length >= 17) {
              const lengthField = buffer.readUInt16BE(0);
              console.log("Length field:", lengthField);

              if (lengthField === 15 && buffer.length >= 17) {
                const imeiBuffer = buffer.slice(2, 17);
                const deviceIMEI = parseIMEIFromPacket(imeiBuffer);

                if (deviceIMEI) {
                  socketIMEIMap.set(socketId, deviceIMEI);
                  console.log(`Device IMEI extracted: ${deviceIMEI}`);

                  socket.write(Buffer.from([0x01]));
                  console.log("Sent IMEI acknowledgment (0x01) to device.");

                  buffer = buffer.slice(17); // Remove IMEI packet
                  continue;
                }
              }
            }
          }
        }

        // Get the IMEI for this socket
        const currentIMEI = socketIMEIMap.get(socketId);
        console.log("Current socket IMEI:", currentIMEI);

        // For data packets, check if it starts with zeros (Teltonika format)
        if (buffer.length < 8) {
          console.log("Waiting for more data (packet too short)...");
          return;
        }

        // Look for the correct packet structure
        let packetStart = -1;
        for (let i = 0; i <= buffer.length - 8; i++) {
          if (
            buffer[i] === 0x00 &&
            buffer[i + 1] === 0x00 &&
            buffer[i + 2] === 0x00 &&
            buffer[i + 3] === 0x00
          ) {
            const dataLength = buffer.readUInt32BE(i + 4);
            if (dataLength > 8 && dataLength < 10000) {
              packetStart = i;
              break;
            }
          }
        }

        if (packetStart === -1) {
          console.log("No valid packet header found, waiting for more data...");
          return;
        }

        if (packetStart > 0) {
          console.log(
            `Removing ${packetStart} garbage bytes before valid packet`
          );
          buffer = buffer.slice(packetStart);
        }

        const preamble = buffer.readUInt32BE(0);
        const dataLength = buffer.readUInt32BE(4);
        const totalPacketLength = 8 + dataLength + 4;

        console.log(`Preamble: 0x${preamble.toString(16).padStart(8, "0")}`);
        console.log(`Data Length: ${dataLength}`);
        console.log(`Expected total packet length: ${totalPacketLength}`);
        console.log(`Current buffer length: ${buffer.length}`);

        if (buffer.length < totalPacketLength) {
          console.log("Waiting for more data to complete packet...");
          return;
        }

        const completePacket = buffer.slice(0, totalPacketLength);
        const completeHexPacket = completePacket.toString("hex");

        console.log("=== Parsing Complete GPS Data Packet ===");
        console.log("Using IMEI:", currentIMEI || "NULL - IMEI NOT SET!");

        const parser = new ProtocolParser(completeHexPacket);

        console.log("Codec Type:", parser.CodecType);
        console.log("Codec ID:", parser.CodecID);

        if (parser.CodecType === "data sending" && parser.Content) {
          const data = parser.Content;
          console.log(`Number of records: ${data.AVL_Datas.length}`);

          // Use the IMEI from the socket map
          const organizedRecords = organizeGPSData(data.AVL_Datas, currentIMEI);

          console.log("\n=== ORGANIZED GPS DATA ===");
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

          const numRecords = data.AVL_Datas.length;
          const response = Buffer.alloc(4);
          response.writeUInt32BE(numRecords, 0);
          socket.write(response);
          console.log(`Sent acknowledgment for ${numRecords} records.`);
        } else if (parser.CodecType === "GPRS messages") {
          console.log("GPRS Message received:", parser.Content);
        }

        buffer = buffer.slice(totalPacketLength);
      } catch (error) {
        console.error("Error parsing data:", error.message);
        console.error(
          "Current socket IMEI:",
          socketIMEIMap.get(socketId) || "NOT SET"
        );

        let nextValidStart = -1;
        for (let i = 1; i < buffer.length - 4; i++) {
          if (
            buffer[i] === 0x00 &&
            buffer[i + 1] === 0x00 &&
            buffer[i + 2] === 0x00 &&
            buffer[i + 3] === 0x00
          ) {
            nextValidStart = i;
            break;
          }
        }

        if (nextValidStart > 0) {
          buffer = buffer.slice(nextValidStart);
        } else {
          buffer = Buffer.alloc(0);
        }
        return;
      }
    }
  }

  socket.on("close", () => {
    console.log("Device disconnected at:", new Date().toISOString());
    const imei = socketIMEIMap.get(socketId);
    if (imei) {
      console.log(`Device ${imei} disconnected`);
      socketIMEIMap.delete(socketId);
    }
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
    socketIMEIMap.delete(socketId);
  });
});

// Rest of your functions remain the same...
gpsDataStore;

gpsDataStore.filter((record) => record.imei === imei);

const latestPositions = {};
gpsDataStore.forEach((record) => {
  if (
    !latestPositions[record.imei] ||
    new Date(record.timestamp) >
      new Date(latestPositions[record.imei].timestamp)
  ) {
    latestPositions[record.imei] = record;
  }
});
Object.values(latestPositions);

const PORT = 8080;
const HOST = "0.0.0.0";
// const HOST = "82.112.227.155";

server.listen(PORT, HOST, () => {
  console.log(`GPS server listening on ${HOST}:${PORT}`);
  console.log("Server started at:", new Date().toISOString());
  console.log("\n=== Available Functions ===");
  console.log("- getAllGPSData(): Get all stored GPS records");
  console.log("- getGPSDataByIMEI(imei): Get records for specific device");
  console.log("- getLatestPositions(): Get latest position for each device");
});
