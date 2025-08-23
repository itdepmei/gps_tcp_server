const redis = require("redis");

// استخدام متغير البيئة أو القيمة الافتراضية
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const publisher = redis.createClient({
  url: REDIS_URL,
  retry_strategy: (options) => {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      console.error('❌ Redis server is not running!');
      return new Error('Redis server is not running');
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error('Retry time exhausted');
    }
    if (options.attempt > 10) {
      return undefined;
    }
    return Math.min(options.attempt * 100, 3000);
  }
});

let isConnected = false;

publisher.on('connect', () => {
  console.log('✅ Redis publisher connected successfully to:', REDIS_URL);
  isConnected = true;
});

publisher.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
  isConnected = false;
});

publisher.on('end', () => {
  console.log('📡 Redis connection ended');
  isConnected = false;
});

publisher.on('reconnecting', () => {
  console.log('🔄 Redis reconnecting...');
});

// محاولة الاتصال مع retry
async function connectWithRetry() {
  try {
    await publisher.connect();
  } catch (err) {
    console.error('Failed to connect to Redis:', err.message);
    console.log('🔄 Retrying Redis connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  }
}

connectWithRetry();

async function publishGPSUpdate(data) {
  if (!isConnected) {
    console.warn('⚠️ Redis not connected, skipping GPS update publish for IMEI:', data.imei);
    return;
  }
  
  try {
    await publisher.publish("gps_updates", JSON.stringify(data));
    console.log("📡 Published GPS update to Redis:", data.imei);
  } catch (err) {
    console.error("❌ Redis publish error:", err.message);
  }
}

// إغلاق الاتصال بشكل صحيح
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down Redis publisher...');
  if (isConnected) {
    await publisher.quit();
  }
  process.exit(0);
});

module.exports = { publishGPSUpdate };