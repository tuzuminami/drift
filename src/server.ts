import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DriftError } from "./persona-contract.js";
import { createInMemoryScenarioRepository } from "./repository.js";
import { createDriftHttpHandler, type DriftHttpRequest, type DriftHttpResponse } from "./http.js";
import type { ScenarioRepository } from "./scenario.js";

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly authMode: "development";
  readonly nodeEnv: "development" | "test" | "production";
}

export function createServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const authMode = env.DRIFT_AUTH_MODE;
  if (nodeEnv === "production") {
    throw new DriftError(
      "CONFIGURATION_INVALID",
      "Production startup requires a production auth adapter that is not included in this package yet."
    );
  }
  if (authMode !== undefined && authMode !== "development") {
    throw new DriftError("CONFIGURATION_INVALID", "Unsupported auth mode.");
  }

  return {
    host: env.HOST ?? "127.0.0.1",
    port: parsePort(env.PORT),
    authMode: "development",
    nodeEnv
  };
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

export function createDriftNodeServer(repo: ScenarioRepository, config: ServerConfig): Server {
  const handle = createOperationalHandler(repo, config);
  return createServer(async (request, response) => {
    const driftRequest = await toDriftRequest(request);
    const driftResponse = handle(driftRequest);
    writeResponse(response, driftResponse);
  });
}

export async function startDriftServer(
  repo: ScenarioRepository = createInMemoryScenarioRepository(),
  config: ServerConfig = createServerConfig(process.env)
): Promise<Server> {
  const server = createDriftNodeServer(repo, config);
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
    path: request.url ?? "/",
    headers: normalizeHeaders(request.headers),
    body: rawBody.length === 0 ? undefined : JSON.parse(rawBody)
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

function parseNodeEnv(value: string | undefined): ServerConfig["nodeEnv"] {
  if (value === "production" || value === "test") return value;
  return "development";
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
  const server = await startDriftServer(createInMemoryScenarioRepository(), config);
  process.once("SIGTERM", () => server.close());
  process.once("SIGINT", () => server.close());
  console.log(`drift api listening on http://${config.host}:${config.port}`);
}
