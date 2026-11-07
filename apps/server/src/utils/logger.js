/**
 * Structured runtime logger for the Nemotron backend.
 *
 * Console output is formatted and human-readable by default. Set
 * LOG_FORMAT=json to emit single-line JSON lines instead (useful for log
 * collectors).
 *
 * Levels: debug < info < warn < error.
 */
const isDev = process.env.NODE_ENV !== 'production';
const forceJson = process.env.LOG_FORMAT === 'json';
const isTty = process.stdout.isTTY === true;
import { randomUUID } from 'node:crypto';

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_LABELS = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

const LEVEL_COLORS = {
  debug: '\x1b[90m', // bright black / gray
  info: '\x1b[36m',  // cyan
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};
const RESET = '\x1b[0m';

function currentLogLevel() {
  const configured = String(process.env.LOG_LEVEL || (isDev ? 'debug' : 'info')).toLowerCase();
  return LEVELS[configured] ?? LEVELS.info;
}

function padLeft(value, length) {
  return String(value).padStart(length, ' ');
}

function formatTimestamp() {
  return new Date().toISOString().replace(/T/, ' ').replace(/\..*/, '');
}

function serialize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack,
      name: value.name,
    };
  }
  return value;
}

function buildRecord(level, message, meta) {
  const record = {
    timestamp: formatTimestamp(),
    level,
    message,
  };
  if (meta && Object.keys(meta).length) {
    record.meta = meta;
  }
  return record;
}

function formatMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) return '';
  const pairs = Object.entries(meta)
    .map(([key, value]) => {
      const serialized = serialize(value);
      const text =
        serialized === undefined ? 'undefined'
        : serialized === null ? 'null'
        : typeof serialized === 'string' ? serialized
        : JSON.stringify(serialized);
      return `${key}=${text}`;
    });
  return ' ' + pairs.join(' ');
}

function renderRecord(record) {
  const timestamp = forceJson ? record.timestamp : `[${record.timestamp}]`;
  const levelLabel = forceJson ? record.level : padLeft(LEVEL_LABELS[record.level] || record.level, 5);
  const message = record.message;
  const meta = record.meta ? formatMeta(record.meta) : '';

  if (forceJson) {
    return JSON.stringify(record, (key, value) => serialize(value));
  }

  const color = isTty ? (LEVEL_COLORS[record.level] || '') : '';
  const reset = isTty ? RESET : '';
  return `${color}${timestamp} ${levelLabel}${reset} ${message}${meta}`;
}

function log(level, message, meta = {}) {
  if (LEVELS[level] < currentLogLevel()) return;
  const record = buildRecord(level, message, meta);
  const line = renderRecord(record);
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(line + '\n');
}

function child(meta) {
  return {
    debug: (message, extra) => log('debug', message, { ...meta, ...extra }),
    info: (message, extra) => log('info', message, { ...meta, ...extra }),
    warn: (message, extra) => log('warn', message, { ...meta, ...extra }),
    error: (message, extra) => log('error', message, { ...meta, ...extra }),
  };
}

const logger = {
  debug: (message, meta) => log('debug', message, meta),
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
  child,
  /**
   * Express middleware that logs each incoming request and its outgoing
   * response with a request id, method, path, status code, and duration.
   */
  requestLogger: () => (req, res, next) => {
    const requestId = (req.headers['x-request-id'] || randomUUID()).toString();
    req.requestId = requestId;
    req.log = child({ requestId, method: req.method, path: req.path, ip: req.ip });

    const start = process.hrtime.bigint();
    const originalSend = res.send;
    const originalJson = res.json;

    res.send = function (body) {
      res.send = originalSend;
      res.json = originalJson;
      logResponse(body);
      return originalSend.call(this, body);
    };

    res.json = function (body) {
      res.send = originalSend;
      res.json = originalJson;
      logResponse(body);
      return originalJson.call(this, body);
    };

    function logResponse(body) {
      const durationMs = Number((process.hrtime.bigint() - start) / 1000n / 1000n);
      const status = res.statusCode || 0;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      logger[level]('HTTP response', {
        requestId,
        method: req.method,
        path: req.originalUrl || req.path,
        status,
        durationMs,
        userId: req.user ? String(req.user._id) : undefined,
        responseSize: typeof body === 'string' ? body.length : undefined,
      });
    }

    logger.info('HTTP request', {
      requestId,
      method: req.method,
      path: req.originalUrl || req.path,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      contentLength: req.get('content-length'),
    });

    next();
  },
};

export default logger;
