const redis = require("redis");
const { getTrucksList } = require("./vehicleCache");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const publisher = redis.createClient({
  url: REDIS_URL,
  retry_strategy: (options) => {
    if (options.error && options.error.code === "ECONNREFUSED") {
      console.error("❌ Redis server is not running!");
      return new Error("Redis server is not running");
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error("Retry time exhausted");
    }
    if (options.attempt > 10) {
      return undefined;
    }
    return Math.min(options.attempt * 100, 3000);
  },
});

let isConnected = false;

publisher.on("connect", () => {
  console.log("✅ Redis publisher connected successfully");
  isConnected = true;
});

publisher.on("error", (err) => {
  console.error("❌ Redis connection error:", err.message);
  isConnected = false;
});

publisher.on("end", () => {
  console.log("📡 Redis connection ended");
  isConnected = false;
});

publisher.on("reconnecting", () => {
  console.log("🔄 Redis reconnecting...");
});

async function connectWithRetry() {
  try {
    await publisher.connect();
  } catch (err) {
    console.error("Failed to connect to Redis:", err.message);
    setTimeout(connectWithRetry, 5000);
  }
}

connectWithRetry();

const CHANNELS = {
  GPS_UPDATES: "gps_updates",
  TRUCK_LOCATION: "truck_location_updates",
  SYSTEM_ALERTS: "system_alerts",
};

async function publishGPSUpdate() {
  if (!isConnected) {
    console.warn("⚠️ Redis not connected, skipping GPS update publish");
    return false;
  }
  const { trucks } = await getTrucksList();
  console.log("trucks", trucks);
  try {
    const updatePayload = {
      type: "gps_update",
      timestamp: new Date().toISOString(),
      data: trucks,
    };
    await publisher.publish(
      CHANNELS.GPS_UPDATES,
      JSON.stringify(updatePayload)
    );
    return true;
  } catch (err) {
    console.error("❌ Redis publish error:", err.message);
    return false;
  }
}

process.on("SIGINT", async () => {
  console.log("🛑 Shutting down Redis publisher...");
  if (isConnected) {
    await publisher.quit();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🛑 Received SIGTERM, shutting down Redis publisher...");
  if (isConnected) {
    await publisher.quit();
  }
  process.exit(0);
});

module.exports = {
  publishGPSUpdate,
  CHANNELS,
  isConnected: () => isConnected,
};
