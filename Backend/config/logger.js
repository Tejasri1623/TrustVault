/**
 * @fileoverview Centralized structured logging with Winston.
 *
 * PRODUCTION: Outputs JSON to stdout (for Datadog, CloudWatch, Kibana, etc.)
 *             + writes to logs/error.log and logs/combined.log
 * DEVELOPMENT: Outputs colorized, human-readable text to stdout
 *
 * Usage:
 *   const logger = require('./config/logger');                // root logger
 *   const logger = require('./config/logger').child('Worker'); // child logger
 *
 * @module config/logger
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Determine whether file logging is safe for this runtime.
// Vercel's serverless filesystem is read-only except for /tmp, and the
// application must not try to create directories under /var/task. In that
// environment we keep logging on the Console transport only (stdout/stderr)
// so Vercel can capture it. Local development preserves file logging.
const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
const fileLoggingEnabled = !isVercel;

// Logs directory (only used when file logging is enabled)
const logsDir = path.join(__dirname, '..', 'logs');

if (fileLoggingEnabled) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (err) {
    // If the directory cannot be created (e.g. read-only filesystem), fall
    // back to console-only logging instead of crashing startup.
    // eslint-disable-next-line no-console
    console.warn('File logging disabled: unable to create logs directory:', err.message);
  }
}

// Re-evaluate after the attempted mkdir so a failure disables file transports.
const fileLoggingAvailable = fileLoggingEnabled && fs.existsSync(logsDir);

// Build the optional file transports. Returns an empty array when file logging
// is disabled (e.g. Vercel serverless) so no files are created under /var/task.
function buildFileTransports() {
  if (!fileLoggingAvailable) return [];
  return [
    // File transports — errors go to dedicated file for quick triage
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),

    // Combined log — all levels
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ];
}

const isProduction = process.env.NODE_ENV === 'production';

// ─── Custom Formats ──────────────────────────────────────────────────────────

/**
 * Development format: colorized, human-readable, timestamped.
 * Example: 2026-07-30 10:45:32 [RoutingWorker] INFO: Job completed
 */
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, module: mod, ...meta }) => {
    const prefix = mod ? ` [${mod}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp}${prefix} ${level}: ${message}${metaStr}`;
  })
);

/**
 * Production format: structured JSON for log aggregation services.
 * Each line is a valid JSON object with timestamp, level, message, and metadata.
 */
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ─── Logger Instance ─────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: isProduction ? prodFormat : devFormat,
  defaultMeta: { service: 'trustvault' },
  transports: [
    // Console transport — always active
    new winston.transports.Console(),

    // File transports — only when the runtime permits writing (not Vercel)
    ...buildFileTransports()
  ],

  // Don't crash the process on an unhandled log error
  exitOnError: false
});

// ─── Child Logger Factory ────────────────────────────────────────────────────

/**
 * Create a child logger tagged with a module name.
 * All log entries from this child will include { module: name }.
 *
 * @param {string} name - Module/component name (e.g. 'RoutingWorker', 'EmailIngestion')
 * @returns {winston.Logger} A child logger instance
 *
 * @example
 * const logger = require('../config/logger').child('RoutingWorker');
 * logger.info('Job completed', { jobId: '123' });
 * // Output: 2026-07-30 10:45:32 [RoutingWorker] INFO: Job completed {"jobId":"123"}
 */
logger.child = function createChildLogger(name) {
  return logger.child({ module: name });
};

// Re-attach after overwrite — winston.Logger.prototype.child returns a DerivedLogger
// which doesn't have our custom child method. We store the factory separately.
const createChildLogger = (name) => {
  return winston.createLogger({
    level: logger.level,
    format: isProduction ? prodFormat : devFormat,
    defaultMeta: { service: 'trustvault', module: name },
    transports: [
      new winston.transports.Console(),
      ...buildFileTransports()
    ],
    exitOnError: false
  });
};

// ─── Morgan Stream ───────────────────────────────────────────────────────────

/**
 * Stream object for Morgan HTTP request logger integration.
 * Pipes Morgan output into Winston at the 'http' level.
 *
 * Usage in app.js:
 *   app.use(morgan('combined', { stream: logger.morganStream }));
 */
logger.morganStream = {
  write: (message) => {
    // Remove trailing newline that Morgan adds
    logger.info(message.trim(), { module: 'HTTP' });
  }
};

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = logger;
module.exports.createChildLogger = createChildLogger;
