import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDriftHttpHandler,
  type DriftHttpRequest,
  type ScenarioGraph,
  type ScenarioRepository
} from "../src/index.js";

function repo(): ScenarioRepository {
  return {
    scenarios: new Map(),
    sessions: new Map(),
    events: [],
    idempotencyKeys: new Map(),
    auditEvents: [],
    outboxEvents: []
  };
}

const headers = {
  authorization: "Bearer actor_1:tenant_a",
  "x-tenant-id": "tenant_a",
  "x-correlation-id": "corr_http",
  "idempotency-key": "key_1"
};

const graph: ScenarioGraph = {
  scenarioId: "onboarding",
  version: "1.0.0",
  scenes: [
    {
      id: "start",
      kind: "start",
      context: {
        instructions: ["Ask for a goal."],
        requiredSlots: ["locale"],
        policyReferences: ["policy://default/chat"]
      }
    },
    {
      id: "done",
      kind: "terminal",
      context: {
        instructions: ["Finish."],
        requiredSlots: [],
        policyReferences: ["policy://default/chat"]
      }
    }
  ],
  transitions: [{ id: "finish", from: "start", to: "done", eventType: "accepted" }]
};

describe("HTTP contract boundary", () => {
  it("AT-HTTP-001 maps the primary session flow into stable envelopes", () => {
    const store = repo();
    const handle = createDriftHttpHandler(store);

    const scenarioResponse = handle({
      method: "POST",
      path: "/v1/scenarios",
      headers,
      body: graph
    });
    assert.equal(scenarioResponse.status, 201);

    const sessionResponse = handle({
      method: "POST",
      path: "/v1/sessions",
      headers: { ...headers, "idempotency-key": "key_2" },
      body: {
        scenarioId: "onboarding",
        scenarioVersion: "1.0.0",
        slots: { locale: "ja" }
      }
    });
    assert.equal(sessionResponse.status, 201);
    const sessionId = readData(sessionResponse).sessionId;

    const eventResponse = handle({
      method: "POST",
      path: `/v1/sessions/${sessionId}/events`,
      headers: { ...headers, "idempotency-key": "key_3" },
      body: { eventType: "accepted" }
    });
    assert.equal(eventResponse.status, 200);

    const packResponse = handle({
      method: "GET",
      path: `/v1/sessions/${sessionId}/context-pack`,
      headers,
      body: undefined
    });
    assert.equal(packResponse.status, 200);
    assert.equal(readData(packResponse).sceneId, "done");
  });

  it("AT-HTTP-002 returns 401 before mutation when authorization is missing", () => {
    const store = repo();
    const handle = createDriftHttpHandler(store);
    const response = handle({
      method: "POST",
      path: "/v1/scenarios",
      headers: { "x-tenant-id": "tenant_a" },
      body: graph
    });

    assert.equal(response.status, 401);
    assert.equal(store.scenarios.size, 0);
  });

  it("AT-HTTP-003 returns 403 for tenant scope mismatch", () => {
    const store = repo();
    const handle = createDriftHttpHandler(store);
    const response = handle({
      method: "POST",
      path: "/v1/scenarios",
      headers: {
        authorization: "Bearer actor_1:tenant_b",
        "x-tenant-id": "tenant_a"
      },
      body: graph
    });

    assert.equal(response.status, 403);
    assert.equal(store.scenarios.size, 0);
  });

  it("AT-HTTP-004 returns 422 for malformed input", () => {
    const store = repo();
    const handle = createDriftHttpHandler(store);
    const request: DriftHttpRequest = {
      method: "POST",
      path: "/v1/scenarios",
      headers,
      body: { ...graph, scenes: [] }
    };
    const response = handle(request);

    assert.equal(response.status, 422);
  });

  it("AT-HTTP-005 returns 409 when an idempotency key is reused for a different request", () => {
    const store = repo();
    const handle = createDriftHttpHandler(store);

    handle({
      method: "POST",
      path: "/v1/scenarios",
      headers,
      body: graph
    });

    const response = handle({
      method: "POST",
      path: "/v1/scenarios",
      headers,
      body: {
        ...graph,
        version: "2.0.0"
      }
    });

    assert.equal(response.status, 409);
    const body = response.body as { readonly error: { readonly code: string } };
    assert.equal(body.error.code, "IDEMPOTENCY_CONFLICT");
  });
});

function readData(response: { readonly body: unknown }): Record<string, string> {
  const body = response.body as { readonly data: Record<string, string> };
  return body.data;
}
