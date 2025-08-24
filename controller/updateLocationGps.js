const { getConnection } = require("../db");
const logger = require("../Logger");
const {
  updateCachedTruckLocation,
} = require("./vehicleCache");

// Function to update GPS location data only (no insert or table creation)
async function updateLocationGps(gpsData) {
  console.log("updateLocationGps", gpsData);
  if (!gpsData || !Array.isArray(gpsData) || gpsData.length === 0) {
    console.log("No GPS data to update");
    return;
  }

  const connection = await getConnection();
  try {
    // Start transaction for data consistency
    await connection.beginTransaction();

    // Process each GPS record
    console.log(
      "=========================start gps update ====================================="
    );
    console.log("gps data ", gpsData);
    for (const record of gpsData) {
      console.log(`Processing IMEI --------->: ${record}`);

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
      console.log("gpsData", gpsData);
      console.log(`Found device: ID=${deviceId}, Name=${device.device_name}`);
      // 2. Update gps_location table with latest GPS data
      const updateLocationQuery = `
                UPDATE gps_locations 
                SET 
                    latitude = ?,
                    longitude = ?,
                    speed = ?,
                    direction = ?,
                    altitude = ?,
                    satellites = ?,
                    timestamp = CURRENT_TIMESTAMP
                WHERE device_id = ?
            `;

      const locationUpdateValues = [
        record.latitude || 0,
        record.longitude || 0,
        record.speed || 0,
        record.angle || 0, // Fixed: using record.angle instead of record.direction
        record.altitude || 0,
        record.satellites || 0,
        deviceId,
      ];

      const [updateResult] = await connection.query(
        updateLocationQuery,
        locationUpdateValues
      );
      await updateCachedTruckLocation(record.imei, record);
      // await publishLocationUpdate(truckData, record);
      // تحديث الكاش
      if (updateResult.affectedRows > 0) {
        console.log(`Updated gps_location table for device ID: ${deviceId}`);
        logger.info(
          `Device ${record.imei} (ID: ${deviceId}) - Updated location: Lat=${record.latitude}, Lng=${record.longitude}, Speed=${record.speed}`
        );
      } else {
        console.log(
          `No location record found to update for device ID: ${deviceId}`
        );
        logger.warn(
          `No location record found to update for device ID: ${deviceId}`
        );
      }
    }

    // Commit transaction
    await connection.commit();
    const totalRecords = gpsData.length;
    console.log(`Successfully processed ${totalRecords} GPS records`);
    logger.info(`Successfully processed ${totalRecords} GPS records`);
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
