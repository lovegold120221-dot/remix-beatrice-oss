import pino from 'pino';

// Structured logging for the whole app. Replaces ad-hoc console.log/error with
// a single JSON logger so production logs are searchable and machine-readable.
// Level is configurable via LOG_LEVEL (default "info"); set to "silent" to disable.
const level = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level,
  base: { app: 'beatrice-oss' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Child loggers with a fixed context, so call sites don't repeat themselves.
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

export default logger;
