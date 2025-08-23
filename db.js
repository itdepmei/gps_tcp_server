const mysql = require("mysql2/promise");
const { config } = require("dotenv");
const logger = require("./Logger");
config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'fauil',
  waitForConnections: true,
  connectionLimit: Number(process.env.CONNECTIONLIMIT) || 10,
  queueLimit: 0,
  acquireTimeout: 15000, // زيادة timeout
  timeout: 60000,
  multipleStatements: false,
  reconnect: true,
  idleTimeout: 300000,
  // إضافة SSL config للأمان
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

let pool;

/**
 * Create a connection pool if not exists
 */
async function connect() {
  if (!pool) {
    try {
      pool = mysql.createPool(dbConfig);
      console.log("✅ Database pool created.");
      logger.info("Database pool created.");
      
      // Test the pool
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      console.log("✅ Database connection test successful.");
      
    } catch (error) {
      logger.error("❌ Error creating pool: " + error.message);
      console.error("❌ Error creating pool:" + error.message);
      throw error;
    }
  }
  return pool;
}

/**
 * Get a connection from the pool
 */
async function getConnection() {
  const pool = await connect();
  try {
    const connection = await pool.getConnection();
    connection.config.namedPlaceholders = true;
    console.log("📡 Connection obtained from pool.");
    logger.info("Connection obtained from pool.");
    return connection;
  } catch (error) {
    logger.error("❌ Error obtaining connection: " + error.message);
    console.error("❌ Error obtaining connection:" + error.message);
    throw error;
  }
}

/**
 * Main connection function with retry logic
 */
async function mainConnection(retries = 5, delay = 5000) {
  let connection;
  
  console.log(`🔄 Attempting to connect to database at ${dbConfig.host}:3306...`);
  
  while (retries > 0) {
    try {
      const pool = await connect();
      console.log("✅ Database pool is ready.");
      
      connection = await getConnection();
      console.log("✅ Connection is successful.");
      
      // Test query
      const [rows] = await connection.query("SELECT 1 as test");
      console.log("✅ Test query result:", rows[0]);
      
      // Release connection after use
      connection.release();
      console.log("🎉 Database connection established successfully!");
      return; // Exit function if successful
      
    } catch (error) {
      const errorMsg = `Connection error. Retries left: ${retries - 1} - ${error.message}`;
      logger.error(errorMsg);
      console.error(`❌ ${errorMsg}`);
      
      retries -= 1;
      if (retries === 0) {
        const finalError = "All retries failed. Could not connect to the database.";
        logger.error(finalError);
        console.error(`💥 ${finalError}`);
        
        // في بيئة الإنتاج، لا نريد إيقاف التطبيق
        if (process.env.NODE_ENV === 'production') {
          console.log("⚠️ Running in production mode, continuing without database...");
          return;
        }
        throw new Error(finalError);
      }
      
      console.log(`⏳ Waiting ${delay/1000} seconds before retry...`);
      await new Promise(res => setTimeout(res, delay));
      
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          logger.error("Error releasing connection: ", releaseError.message);
        }
      }
    }
  }
}

// إضافة graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down database connections...');
  if (pool) {
    await pool.end();
    console.log('✅ Database connections closed.');
  }
  process.exit(0);
});

module.exports = { mainConnection, getConnection, connect };
// Uncomment to run when executing the file directly
// mainConnection().catch(console.error);
