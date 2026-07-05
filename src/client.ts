import type {
  ContextPack,
  ScenarioGraph,
  ScenarioVersionRecord,
  SessionEventRecord,
  SessionRecord
} from "./scenario.js";

export interface DriftClientConfig {
  readonly baseUrl: string;
  readonly tenantId: string;
  readonly bearerToken: string;
  readonly fetch?: FetchLike;
  readonly correlationId?: string;
}

export interface FetchLike {
  (input: string, init: DriftFetchInit): Promise<DriftFetchResponse>;
}

export interface DriftFetchInit {
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface DriftFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export class DriftClientError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly correlationId?: string
  ) {
    super(message);
  }
}

export interface DriftClient {
  publishScenario(
    graph: ScenarioGraph,
    options?: DriftMutationOptions
  ): Promise<ScenarioVersionRecord>;
  validateScenario(graph: ScenarioGraph): Promise<{ readonly valid: true }>;
  createSession(
    scenarioId: string,
    scenarioVersion: string,
    slots: Readonly<Record<string, string>>,
    options?: DriftMutationOptions
  ): Promise<SessionRecord>;
  processSessionEvent(
    sessionId: string,
    eventType: string,
    slotUpdates?: Readonly<Record<string, string>>,
    options?: DriftMutationOptions
  ): Promise<SessionEventRecord>;
  getContextPack(sessionId: string): Promise<ContextPack>;
}

export interface DriftMutationOptions {
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
}

interface DriftSuccessEnvelope<T> {
  readonly data: T;
}

interface DriftErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlationId?: string;
  };
}

export function createDriftClient(config: DriftClientConfig): DriftClient {
  const transport = config.fetch ?? globalFetch;
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  return {
    publishScenario(graph, options) {
      return request<ScenarioVersionRecord>(transport, config, baseUrl, {
        method: "POST",
        path: "/v1/scenarios",
        body: graph,
        ...mutationFields(options)
      });
    },
    validateScenario(graph) {
      return request<{ readonly valid: true }>(transport, config, baseUrl, {
        method: "POST",
        path: `/v1/scenarios/${encodeURIComponent(graph.scenarioId)}/versions/${encodeURIComponent(graph.version)}/validate`,
        body: graph
      });
    },
    createSession(scenarioId, scenarioVersion, slots, options) {
      return request<SessionRecord>(transport, config, baseUrl, {
        method: "POST",
        path: "/v1/sessions",
        body: { scenarioId, scenarioVersion, slots },
        ...mutationFields(options)
      });
    },
    processSessionEvent(sessionId, eventType, slotUpdates = {}, options) {
      return request<SessionEventRecord>(transport, config, baseUrl, {
        method: "POST",
        path: `/v1/sessions/${encodeURIComponent(sessionId)}/events`,
        body: { eventType, slotUpdates },
        ...mutationFields(options)
      });
    },
    getContextPack(sessionId) {
      return request<ContextPack>(transport, config, baseUrl, {
        method: "GET",
        path: `/v1/sessions/${encodeURIComponent(sessionId)}/context-pack`
      });
    }
  };
}

function mutationFields(
  options: DriftMutationOptions | undefined
): { readonly idempotencyKey?: string; readonly correlationId?: string } {
  return {
    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options?.correlationId ? { correlationId: options.correlationId } : {})
  };
}

async function request<T>(
  transport: FetchLike,
  config: DriftClientConfig,
  baseUrl: string,
  input: {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly correlationId?: string;
  }
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.bearerToken}`,
    "x-tenant-id": config.tenantId,
    "content-type": "application/json"
  };
  const correlationId = input.correlationId ?? config.correlationId;
  if (correlationId) headers["x-correlation-id"] = correlationId;
  if (input.idempotencyKey) headers["idempotency-key"] = input.idempotencyKey;

  const response = await transport(`${baseUrl}${input.path}`, {
    method: input.method,
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) })
  });
  const envelope = await response.json();
  if (isErrorEnvelope(envelope)) {
    throw new DriftClientError(
      envelope.error.code,
      envelope.error.message,
      response.status,
      envelope.error.correlationId
    );
  }
  if (!response.ok || !isSuccessEnvelope<T>(envelope)) {
    throw new DriftClientError("INVALID_RESPONSE", "DRIFT API returned an invalid response.", response.status);
  }
  return envelope.data;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function isSuccessEnvelope<T>(value: unknown): value is DriftSuccessEnvelope<T> {
  return value !== null && typeof value === "object" && "data" in value;
}

function isErrorEnvelope(value: unknown): value is DriftErrorEnvelope {
  if (value === null || typeof value !== "object" || !("error" in value)) {
    return false;
  }
  const error = (value as { readonly error: unknown }).error;
  return (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    typeof (error as { readonly message?: unknown }).message === "string"
  );
}

async function globalFetch(input: string, init: DriftFetchInit): Promise<DriftFetchResponse> {
  return fetch(input, init);
}
