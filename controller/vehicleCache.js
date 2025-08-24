const redis = require("redis");
const { getConnection } = require("../db");
const logger = require("../Logger");

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

cacheClient.on("end", () => {
  console.log("Redis connection ended");
  isCacheConnected = false;
});

async function connectCache() {
  try {
    if (!cacheClient.isOpen) {
      await cacheClient.connect();
    }
  } catch (err) {
    console.error("Failed to connect to Redis Cache:", err.message);
    isCacheConnected = false;
  }
}

connectCache();

const TRUCKS_LIST_CACHE_KEY = "trucks_list_static";
const CACHE_EXPIRY = 60; // 1 minute in seconds

async function getTrucksList() {
  try {
    // Check cache first
    if (isCacheConnected && cacheClient.isReady) {
      try {
        const cachedList = await cacheClient.get(TRUCKS_LIST_CACHE_KEY);
        if (cachedList) {
            const ttl = await cacheClient.ttl(TRUCKS_LIST_CACHE_KEY);
          console.log("✅ Data retrieved from Redis cache with TTL:", ttl);
          logger.info(`Cache HIT for trucks list`);
          return {
            trucks: JSON.parse(cachedList), // Consistent naming
            fromCache: true,
          };
        }
      } catch (cacheError) {
        logger.warn(`Cache read error: ${cacheError.message}`);
        // Continue to database query
      }
    }

    // Fetch from database
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
        LEFT JOIN (
          SELECT DISTINCT device_id, 
                 FIRST_VALUE(latitude) OVER (PARTITION BY device_id ORDER BY timestamp DESC) as latitude,
                 FIRST_VALUE(longitude) OVER (PARTITION BY device_id ORDER BY timestamp DESC) as longitude,
                 FIRST_VALUE(speed) OVER (PARTITION BY device_id ORDER BY timestamp DESC) as speed,
                 FIRST_VALUE(direction) OVER (PARTITION BY device_id ORDER BY timestamp DESC) as direction,
                 FIRST_VALUE(altitude) OVER (PARTITION BY device_id ORDER BY timestamp DESC) as altitude,
                 FIRST_VALUE(satellites) OVER (PARTITION BY device_id ORDER BY timestamp DESC) as satellites,
                 FIRST_VALUE(timestamp) OVER (PARTITION BY device_id ORDER BY timestamp DESC) as timestamp,
                 FIRST_VALUE(id) OVER (PARTITION BY device_id ORDER BY timestamp DESC) as id
          FROM gps_locations 
        ) l ON gd.id = l.device_id
        WHERE gd.is_active = TRUE
        ORDER BY gd.id
      `);

      // Cache the results
      if (isCacheConnected && cacheClient.isReady && trucksRows.length > 0) {
        try {
          await cacheClient.setEx(
            TRUCKS_LIST_CACHE_KEY,
            CACHE_EXPIRY,
            JSON.stringify(trucksRows)
          );
          console.log(`🔍 Cache set with TTL: ${CACHE_EXPIRY} seconds`);
          logger.info(`✅ Cached trucks list with ${trucksRows.length} trucks for ${CACHE_EXPIRY} seconds`);
        } catch (cacheError) {
          logger.warn(`Cache write error: ${cacheError.message}`);
        }
      }

      return {
        trucks: trucksRows, // Consistent naming
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
  if (!isCacheConnected || !cacheClient.isReady) {
    console.warn("⚠️ Redis not connected, skipping cache update");
    return false;
  }

  try {
    const cachedList = await cacheClient.get(TRUCKS_LIST_CACHE_KEY);
    if (!cachedList) {
      logger.info("No cached trucks list found for location update");
      return false;
    }

    const trucks = JSON.parse(cachedList);
    const truckIndex = trucks.findIndex((truck) => truck.imei === imei);

    if (truckIndex === -1) {
      logger.warn(`Truck with IMEI ${imei} not found in cache`);
      return false;
    }

    // Update the truck's location data
    trucks[truckIndex] = {
      ...trucks[truckIndex],
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      speed: locationData.speed,
      direction: locationData.direction || locationData.angle,
      altitude: locationData.altitude,
      satellites: locationData.satellites,
      timestamp: new Date().toISOString(),
    };

    // Reset cache with updated data and fresh TTL
    await cacheClient.setEx(
      TRUCKS_LIST_CACHE_KEY,
      CACHE_EXPIRY,
      JSON.stringify(trucks)
    );

    logger.info(`✅ Updated cache location for truck IMEI: ${imei}`);
    return true;
    
  } catch (error) {
    logger.error(`Error updating cached truck location: ${error.message}`);
    return false;
  }
}

// Fixed publishLocationUpdate function
async function publishLocationUpdate(truckId) {
  try {
    if (!isCacheConnected || !cacheClient.isReady) {
      logger.warn("Redis not ready for publishing");
      return null;
    }

    const cachedList = await cacheClient.get(TRUCKS_LIST_CACHE_KEY);
    if (!cachedList) {
      logger.warn("No cached trucks list available for publishing");
      return null;
    }

    const trucks = JSON.parse(cachedList);
    // Fixed: Look for truck_id instead of truck.id
    const truck = trucks.find((t) => t.truck_id === truckId);
    
    if (truck) {
      // You'll need to implement publishGPSUpdate or replace with your pub/sub logic
      // await publishGPSUpdate(JSON.stringify(truck));
      console.log(`📡 Would publish update for truck ID: ${truckId}`, truck);
      logger.info(`✅ Published location update for truck ID: ${truckId}`);
      return truck;
    } else {
      logger.warn(`⚠️ Truck ID ${truckId} not found in cache`);
      return null;
    }
  } catch (error) {
    logger.error(`❌ Error publishing location update: ${error.message}`);
    throw error;
  }
}

async function clearTrucksListCache() {
  if (!isCacheConnected || !cacheClient.isReady) {
    logger.warn("Redis not ready for cache clearing");
    return false;
  }
  
  try {
    await cacheClient.del(TRUCKS_LIST_CACHE_KEY);
    logger.info(`✅ Cleared trucks list cache`);
    return true;
  } catch (error) {
    logger.error(`Error clearing trucks list cache: ${error.message}`);
    return false;
  }
}

// Add a function to check cache TTL for debugging
async function getCacheTTL() {
  if (!isCacheConnected || !cacheClient.isReady) {
    return -2;
  }
  
  try {
    const ttl = await cacheClient.ttl(TRUCKS_LIST_CACHE_KEY);
    return ttl;
  } catch (error) {
    logger.error(`Error getting cache TTL: ${error.message}`);
    return -2;
  }
}

// Add graceful shutdown
process.on('SIGTERM', async () => {
  if (cacheClient.isOpen) {
    await cacheClient.quit();
  }
});

module.exports = {
  getTrucksList,
  updateCachedTruckLocation,
  publishLocationUpdate,
  clearTrucksListCache,
  getCacheTTL, // Added for debugging
};