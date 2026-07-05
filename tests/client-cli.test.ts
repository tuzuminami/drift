import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DriftClientError,
  createDriftClient,
  createDriftHttpHandler,
  createInMemoryScenarioRepository,
  runDriftCli,
  type DriftFetchInit,
  type DriftFetchResponse,
  type ScenarioGraph
} from "../src/index.js";

const graph: ScenarioGraph = {
  scenarioId: "sdk-smoke",
  version: "1.0.0",
  scenes: [
    {
      id: "start",
      kind: "start",
      context: {
        instructions: ["Start."],
        requiredSlots: ["locale"],
        policyReferences: ["policy://default/chat"]
      }
    },
    {
      id: "done",
      kind: "terminal",
      context: {
        instructions: ["Done."],
        requiredSlots: [],
        policyReferences: ["policy://default/chat"]
      }
    }
  ],
  transitions: [{ id: "finish", from: "start", to: "done", eventType: "accepted" }]
};

describe("TypeScript SDK and CLI smoke", () => {
  it("AT-SDK-001 runs the primary scenario flow through the typed client", async () => {
    const client = createDriftClient({
      baseUrl: "http://drift.test",
      tenantId: "tenant_a",
      bearerToken: "actor_1:tenant_a",
      fetch: createHandlerFetch()
    });

    await client.validateScenario(graph);
    await client.publishScenario(graph, { idempotencyKey: "sdk-publish" });
    const session = await client.createSession(
      "sdk-smoke",
      "1.0.0",
      { locale: "ja" },
      { idempotencyKey: "sdk-session" }
    );
    await client.processSessionEvent(
      session.sessionId,
      "accepted",
      {},
      { idempotencyKey: "sdk-event" }
    );
    const pack = await client.getContextPack(session.sessionId);

    assert.equal(pack.sceneId, "done");
    assert.equal(pack.provenance.sequence, 1);
  });

  it("AT-SDK-002 maps API errors to DriftClientError without exposing tokens", async () => {
    const client = createDriftClient({
      baseUrl: "http://drift.test",
      tenantId: "tenant_a",
      bearerToken: "secret-token-value",
      fetch: async () => ({
        ok: false,
        status: 403,
        async json() {
          return {
            error: {
              code: "TENANT_SCOPE_DENIED",
              message: "Request cannot access this tenant.",
              correlationId: "corr_sdk"
            }
          };
        }
      })
    });

    await assert.rejects(
      () => client.publishScenario(graph, { idempotencyKey: "sdk-error" }),
      (error: unknown) =>
        error instanceof DriftClientError &&
        error.code === "TENANT_SCOPE_DENIED" &&
        !error.message.includes("secret-token-value")
    );
  });

  it("AT-SDK-003 rejects malformed success envelopes", async () => {
    const client = createDriftClient({
      baseUrl: "http://drift.test",
      tenantId: "tenant_a",
      bearerToken: "actor_1:tenant_a",
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { unexpected: true };
        }
      })
    });

    await assert.rejects(
      () => client.validateScenario(graph),
      (error: unknown) => error instanceof DriftClientError && error.code === "INVALID_RESPONSE"
    );
  });

  it("AT-CLI-001 runs smoke without printing the bearer token", async () => {
    let stdout = "";
    let stderr = "";
    const token = "actor_1:tenant_a";
    const code = await runDriftCli({
      argv: ["node", "drift", "smoke", "--base-url", "http://drift.test", "--tenant", "tenant_a", "--token", token],
      env: {},
      fetch: createHandlerFetch(),
      io: {
        stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
        stderr: { write: (chunk: string) => { stderr += chunk; return true; } }
      }
    });

    assert.equal(code, 0);
    assert.match(stdout, /"ok":true/);
    assert.equal(stdout.includes(token), false);
    assert.equal(stderr.includes(token), false);
  });
});

function createHandlerFetch(): (input: string, init: DriftFetchInit) => Promise<DriftFetchResponse> {
  const handler = createDriftHttpHandler(createInMemoryScenarioRepository());
  return async (input, init) => {
    const url = new URL(input);
    const response = handler({
      method: init.method,
      path: url.pathname,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) as unknown : undefined
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() {
        return response.body;
      }
    };
  };
}
