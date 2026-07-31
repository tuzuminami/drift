import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DriftError,
  authenticateWithAdapter,
  authAdapterTimeoutFromEnvironment,
  type AuthAdapter,
  type DriftHttpRequest
} from "../src/index.js";

const request: DriftHttpRequest = {
  method: "GET",
  path: "/v1/sessions/session_1/context-pack",
  headers: { "x-tenant-id": "tenant_a" }
};

describe("external authentication boundary", () => {
  it("AT-AUTH-001 normalizes a valid external principal and snapshots scopes", async () => {
    const adapter: AuthAdapter = {
      async authenticate() {
        return {
          tenantId: "tenant_a",
          actorId: "actor_1",
          allowedTenantIds: ["tenant_a"],
          scopes: ["session:read"],
          correlationId: "adapter-value"
        };
      }
    };
    const context = await authenticateWithAdapter(adapter, request, "corr_request", 50);
    assert.equal(context.correlationId, "corr_request");
    assert.deepEqual(context.scopes, ["session:read"]);
  });

  it("AT-AUTH-002 maps malformed principals, failures, and timeouts to safe dependency errors", async () => {
    const malformed: AuthAdapter = {
      async authenticate() {
        return { tenantId: "tenant_a" } as unknown as Awaited<ReturnType<AuthAdapter["authenticate"]>>;
      }
    };
    const failing: AuthAdapter = { async authenticate() { throw new Error("private provider failure"); } };
    const timeout: AuthAdapter = { authenticate: () => new Promise(() => undefined) };
    for (const adapter of [malformed, failing, timeout]) {
      await assert.rejects(
        () => authenticateWithAdapter(adapter, request, "corr_request", 1),
        (error: unknown) => error instanceof DriftError && error.code === "DEPENDENCY_UNAVAILABLE" && error.message === "Authentication dependency is unavailable."
      );
    }
  });

  it("AT-AUTH-003 validates timeout configuration", () => {
    assert.equal(authAdapterTimeoutFromEnvironment({}), 2_500);
    assert.equal(authAdapterTimeoutFromEnvironment({ DRIFT_AUTH_TIMEOUT_MS: "10" }), 10);
    for (const value of ["0", "30001", "ten"]) {
      assert.throws(
        () => authAdapterTimeoutFromEnvironment({ DRIFT_AUTH_TIMEOUT_MS: value }),
        (error: unknown) => error instanceof DriftError && error.code === "CONFIGURATION_INVALID"
      );
    }
  });
});
