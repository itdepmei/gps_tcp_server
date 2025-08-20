// server.js - خادم استقبال بيانات GPS
const express = require('express');
const net = require('net');
const socketIo = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// TCP Server لاستقبال بيانات GPS
const gpsServer = net.createServer((socket) => {
    console.log('GPS Device connected:', socket.remoteAddress);

    socket.on('data', async (data) => {
        console.log('GPS Data received:', data);
        try {
            const parsedData = parseGT06Protocol(data);

            if (parsedData) {
                console.log('Parsed Data:', parsedData);
                const location = new Location({
                    deviceId: parsedData.deviceId,
                    latitude: parsedData.latitude,
                    longitude: parsedData.longitude,
                    speed: parsedData.speed,
                    direction: parsedData.direction,
                    engineStatus: parsedData.engineStatus,
                    geoJson: {
                        type: 'Point',
                        coordinates: [parsedData.longitude, parsedData.latitude]
                    }
                });

                await location.save();

                // إرسال الموقع إلى العملاء عبر Socket.io
                io.emit('locationUpdate', {
                    deviceId: parsedData.deviceId,
                    latitude: parsedData.latitude,
                    longitude: parsedData.longitude,
                    speed: parsedData.speed,
                    timestamp: new Date()
                });

                // رد على الجهاز (مثال بسيط)
                socket.write(Buffer.from([0x78, 0x78, 0x05, 0x01, 0x00, 0x01, 0xD9, 0xDC, 0x0D, 0x0A]));
            }
        } catch (error) {
            console.error('Error processing GPS data:', error);
        }
    });

    socket.on('end', () => {
        console.log('GPS Device disconnected');
    });
});

// دالة فك تشفير بروتوكول GT06
function parseGT06Protocol(buffer) {
    if (buffer.length < 24) return null;

    const latitude = buffer.readUInt32BE(11) / 1800000;
    const longitude = buffer.readUInt32BE(15) / 1800000;
    const speed = buffer.readUInt8(19);

    return {
        deviceId: buffer.readUInt16BE(5).toString(),
        latitude: latitude,
        longitude: longitude,
        speed: speed,
        direction: buffer.readUInt16BE(21),
        engineStatus: (buffer.readUInt8(23) & 0x01) === 1
    };
}

// تشغيل خادم الـ TCP
gpsServer.listen(8080, () => {
    console.log('GPS Server listening on port 8080');
});

