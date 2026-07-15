/**
 * @file logger.ts
 * @description Shared structured Pino logger for the Very-Prince backend.
 *
 * ## Design Goals
 *
 * - Single logger instance shared across all modules (avoids mismatched configs).
 * - Child-logger pattern keeps structured context (service, component, etc.)
 *   attached to every log line without repeating it manually.
 * - Pretty-printing in development via `pino-pretty`; plain JSON in production
 *   for ingestion by log aggregators (CloudWatch, Datadog, etc.).
 * - `LOG_LEVEL` env var allows operators to tune verbosity at runtime.
 *
 * ## Usage
 *
 * ```ts
 * // Module-level child logger (preferred)
 * import { createLogger } from '../utils/logger.js';
 * const log = createLogger('IndexerService');
 *
 * log.info({ ledger: 123 }, 'Starting sync');
 * log.warn({ attempt: 3 }, 'Rate limited, retrying');
 * log.error({ err }, 'Sync failed');
 *
 * // Deeply nested child (e.g., per-request context)
 * const reqLog = log.child({ reqId: request.id, orgId: 'stellar' });
 * reqLog.debug('Processing webhook');
 * ```
 *
 * ## Log Levels (lowest → highest verbosity)
 *
 * | Level  | When to use                                      |
 * |--------|--------------------------------------------------|
 * | trace  | Extremely granular (hot-path internals)          |
 * | debug  | Useful during development; disabled in prod      |
 * | info   | Normal, expected operational events              |
 * | warn   | Degraded state — retries, missing config, etc.   |
 * | error  | Failures that need human attention               |
 * | fatal  | Unrecoverable — process will exit                |
 */

import pino, { type Logger, type LoggerOptions } from 'pino';

// ─── Configuration ────────────────────────────────────────────────────────────

const isDev = process.env['NODE_ENV'] !== 'production';

const LOG_LEVEL = process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info');

/**
 * Base Pino options.
 * In development, transport is set to `pino-pretty` for human-readable output.
 * In production, plain JSON is emitted so log shippers can parse it easily.
 */
const baseOptions: LoggerOptions = {
  level: LOG_LEVEL,

  // Standard fields added to every log record.
  base: {
    pid: process.pid,
    service: 'very-prince-backend',
  },

  // ISO timestamp for human readability (adds minor overhead vs epoch ms).
  timestamp: pino.stdTimeFunctions.isoTime,

  // Map pino's numeric level to a human-readable string in JSON output.
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};

/**
 * In development we pipe through pino-pretty for colourised terminal output.
 * In production we emit raw JSON so external shippers can handle formatting.
 */
const transport = isDev
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: '[{component}] {msg}',
      },
    })
  : undefined;

// ─── Root Logger ─────────────────────────────────────────────────────────────

/**
 * The root logger instance. All module-level loggers are children of this.
 * Consumers should use `createLogger(component)` rather than this directly.
 */
export const rootLogger: Logger = transport
  ? pino(baseOptions, transport)
  : pino(baseOptions);

// ─── Child Logger Factory ────────────────────────────────────────────────────

/**
 * Create a child logger bound to a named component.
 *
 * Every log record produced by the returned logger will include a
 * `component` field, making it easy to filter logs in your aggregator:
 *
 *   `jq 'select(.component == "IndexerService")' app.log`
 *
 * @param component - Human-readable name of the module or class.
 * @param bindings  - Optional additional key-value pairs to bind permanently.
 * @returns A Pino `Logger` instance with `component` pre-set.
 *
 * @example
 * const log = createLogger('WebhookWorker');
 * log.info('Worker started');
 * // → { "level":"info", "component":"WebhookWorker", "msg":"Worker started", ... }
 */
export function createLogger(
  component: string,
  bindings?: Record<string, unknown>
): Logger {
  return rootLogger.child({ component, ...bindings });
}

/**
 * Convenience re-export of the Pino `Logger` type so consumers don't need
 * to import from `pino` directly.
 */
export type { Logger };
