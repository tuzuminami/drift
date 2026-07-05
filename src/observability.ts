export interface SafeLogger {
  log(event: SafeLogEvent): void;
}

export interface SafeLogEvent {
  readonly event: string;
  readonly outcome: "ok" | "error";
  readonly correlationId: string;
  readonly method?: string;
  readonly path?: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly reasonCode?: string;
}

export function createJsonStderrLogger(): SafeLogger {
  return {
    log(event) {
      process.stderr.write(`${JSON.stringify(event)}\n`);
    }
  };
}

export function createInMemoryLogger(): SafeLogger & { readonly events: SafeLogEvent[] } {
  const events: SafeLogEvent[] = [];
  return {
    events,
    log(event) {
      events.push(event);
    }
  };
}
