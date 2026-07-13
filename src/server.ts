import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AuthAdapter } from "./auth.js";
import { createJsonStderrLogger, type SafeLogger } from "./observability.js";
import { DriftError } from "./core.js";
import { createInMemoryScenarioRepository } from "./repository.js";
import { createDriftAsyncHttpHandler, createDriftHttpHandler, type DriftHttpRequest, type DriftHttpResponse } from "./http.js";
import type { ScenarioRepository } from "./scenario.js";
import { createInMemoryScenarioStore, type ScenarioStore } from "./store.js";
import { createPostgresPool, createPostgresScenarioStore, runPostgresMigrations } from "./postgres.js";
import type { AsyncVerifiedCompiledArtifactResolver } from "./artifact.js";

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly authMode: "development" | "external";
  readonly storageMode: "in-memory" | "postgres";
  readonly databaseUrl?: string;
  readonly autoMigrate: boolean;
  readonly nodeEnv: "development" | "test" | "production";
}

export interface DriftServerRuntime {
  readonly store: ScenarioStore;
  readonly authAdapter?: AuthAdapter;
  readonly logger?: SafeLogger;
  readonly close?: () => Promise<void>;
}

export interface ServerRuntimeOptions {
  readonly authAdapter?: AuthAdapter;
  readonly logger?: SafeLogger;
  readonly artifactResolver?: AsyncVerifiedCompiledArtifactResolver;
}

export function createServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const authMode = parseAuthMode(env.DRIFT_AUTH_MODE, nodeEnv);
  const storageMode = parseStorageMode(env.DRIFT_STORAGE, nodeEnv);
  const databaseUrl = env.DATABASE_URL;

  if (nodeEnv === "production" && authMode !== "external") {
    throw new DriftError(
      "CONFIGURATION_INVALID",
      "Production startup requires DRIFT_AUTH_MODE=external and a supplied production auth adapter."
    );
  }
  if (nodeEnv === "production" && storageMode !== "postgres") {
    throw new DriftError("CONFIGURATION_INVALID", "Production startup requires DRIFT_STORAGE=postgres.");
  }
  if (storageMode === "postgres" && !databaseUrl) {
    throw new DriftError("CONFIGURATION_INVALID", "DATABASE_URL is required when DRIFT_STORAGE=postgres.");
  }

  const base = {
    host: env.HOST ?? "127.0.0.1",
    port: parsePort(env.PORT),
    authMode,
    storageMode,
    autoMigrate: env.DRIFT_AUTO_MIGRATE === "1",
    nodeEnv
  };
  return databaseUrl ? { ...base, databaseUrl } : base;
}

export function createOperationalHandler(repo: ScenarioRepository, config: ServerConfig) {
  const driftHandler = createDriftHttpHandler(repo);
  return function handle(request: DriftHttpRequest): DriftHttpResponse {
    if (request.method === "GET" && request.path === "/healthz") {
      return operationalOk({ status: "ok" });
    }
    if (request.method === "GET" && request.path === "/readyz") {
      return operationalOk({
        status: "ready",
        authMode: config.authMode,
        storage: "in-memory"
      });
    }
    return driftHandler(request);
  };
}

export function createOperationalAsyncHandler(runtime: DriftServerRuntime, config: ServerConfig) {
  const driftHandler = createDriftAsyncHttpHandler(
    runtime.store,
    runtime.authAdapter ? { authAdapter: runtime.authAdapter } : {}
  );
  return async function handle(request: DriftHttpRequest): Promise<DriftHttpResponse> {
    if (request.method === "GET" && request.path === "/healthz") {
      return operationalOk({ status: "ok" });
    }
    if (request.method === "GET" && request.path === "/readyz") {
      try {
        await runtime.store.checkReadiness();
        return operationalOk({
          status: "ready",
          authMode: config.authMode,
          storage: config.storageMode
        });
      } catch {
        return operationalDependencyUnavailable();
      }
    }
    return driftHandler(request);
  };
}

export async function createServerRuntime(
  config: ServerConfig,
  options: ServerRuntimeOptions = {}
): Promise<DriftServerRuntime> {
  if (config.authMode === "external" && !options.authAdapter) {
    throw new DriftError("CONFIGURATION_INVALID", "External auth mode requires an auth adapter.");
  }

  if (config.storageMode === "in-memory") {
    return {
      store: createInMemoryScenarioStore(undefined, options.artifactResolver),
      ...(options.authAdapter ? { authAdapter: options.authAdapter } : {}),
      ...(options.logger ? { logger: options.logger } : {})
    };
  }

  if (!config.databaseUrl) {
    throw new DriftError("CONFIGURATION_INVALID", "DATABASE_URL is required when DRIFT_STORAGE=postgres.");
  }
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5_000
  });
  if (config.autoMigrate) {
    await runPostgresMigrations(pool);
  }
  return {
    store: createPostgresScenarioStore(pool, options.artifactResolver),
    ...(options.authAdapter ? { authAdapter: options.authAdapter } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    close: async () => pool.end()
  };
}

export function createDriftNodeServer(
  runtimeOrRepo: DriftServerRuntime | ScenarioRepository,
  config: ServerConfig
): Server {
  const handle =
    "store" in runtimeOrRepo
      ? createOperationalAsyncHandler(runtimeOrRepo, config)
      : createOperationalHandler(runtimeOrRepo, config);
  const logger = "store" in runtimeOrRepo ? runtimeOrRepo.logger ?? createJsonStderrLogger() : undefined;
  const server = createServer(async (request, response) => {
    const startedAt = Date.now();
    const correlationId = normalizeHeaders(request.headers)["x-correlation-id"] ?? "corr_operational";
    const method = request.method === "GET" ? "GET" : "POST";
    const path = safePath(request.url);
    try {
      const driftRequest = await toDriftRequest(request);
      const driftResponse = await handle(driftRequest);
      writeResponse(response, driftResponse);
      logger?.log({
        event: "drift.http.request",
        outcome: driftResponse.status >= 500 ? "error" : "ok",
        correlationId,
        method,
        path,
        status: driftResponse.status,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const driftResponse = serverErrorResponse(error, request, logger);
      writeResponse(response, driftResponse);
      logger?.log({
        event: "drift.http.request",
        outcome: "error",
        correlationId,
        method,
        path,
        status: driftResponse.status,
        durationMs: Date.now() - startedAt,
        reasonCode: error instanceof DriftError ? error.code : "INTERNAL_ERROR"
      });
    }
  });
  if ("store" in runtimeOrRepo) {
    server.once("close", () => {
      void runtimeOrRepo.close?.().catch(() => {
        logger?.log({
          event: "drift.server.shutdown",
          outcome: "error",
          correlationId: "corr_operational",
          reasonCode: "DEPENDENCY_UNAVAILABLE"
        });
      });
    });
  }
  return server;
}

export async function startDriftServer(
  runtimeOrRepo?: DriftServerRuntime | ScenarioRepository,
  config: ServerConfig = createServerConfig(process.env)
): Promise<Server> {
  const runtime = runtimeOrRepo ?? (await createServerRuntime(config));
  const server = createDriftNodeServer(runtime, config);
  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });
  return server;
}

async function toDriftRequest(request: IncomingMessage): Promise<DriftHttpRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const method = request.method === "GET" ? "GET" : "POST";
  return {
    method,
    path: safePath(request.url),
    headers: normalizeHeaders(request.headers),
    body: parseBody(rawBody)
  };
}

function writeResponse(response: ServerResponse, driftResponse: DriftHttpResponse): void {
  response.statusCode = driftResponse.status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(driftResponse.body));
}

function normalizeHeaders(headers: IncomingMessage["headers"]): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(",") : value
    ])
  );
}

function operationalOk(data: Readonly<Record<string, string>>): DriftHttpResponse {
  return {
    status: 200,
    body: {
      data,
      meta: {
        requestId: "req_operational",
        correlationId: "corr_operational",
        apiVersion: "v1"
      }
    }
  };
}

function operationalDependencyUnavailable(): DriftHttpResponse {
  return {
    status: 503,
    body: {
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Runtime dependency is not ready.",
        details: [],
        correlationId: "corr_operational"
      }
    }
  };
}

function serverErrorResponse(
  error: unknown,
  request: IncomingMessage,
  logger: SafeLogger | undefined
): DriftHttpResponse {
  const correlationId = normalizeHeaders(request.headers)["x-correlation-id"] ?? "corr_operational";
  if (error instanceof DriftError) {
    return {
      status: error.code === "CONFIGURATION_INVALID" ? 503 : 422,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: [],
          correlationId
        }
      }
    };
  }
  logger?.log({
    event: "drift.http.unexpected_error",
    outcome: "error",
    correlationId
  });
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected internal error.",
        details: [],
        correlationId
      }
    }
  };
}

function parseBody(rawBody: string): unknown {
  if (rawBody.length === 0) return undefined;
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new DriftError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }
}

function safePath(value: string | undefined): string {
  if (!value) return "/";
  try {
    return new URL(value, "http://drift.local").pathname;
  } catch {
    return "/";
  }
}

function parseNodeEnv(value: string | undefined): ServerConfig["nodeEnv"] {
  if (value === "production" || value === "test") return value;
  return "development";
}

function parseAuthMode(
  value: string | undefined,
  nodeEnv: ServerConfig["nodeEnv"]
): ServerConfig["authMode"] {
  if (value === "external") return "external";
  if (value === undefined || value === "development") {
    return nodeEnv === "production" ? "external" : "development";
  }
  throw new DriftError("CONFIGURATION_INVALID", "Unsupported auth mode.");
}

function parseStorageMode(
  value: string | undefined,
  nodeEnv: ServerConfig["nodeEnv"]
): ServerConfig["storageMode"] {
  if (value === "postgres") return "postgres";
  if (value === undefined || value === "in-memory") {
    return nodeEnv === "production" ? "postgres" : "in-memory";
  }
  throw new DriftError("CONFIGURATION_INVALID", "Unsupported storage mode.");
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new DriftError("CONFIGURATION_INVALID", "PORT must be a valid TCP port.");
  }
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = createServerConfig(process.env);
  const runtime = await createServerRuntime(config);
  const server = await startDriftServer(runtime, config);
  const shutdown = () => server.close();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  console.log(`drift api listening on http://${config.host}:${config.port}`);
}
