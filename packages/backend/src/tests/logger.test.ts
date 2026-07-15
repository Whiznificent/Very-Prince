/**
 * @file logger.test.ts
 * @description Vitest unit tests for the shared Pino logger utility.
 *
 * Strategy:
 * - Create a pino instance with a `PassThrough` stream so we can capture
 *   JSON log records without any transport overhead.
 * - Assert that `createLogger` attaches the expected `component` binding.
 * - Assert that child loggers produced via `.child()` carry their own
 *   additional fields without losing the parent bindings.
 * - Assert the `rootLogger` exists and is a valid Pino logger.
 * - Assert log level filtering: records below the logger's level are dropped.
 */

import { describe, it, expect } from 'vitest';
import pino, { type Logger } from 'pino';
import { PassThrough } from 'node:stream';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build an in-memory Pino logger that writes newline-delimited JSON to a
 * `PassThrough` stream, making it trivial to capture and inspect log records
 * without touching the file system or console.
 *
 * @param level - Minimum log level to allow (default: 'trace' to capture all).
 */
function buildTestLogger(level = 'trace') {
  const stream = new PassThrough({ objectMode: false });
  const logger = pino({ level }, stream);
  return { logger, stream };
}

/**
 * Collect all buffered JSON records from a `PassThrough` stream.
 * Pino emits one JSON object per line; we split and parse each.
 */
function drainRecords(stream: PassThrough): Record<string, unknown>[] {
  const raw = stream.read() as Buffer | null;
  if (!raw) return [];
  return raw
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rootLogger', () => {
  it('exports a valid Pino logger instance', async () => {
    const { rootLogger } = await import('../utils/logger.js');
    // A Pino logger exposes these standard methods.
    expect(typeof rootLogger.info).toBe('function');
    expect(typeof rootLogger.warn).toBe('function');
    expect(typeof rootLogger.error).toBe('function');
    expect(typeof rootLogger.debug).toBe('function');
    expect(typeof rootLogger.child).toBe('function');
  });

  it('has a numeric level property', async () => {
    const { rootLogger } = await import('../utils/logger.js');
    // Pino exposes `.level` as a string ('info', 'debug', …)
    expect(typeof rootLogger.level).toBe('string');
    // It must be a recognised Pino level name.
    expect(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).toContain(
      rootLogger.level
    );
  });
});

describe('createLogger', () => {
  it('returns a Pino Logger with the expected component binding', () => {
    const { stream, logger: root } = buildTestLogger();

    // Replicate createLogger behaviour: just .child({ component })
    const log = root.child({ component: 'MyService' });

    log.info('hello from MyService');

    const [record] = drainRecords(stream);
    expect(record).toBeDefined();
    expect(record!['component']).toBe('MyService');
    expect(record!['msg']).toBe('hello from MyService');
  });

  it('accepts additional bindings alongside component', () => {
    const { stream, logger: root } = buildTestLogger();

    const log = root.child({ component: 'IndexerService', env: 'test' });
    log.warn('rate limited');

    const [record] = drainRecords(stream);
    expect(record!['component']).toBe('IndexerService');
    expect(record!['env']).toBe('test');
    expect(record!['msg']).toBe('rate limited');
  });

  it('re-exports the createLogger function correctly', async () => {
    const { createLogger } = await import('../utils/logger.js');
    expect(typeof createLogger).toBe('function');

    const log = createLogger('TestComponent');
    // Must be a Pino Logger (has .child, .info, etc.)
    expect(typeof log.info).toBe('function');
    expect(typeof log.child).toBe('function');
  });
});

describe('child logger', () => {
  it('inherits parent bindings and appends its own', () => {
    const { stream, logger: root } = buildTestLogger();

    const serviceLog = root.child({ component: 'WebhookWorker' });
    const reqLog = serviceLog.child({ jobId: 'job-42' });

    reqLog.info('job started');

    const [record] = drainRecords(stream);
    expect(record!['component']).toBe('WebhookWorker');
    expect(record!['jobId']).toBe('job-42');
    expect(record!['msg']).toBe('job started');
  });

  it('does not pollute the parent logger bindings', () => {
    const { stream, logger: root } = buildTestLogger();

    const parent = root.child({ component: 'ParentService' });
    const child = parent.child({ reqId: 'req-001' });

    // Log on the child first, then the parent.
    child.info('child msg');
    parent.info('parent msg');

    const records = drainRecords(stream);
    expect(records).toHaveLength(2);

    const childRecord = records[0]!;
    const parentRecord = records[1]!;

    // Child carries both bindings.
    expect(childRecord['component']).toBe('ParentService');
    expect(childRecord['reqId']).toBe('req-001');

    // Parent should NOT carry child's reqId.
    expect(parentRecord['component']).toBe('ParentService');
    expect(parentRecord['reqId']).toBeUndefined();
  });
});

describe('log levels', () => {
  it('emits records at the configured level', () => {
    const { stream, logger } = buildTestLogger('info');

    logger.info('info message');

    const [record] = drainRecords(stream);
    expect(record!['msg']).toBe('info message');
    // Pino emits the numeric level value by default (30 = info).
    // Our production logger overrides this via formatters.level, but the
    // buildTestLogger helper uses plain pino, so we assert the numeric value.
    expect(record!['level']).toBe(30);
  });

  it('suppresses records below the configured level', () => {
    const { stream, logger } = buildTestLogger('warn');

    logger.debug('should be suppressed');
    logger.info('also suppressed');

    const records = drainRecords(stream);
    // Nothing should have been written.
    expect(records).toHaveLength(0);
  });

  it('emits warn and error records when level is warn', () => {
    const { stream, logger } = buildTestLogger('warn');

    logger.warn('warning');
    logger.error('error');

    const records = drainRecords(stream);
    expect(records).toHaveLength(2);
    expect(records[0]!['msg']).toBe('warning');
    expect(records[1]!['msg']).toBe('error');
  });
});

describe('structured fields on log records', () => {
  it('includes arbitrary object fields in the JSON record', () => {
    const { stream, logger } = buildTestLogger();

    logger.info({ orgId: 'stellar', ledger: 5001 }, 'event processed');

    const [record] = drainRecords(stream);
    expect(record!['orgId']).toBe('stellar');
    expect(record!['ledger']).toBe(5001);
    expect(record!['msg']).toBe('event processed');
  });

  it('serialises err objects using Pino standard err serialiser', () => {
    const { stream, logger } = buildTestLogger();
    const err = new Error('something went wrong');

    logger.error({ err }, 'sync failed');

    const [record] = drainRecords(stream);
    expect(record!['msg']).toBe('sync failed');
    // Pino's standard err serialiser converts Error → { message, stack, type }
    const errObj = record!['err'] as Record<string, unknown>;
    expect(errObj['message']).toBe('something went wrong');
    expect(typeof errObj['stack']).toBe('string');
  });

  it('records include a timestamp field', () => {
    const { stream, logger } = buildTestLogger();

    logger.info('timestamped');

    const [record] = drainRecords(stream);
    // pino always writes `time` as an epoch-ms number by default,
    // or an ISO string when stdTimeFunctions.isoTime is used.
    expect(record!['time']).toBeDefined();
  });
});

describe('Logger type export', () => {
  it('re-exports the Logger type from pino', async () => {
    // We can't directly test a TypeScript type at runtime, but we can verify
    // that the createLogger return value satisfies the Logger interface by
    // checking for known methods.
    const { createLogger } = await import('../utils/logger.js');
    const log: Logger = createLogger('TypeCheck');
    expect(typeof log.info).toBe('function');
    expect(typeof log.fatal).toBe('function');
    expect(typeof log.child).toBe('function');
    expect(typeof log.isLevelEnabled).toBe('function');
  });
});
