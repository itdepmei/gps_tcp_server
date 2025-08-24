const redis = require("redis");
const { getConnection } = require("../db");
const logger = require("../Logger");
// Remove this line that causes circular dependency:
// const { publishGPSUpdate } = require("./redisPublisher");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const cacheClient = redis.createClient({ url: REDIS_URL });

let isCacheConnected = false;

cacheClient.on("connect", () => {
  console.log("✅ Redis Cache connected successfully");
  isCacheConnected = true;
});

cacheClient.on("error", (err) => {
  console.error("❌ Redis Cache error:", err.message);
  isCacheConnected = false;
});

async function connectCache() {
  try {
    await cacheClient.connect();
  } catch (err) {
    console.error("Failed to connect to Redis Cache:", err.message);
  }
}

connectCache();

const TRUCKS_LIST_CACHE_KEY = "trucks_list_static";
const CACHE_EXPIRY = 1 * 60 * 1000; // 1 minute in milliseconds

async function getTrucksList() {
  try {
    if (isCacheConnected) {
      const cachedList = await cacheClient.get(TRUCKS_LIST_CACHE_KEY);
      if (cachedList) {
        console.log("data from redis cache", cachedList);
        logger.info(`Cache HIT for trucks list`);
        return {
          trucks: JSON.parse(cachedList),
          fromCache: true,
        };
      }
    }

    logger.info(`Cache MISS for trucks list - Fetching from DB`);
    const connection = await getConnection();
    try {
      const [trucksRows] = await connection.query(`
        SELECT 
          gd.id as device_id,
          gd.imei,
          gd.device_name,
          gd.is_active as device_active,
          t.id as truck_id,
          t.type_truk,
          t.color,
          t.plate_number,
          t.status as truck_status,
          u.id as driver_id,
          u.full_name as driver_name,
          u.phone as driver_phone,
          l.id as location_id,
          l.latitude,
          l.longitude,
          l.speed,
          l.direction,
          l.altitude,
          l.satellites,
          l.timestamp
        FROM gps_devices gd
        LEFT JOIN trucks t ON gd.truck_id = t.id
        LEFT JOIN users u ON t.driver_id = u.id
        LEFT JOIN gps_locations l ON gd.id = l.device_id
        WHERE gd.is_active = TRUE
      `);
      // console.log("data  from query", trucksRows);
      if (isCacheConnected) {
        await cacheClient.setEx(
          TRUCKS_LIST_CACHE_KEY,
          CACHE_EXPIRY,
          JSON.stringify(trucksRows)
        );
        logger.info(`Cached trucks list with ${trucksRows.length} trucks`);
      }

      return {
        trucksRows,
        fromCache: false,
      };
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Error getting trucks list: ${error.message}`);
    throw error;
  }
}

async function updateCachedTruckLocation(imei, locationData) {
  if (!isCacheConnected) {
    console.warn("⚠️ Redis not connected, skipping cache update");
    return false;
  }

  try {
    const cachedList = await cacheClient.get(TRUCKS_LIST_CACHE_KEY);
    if (!cachedList) {
      return false;
    }

    const trucks = JSON.parse(cachedList);
    const truckIndex = trucks.findIndex((truck) => truck.imei === imei);

    if (truckIndex === -1) {
      return false;
    }

    trucks[truckIndex].location = {
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      speed: locationData.speed,
      direction: locationData.direction || locationData.angle,
      altitude: locationData.altitude,
      satellites: locationData.satellites,
      updated_at: new Date().toISOString(),
    };

    await cacheClient.setEx(
      TRUCKS_LIST_CACHE_KEY,
      CACHE_EXPIRY,
      JSON.stringify(trucks)
    );

    logger.info(`Updated cache location for truck IMEI: ${imei}`);
    return true;
  } catch (error) {
    logger.error(`Error updating cached truck location: ${error.message}`);
    return false;
  }
}

async function publishLocationUpdate(truckId) {
  try {
    if (isCacheConnected) {
      const cachedList = await cacheClient.get(TRUCKS_LIST_CACHE_KEY);

      if (cachedList) {
        const trucks = JSON.parse(cachedList);

        // نحدد الشاحنة المطلوبة
        const truck = trucks.find((t) => t.truck.id === truckId);
        if (truck) {
          await publishGPSUpdate(JSON.stringify(truck));
          logger.info(`✅ Published location update for truck ID: ${truckId}`);
          return truck;
        } else {
          logger.warn(`⚠️ Truck ID ${truckId} not found in cache`);
        }
      }
    }
  } catch (error) {
    logger.error(`❌ Error publishing location update: ${error.message}`);
    throw error;
  }
}

async function clearTrucksListCache() {
  if (!isCacheConnected) return;
  try {
    await cacheClient.del(TRUCKS_LIST_CACHE_KEY);
    logger.info(`Cleared trucks list cache`);
  } catch (error) {
    logger.error(`Error clearing trucks list cache: ${error.message}`);
  }
}

module.exports = {
  getTrucksList,
  updateCachedTruckLocation,
  publishLocationUpdate,
  clearTrucksListCache,
};
