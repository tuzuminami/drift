import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DriftError,
  createInMemoryScenarioRepository,
  createOperationalHandler,
  createServerConfig
} from "../src/index.js";

describe("executable server configuration", () => {
  it("AT-SERVER-001 exposes unauthenticated health and readiness responses", () => {
    const handle = createOperationalHandler(
      createInMemoryScenarioRepository(),
      createServerConfig({ NODE_ENV: "test" })
    );

    const health = handle({ method: "GET", path: "/healthz", headers: {} });
    const ready = handle({ method: "GET", path: "/readyz", headers: {} });

    assert.equal(health.status, 200);
    assert.equal(ready.status, 200);
  });

  it("AT-SERVER-002 fails production startup without a production auth adapter", () => {
    assert.throws(
      () => createServerConfig({ NODE_ENV: "production" }),
      (error: unknown) => error instanceof DriftError && error.code === "CONFIGURATION_INVALID"
    );
  });

  it("AT-SERVER-003 delegates protected routes to the API contract handler", () => {
    const handle = createOperationalHandler(
      createInMemoryScenarioRepository(),
      createServerConfig({ NODE_ENV: "test" })
    );

    const response = handle({
      method: "POST",
      path: "/v1/scenarios",
      headers: { "x-tenant-id": "tenant_a" },
      body: {}
    });

    assert.equal(response.status, 401);
  });

  it("AT-SERVER-004 validates configured TCP port", () => {
    assert.throws(
      () => createServerConfig({ NODE_ENV: "test", PORT: "99999" }),
      (error: unknown) => error instanceof DriftError && error.code === "CONFIGURATION_INVALID"
    );
  });
});
