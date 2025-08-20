const { createLogger, format, transports } = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');
// Define log file naming format with monthly rotation
const logFileFormat = 'YYYY-MM'; // Rotate logs based on the year and month
// Create logger instance

const logger = createLogger({
  level: 'info', // Set default log level for the root logger
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    // Console transport to show logs in the console
    new transports.Console({
      format: format.combine(
        format.colorize(), // Add colors for console output
        format.simple()
      ),
      level: 'info', // Only handle logs at info level or higher for console
    }),
    // Info level logs with monthly rotation
    new DailyRotateFile({
      filename: path.join(__dirname, `../logs/info-%DATE%.log`),
      datePattern: logFileFormat, // Rotate every month
      level: 'info', // Only log 'info' level messages here
      zippedArchive: true, // Compress old log files
      maxSize: '20m', // Limit file size to 20 MB
      maxFiles: '12', // Keep logs for 12 months (one log file per month)
    }),
    // Error level logs with monthly rotation
    new DailyRotateFile({
      filename: path.join(__dirname, `../logs/error-%DATE%.log`),
      datePattern: logFileFormat, // Rotate every month
      level: 'error', // Only log 'error' level messages here
      zippedArchive: true, // Compress old log files
      maxSize: '20m', // Limit file size to 20 MB
      maxFiles: '12', // Keep logs for 12 months (one log file per month)
    })
  ],
  exitOnError: false, // Prevent exit on handled exceptions
});

module.exports = logger;
