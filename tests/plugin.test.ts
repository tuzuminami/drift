import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIFT_PLUGIN_CORE_API_VERSION,
  DriftError,
  createNoopPlugin,
  createPluginHost,
  type Plugin,
  type PluginContext,
  type TenantContext
} from "../src/index.js";

const tenant: TenantContext = {
  tenantId: "tenant_plugin",
  actorId: "actor_plugin",
  allowedTenantIds: ["tenant_plugin"],
  correlationId: "corr_plugin"
};

const context: PluginContext = {
  tenant,
  correlationId: "corr_plugin",
  timeoutMs: 5
};

describe("plugin host contract", () => {
  it("AT-PLUGIN-001 validates compatible explicit plugins and reports health", async () => {
    const host = createPluginHost([createNoopPlugin()]);

    host.requireCapabilities(["healthcheck"]);
    const health = await host.healthCheckAll(context);

    assert.equal(health["noop.action"]?.status, "ok");
  });

  it("AT-PLUGIN-002 rejects incompatible plugin API versions", () => {
    const incompatible: Plugin = {
      ...createNoopPlugin(),
      coreApiVersion: "drift-plugin/9.9"
    };

    assert.throws(
      () => createPluginHost([incompatible]),
      (error: unknown) => error instanceof DriftError && error.code === "PLUGIN_INCOMPATIBLE"
    );
  });

  it("AT-PLUGIN-003 fails closed for missing capabilities", () => {
    const host = createPluginHost([createNoopPlugin()]);

    assert.throws(
      () => host.requireCapabilities(["action.execute"]),
      (error: unknown) => error instanceof DriftError && error.code === "PLUGIN_INCOMPATIBLE"
    );
  });

  it("AT-PLUGIN-004 treats plugin health timeout as dependency unavailable", async () => {
    const slow: Plugin = {
      name: "slow.action",
      version: "0.2.0",
      coreApiVersion: DRIFT_PLUGIN_CORE_API_VERSION,
      capabilities: ["healthcheck"],
      async healthCheck() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { status: "ok" };
      }
    };
    const host = createPluginHost([slow]);

    await assert.rejects(
      () => host.healthCheckAll(context),
      (error: unknown) => error instanceof DriftError && error.code === "DEPENDENCY_UNAVAILABLE"
    );
  });
});
