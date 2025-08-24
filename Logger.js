const { createLogger, format, transports } = require('winston');
const path = require('path');

// Create logger instance with console only for Docker
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    // Console transport only - Docker will handle log collection
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      ),
      level: 'info'
    })
  ],
  exitOnError: false
});

// إضافة file transport فقط إذا كان مجلد logs موجود
try {
  const fs = require('fs');
  const logsDir = path.join(__dirname, 'logs');
  const DailyRotateFile = require('winston-daily-rotate-file');

  // إنشاء المجلد إذا لم يكن موجود
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // ✅ Logs عامة (info وما فوق)
  logger.add(new DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
    level: 'info'
  }));

  // ✅ Logs خاصة بالأخطاء فقط
  logger.add(new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    zippedArchive: true,
    level: 'error'
  }));

} catch (err) {
  console.warn('File logging disabled:', err.message);
}

module.exports = logger;
