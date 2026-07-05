import { randomUUID } from "node:crypto";
import { DriftError, type TenantContext } from "./persona-contract.js";
import {
  createSession,
  getContextPack,
  processSessionEvent,
  publishScenarioVersion,
  validateScenarioGraph,
  type MutationMetadata,
  type ScenarioGraph,
  type ScenarioRepository,
} from "./scenario.js";

export interface DriftHttpRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface DriftHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export function createDriftHttpHandler(repo: ScenarioRepository) {
  return function handle(request: DriftHttpRequest): DriftHttpResponse {
    const correlationId = request.headers["x-correlation-id"] ?? `corr_${randomUUID()}`;
    try {
      const context = authenticate(request, correlationId);
      const metadata = mutationMetadata(request);

      if (request.method === "POST" && request.path === "/v1/scenarios") {
        const graph = parseScenarioGraph(request.body);
        const record = publishScenarioVersion(repo, context, graph, metadata);
        return ok(201, record, correlationId);
      }

      const validateMatch = request.path.match(
        /^\/v1\/scenarios\/([^/]+)\/versions\/([^/]+)\/validate$/
      );
      if (request.method === "POST" && validateMatch) {
        const graph = parseScenarioGraph(request.body);
        if (graph.scenarioId !== validateMatch[1] || graph.version !== validateMatch[2]) {
          throw new DriftError("VALIDATION_FAILED", "Path version must match request body.");
        }
        validateScenarioGraph(graph);
        return ok(200, { valid: true }, correlationId);
      }

      if (request.method === "POST" && request.path === "/v1/sessions") {
        const body = parseObject(request.body);
        const session = createSession(
          repo,
          context,
          requireString(body, "scenarioId"),
          requireString(body, "scenarioVersion"),
          parseStringRecord(body.slots, "slots"),
          metadata
        );
        return ok(201, session, correlationId);
      }

      const eventMatch = request.path.match(/^\/v1\/sessions\/([^/]+)\/events$/);
      if (request.method === "POST" && eventMatch) {
        const body = parseObject(request.body);
        const event = processSessionEvent(
          repo,
          context,
          eventMatch[1] as string,
          requireString(body, "eventType"),
          body.slotUpdates === undefined ? {} : parseStringRecord(body.slotUpdates, "slotUpdates"),
          metadata
        );
        return ok(200, event, correlationId);
      }

      const contextPackMatch = request.path.match(/^\/v1\/sessions\/([^/]+)\/context-pack$/);
      if (request.method === "GET" && contextPackMatch) {
        return ok(200, getContextPack(repo, context, contextPackMatch[1] as string), correlationId);
      }

      throw new DriftError("RESOURCE_NOT_FOUND", "Route was not found.");
    } catch (error) {
      return errorResponse(error, correlationId);
    }
  };
}

function authenticate(request: DriftHttpRequest, correlationId: string): TenantContext {
  const tenantId = request.headers["x-tenant-id"];
  const authorization = request.headers.authorization;
  if (!tenantId || !authorization?.startsWith("Bearer ")) {
    throw new DriftError("AUTHENTICATION_REQUIRED", "Authentication is required.");
  }

  const token = authorization.slice("Bearer ".length);
  const [actorId, tenantList] = token.split(":");
  const allowedTenantIds = tenantList?.split(",").filter(Boolean) ?? [];
  if (!actorId || allowedTenantIds.length === 0) {
    throw new DriftError("AUTHENTICATION_REQUIRED", "Authentication is required.");
  }

  return {
    tenantId,
    actorId,
    allowedTenantIds,
    correlationId
  };
}

function mutationMetadata(request: DriftHttpRequest): MutationMetadata | undefined {
  const idempotencyKey = request.headers["idempotency-key"];
  if (!idempotencyKey) return undefined;
  return {
    idempotencyKey,
    reasonCode: "api_request"
  };
}

function ok(status: number, data: unknown, correlationId: string): DriftHttpResponse {
  return {
    status,
    body: {
      data,
      meta: {
        requestId: `req_${randomUUID()}`,
        correlationId,
        apiVersion: "v1"
      }
    }
  };
}

function errorResponse(error: unknown, correlationId: string): DriftHttpResponse {
  if (error instanceof DriftError) {
    return {
      status: httpStatus(error),
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

function httpStatus(error: DriftError): number {
  switch (error.code) {
    case "AUTHENTICATION_REQUIRED":
      return 401;
    case "TENANT_SCOPE_DENIED":
      return 403;
    case "RESOURCE_NOT_FOUND":
      return 404;
    case "VERSION_CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "CONFIGURATION_INVALID":
      return 503;
    case "VALIDATION_FAILED":
      return 422;
  }
}

function parseScenarioGraph(value: unknown): ScenarioGraph {
  const body = parseObject(value);
  return {
    scenarioId: requireString(body, "scenarioId"),
    version: requireString(body, "version"),
    scenes: parseScenes(body.scenes),
    transitions: parseTransitions(body.transitions)
  };
}

function parseScenes(value: unknown): ScenarioGraph["scenes"] {
  if (!Array.isArray(value)) {
    throw new DriftError("VALIDATION_FAILED", "scenes must be an array.");
  }
  return value.map((item) => {
    const scene = parseObject(item);
    const context = parseObject(scene.context);
    const kind = requireString(scene, "kind");
    if (kind !== "start" && kind !== "normal" && kind !== "terminal") {
      throw new DriftError("VALIDATION_FAILED", "scene kind is invalid.");
    }
    return {
      id: requireString(scene, "id"),
      kind,
      context: {
        instructions: parseStringArray(context.instructions, "instructions"),
        requiredSlots: parseStringArray(context.requiredSlots, "requiredSlots"),
        policyReferences: parseStringArray(context.policyReferences, "policyReferences")
      }
    };
  });
}

function parseTransitions(value: unknown): ScenarioGraph["transitions"] {
  if (!Array.isArray(value)) {
    throw new DriftError("VALIDATION_FAILED", "transitions must be an array.");
  }
  return value.map((item) => {
    const transition = parseObject(item);
    const guard = transition.guard === undefined ? undefined : parseObject(transition.guard);
    return {
      id: requireString(transition, "id"),
      from: requireString(transition, "from"),
      to: requireString(transition, "to"),
      eventType: requireString(transition, "eventType"),
      ...(guard
        ? {
            guard: {
              slotEquals: parseStringRecord(guard.slotEquals, "slotEquals"),
              reasonCode: requireString(guard, "reasonCode")
            }
          }
        : {})
    };
  });
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DriftError("VALIDATION_FAILED", "Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function requireString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DriftError("VALIDATION_FAILED", `${key} must be a non-empty string.`);
  }
  return value;
}

function parseStringArray(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DriftError("VALIDATION_FAILED", `${key} must be a string array.`);
  }
  return value;
}

function parseStringRecord(value: unknown, key: string): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DriftError("VALIDATION_FAILED", `${key} must be an object.`);
  }

  const entries = Object.entries(value);
  if (entries.some(([, nested]) => typeof nested !== "string")) {
    throw new DriftError("VALIDATION_FAILED", `${key} values must be strings.`);
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}
