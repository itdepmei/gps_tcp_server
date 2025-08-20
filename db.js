const mysql = require("mysql2/promise");
const { config } = require("dotenv");
const Logger = require("../middleware/Logger");
config();

const dbConfig = {
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE,
  waitForConnections: true,
  connectionLimit: Number(process.env.CONNECTIONLIMIT) || 10, // Default if not set
  queueLimit: 0,
  acquireTimeout: 10000,
  multipleStatements: false,
};
let pool;
/**
 * Create a connection pool if not exists
 */
async function connect() {
  if (!pool) {
    try {
      pool = mysql.createPool(dbConfig);
      console.log("Database pool created.");
      Logger.info("Database pool created.");
    } catch (error) {
      Logger.error("Error creating pool: "+ error);
      console.error("Error creating pool:"+ error);
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
    console.log("Connection obtained from pool.");
    Logger.info("Connection obtained from pool.");
    return connection;
  } catch (error) {
    Logger.error("Error obtaining connection: "+ error);
    console.error("Error obtaining connection:"+ error);
    throw error;
  }
}

/**
 * Main connection function with retry logic
 */
async function mainConnection(retries = 5, delay = 3000) {
  let connection;
  while (retries > 0) {
    try {
      const pool = await connect();
      console.log("Database pool is ready.");
      connection = await getConnection();
      console.log("Connection is successful.");
      // Test query or your logic
      const [rows] = await connection.query("SELECT 1");
      console.log("Test query result:", rows);
      // Release connection after use
      connection.release();
      break; // Exit loop if successful
    } catch (error) {
      Logger.error(`Connection error. Retries left: ${retries - 1}`+error);
      console.error(`Connection error. Retries left: ${retries - 1}`+error);
      retries -= 1;
      if (retries === 0) {
        Logger.error("All retries failed. Could not connect to the database.");
        console.error("All retries failed. Could not connect to the database.");
        break;
      }
      // Wait before retrying
      await new Promise(res => setTimeout(res, delay));
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          Logger.error("Error releasing connection: ", releaseError);
        }
      }
    }
  }
}
module.exports = { mainConnection, getConnection, connect };
// Uncomment to run when executing the file directly
// mainConnection().catch(console.error);
