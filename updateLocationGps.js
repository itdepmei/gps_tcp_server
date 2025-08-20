const { getConnection } = require("./db");
const logger = require("./Logger");

// Function to insert or update GPS location data
async function updateLocationGps(gpsData) {
  if (!gpsData || !Array.isArray(gpsData) || gpsData.length === 0) {
    console.log("No GPS data to update");
    return;
  }
  const connection = await getConnection();
  try {
    // Start transaction for data consistency
    await connection.beginTransaction();

    // Process each IMEI group
    for (const record of gpsData) {
      console.log(
        `Processing IMEI: ${record.imei} with ${record.length} records`
      );

      // 1. Check if device exists in gps_devices table
      const [deviceRows] = await connection.query(
        "SELECT id, imei, device_name FROM gps_devices WHERE imei = ?",
        [record.imei]
      );

      if (deviceRows.length === 0) {
        console.log(
          `Device with IMEI ${record.imei} not found in gps_devices table. Skipping...`
        );
        logger.warn(
          `Device with IMEI ${record.imei} not found in gps_devices table`
        );
        continue;
      }
      const device = deviceRows[0];
      const deviceId = device.id;
      console.log(`Found device: ID=${deviceId}, Name=${device.device_name}`);
      // 2. Update gps_devices table with latest GPS data
      const updateDeviceQuery = `
        UPDATE gps_location 
        SET 
          latitude = ?,
          longitude = ?,
          speed = ?,
          direction = ?,
          altitude = ?,
          satellites = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE device_id = ?
      `;

      const deviceUpdateValues = [
        record.latitude || 0,
        record.longitude || 0,
        record.speed || 0,
        record.direction || 0,
        record.altitude || 0,
        record.satellites || 0,
        deviceId,
      ];

      await connection.query(updateDeviceQuery, deviceUpdateValues);
      console.log(`Updated gps_devices table for device ID: ${deviceId}`);

      logger.info(
        `Device ${record.imei} (ID: ${deviceId}) - Updated device table and inserted ${insertedCount} location records. Latest position: Lat=${latestRecord.latitude}, Lng=${latestRecord.longitude}, Speed=${latestRecord.speed}`
      );
    }
    // Commit transaction
    await connection.commit();
    const totalRecords = gpsData.length;
    console.log(`Successfully processed ${totalRecords} GPS records`);
    logger.info(
      `Successfully processed ${totalRecords} GPS records across ${
        Object.keys(dataByImei).length
      } devices`
    );
  } catch (error) {
    // Rollback transaction on error
    await connection.rollback();
    logger.error("Error updating GPS location data: " + error.message);
    console.error("Error updating GPS location data:", error);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  updateLocationGps,
};
