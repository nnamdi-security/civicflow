/**
 * A small structured logger (Phase 8 Part B).
 *
 * "Structured" means each log line is one line of JSON, for example:
 *   {"time":"2026-06-30T12:00:00.000Z","level":"info","event":"sla_scan.finished","recorded":3}
 * Machines (log search tools, alerts) can read that far more reliably than free sentences.
 *
 * Every field goes through `redact` first, so even a careless call such as
 * `logger.error("x", { error, user })` cannot put an email address or a token in the logs.
 *
 * What to log: ids, counts, durations, error KINDS. What not to log: anything a person wrote or
 * that identifies them. If in doubt, leave it out.
 */
import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogSink {
  /** Called with one finished line of JSON, and the level so errors can go to stderr. */
  write(level: LogLevel, line: string): void;
}

const defaultSink: LogSink = {
  write(level, line) {
    // Warnings and errors to the error stream, the rest to normal output, as hosting tools expect.
    if (level === "warn" || level === "error") console.error(line);
    else console.log(line);
  },
};

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/**
 * Makes a logger. `now` and `sink` can be replaced in tests (to freeze time and capture lines);
 * normal code uses the default `logger` exported below.
 */
export function createLogger(options: { now?: () => Date; sink?: LogSink } = {}): Logger {
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? defaultSink;

  const emit = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
    // `time`, `level` and `event` come first and cannot be overwritten by a field of the same name.
    const body = redact(fields);
    const safeFields = typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};
    const line = JSON.stringify({ ...safeFields, time: now().toISOString(), level, event: String(redact(event)) });
    sink.write(level, line);
  };

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

/** The logger the application uses. */
export const logger: Logger = createLogger();

/** Turns anything thrown into safe fields: the kind of error and a scrubbed message. */
export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { errorName: error.name, errorMessage: redact(error.message) };
  return { errorName: "NonError" };
}
