import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DriftError,
  createInMemoryScenarioRepository,
  createInMemoryScenarioStore,
  createOperationalAsyncHandler,
  createOperationalHandler,
  createServerRuntime,
  createServerConfig,
  createDriftNodeServer
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

  it("AT-SERVER-002 fails production startup without a production auth adapter", async () => {
    const config = createServerConfig({
      NODE_ENV: "production",
      DRIFT_AUTH_MODE: "external",
      DRIFT_STORAGE: "postgres",
      DATABASE_URL: "postgresql://example"
    });

    await assert.rejects(
      () => createServerRuntime(config),
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

  it("AT-SERVER-005 requires PostgreSQL configuration for PostgreSQL storage", () => {
    assert.throws(
      () => createServerConfig({ NODE_ENV: "test", DRIFT_STORAGE: "postgres" }),
      (error: unknown) => error instanceof DriftError && error.code === "CONFIGURATION_INVALID"
    );
  });

  it("AT-SERVER-006 exposes configured async readiness without protected data", async () => {
    const config = createServerConfig({ NODE_ENV: "test" });
    const handle = createOperationalAsyncHandler(
      { store: createInMemoryScenarioStore() },
      config
    );

    const ready = await handle({ method: "GET", path: "/readyz", headers: {} });

    assert.equal(ready.status, 200);
    assert.deepEqual((ready.body as { readonly data: unknown }).data, {
      status: "ready",
      authMode: "development",
      storage: "in-memory"
    });
  });

  it("AT-SERVER-007 requires an auth adapter for external auth runtime", async () => {
    const config = createServerConfig({
      NODE_ENV: "test",
      DRIFT_AUTH_MODE: "external"
    });

    await assert.rejects(
      () => createServerRuntime(config),
      (error: unknown) => error instanceof DriftError && error.code === "CONFIGURATION_INVALID"
    );
  });

  it("AT-SERVER-008 closes runtime resources when the server closes", async () => {
    let closeCount = 0;
    const server = createDriftNodeServer(
      {
        store: createInMemoryScenarioStore(),
        close: async () => {
          closeCount += 1;
        }
      },
      createServerConfig({ NODE_ENV: "test" })
    );

    server.emit("close");
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    assert.equal(closeCount, 1);
  });
});
