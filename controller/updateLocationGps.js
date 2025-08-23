const { getConnection } = require("../db");
const logger = require("../Logger");
const {
  getTruckByImei,
  updateCachedTruckLocation,
  publishLocationUpdate,
} = require("./vehicleCache");

// Function to update GPS location data only
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
    for (const record of gpsData) {
      console.log(`Processing IMEI: ${record.imei}`);

      // جلب بيانات الشاحنة من Cache (البيانات الثابتة)
      const truckData = await getTruckByImei(record.imei);

      if (!truckData) {
        console.log(`Truck with IMEI ${record.imei} not found. Skipping...`);
        logger.warn(`Truck with IMEI ${record.imei} not found`);
        continue;
      }

      const deviceId = truckData.device_id;
      console.log(
        `Found truck: Device ID=${deviceId}, Plate=${truckData.truck.plate_number}`
      );

      // تحديث موقع GPS فقط في جدول gps_location
      const updateLocationQuery = `
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

      const locationUpdateValues = [
        record.latitude || 0,
        record.longitude || 0,
        record.speed || 0,
        record.angle || 0,
        record.altitude || 0,
        record.satellites || 0,
        deviceId,
      ];

      const [updateResult] = await connection.query(
        updateLocationQuery,
        locationUpdateValues
      );

      if (updateResult.affectedRows > 0) {
        console.log(`✅ Updated GPS location for device ID: ${deviceId}`);
        logger.info(
          `Truck ${record.imei} (${
            truckData.truck.plate_number
          }) - Updated location: Lat=${record.latitude}, Lng=${
            record.longitude
          }, Speed=${record.speed} [Cache: ${
            truckData.fromCache ? "HIT" : "MISS"
          }]`
        );
        await publishLocationUpdate(truckData, record);
        // تحديث الكاش
        await updateCachedTruckLocation(record.imei, record);
      } else {
        console.log(
          `⚠️ No location record found to update for device ID: ${deviceId}`
        );
        logger.warn(
          `No location record found to update for device ID: ${deviceId}`
        );
      }
    }

    // Commit transaction
    await connection.commit();
    const totalRecords = gpsData.length;
    console.log(`✅ Successfully processed ${totalRecords} GPS records`);
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
