export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  message: string;
  traceId: string;
  context?: Record<string, unknown>;
  error?: { name: string; message: string };
};

export type LogSink = (entry: LogEntry) => void;

export function createLogger(sink: LogSink = (entry) => console.log(JSON.stringify(entry))) {
  return {
    log(level: LogLevel, message: string, traceId: string, context?: Record<string, unknown>, error?: unknown) {
      sink({
        level,
        message,
        traceId,
        context,
        error: error ? serializeError(error) : undefined,
      });
    },
    child(traceId: string, context?: Record<string, unknown>) {
      return {
        debug: (message: string, details?: Record<string, unknown>) => sink({ level: "debug", message, traceId, context: { ...context, ...details } }),
        info: (message: string, details?: Record<string, unknown>) => sink({ level: "info", message, traceId, context: { ...context, ...details } }),
        warn: (message: string, details?: Record<string, unknown>) => sink({ level: "warn", message, traceId, context: { ...context, ...details } }),
        error: (message: string, error?: unknown, details?: Record<string, unknown>) => sink({ level: "error", message, traceId, context: { ...context, ...details }, error: error ? serializeError(error) : undefined }),
      };
    },
  };
}

export function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  return { name: "UnknownError", message: "An unexpected error occurred" };
}

export function createTraceId(): string {
  return crypto.randomUUID();
}
