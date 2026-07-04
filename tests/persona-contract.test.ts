import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DriftError,
  compilePersonaVersion,
  createPersona,
  createPersonaVersion,
  publishPersonaVersion,
  type PersonaContract,
  type PersonaRepository,
  type TenantContext
} from "../src/index.js";

function repo(): PersonaRepository {
  return {
    personas: new Map(),
    versions: new Map(),
    auditEvents: []
  };
}

const context: TenantContext = {
  tenantId: "tenant_a",
  actorId: "actor_1",
  allowedTenantIds: ["tenant_a"],
  correlationId: "corr_test"
};

const contract: PersonaContract = {
  id: "contract_1",
  displayName: "Guide",
  version: "1.0.0",
  behavior: {
    voice: ["concise", "calm"],
    boundaries: ["do not claim real-world agency"]
  },
  policyReferences: ["policy://default/safety"],
  pluginReferences: ["renderer.basic"]
};

describe("versioned persona contract compiler", () => {
  it("AT-PERSONA-001 compiles a published version into a deterministic bundle", () => {
    const store = repo();
    const personaId = createPersona(store, context);
    createPersonaVersion(store, context, personaId, contract, "2026-07-05T00:00:00.000Z");
    publishPersonaVersion(store, context, personaId, "1.0.0", "2026-07-05T00:01:00.000Z");

    const first = compilePersonaVersion(
      store,
      context,
      personaId,
      "1.0.0",
      "2026-07-05T00:02:00.000Z",
      ["renderer.basic"]
    );
    const second = compilePersonaVersion(
      store,
      context,
      personaId,
      "1.0.0",
      "2026-07-05T00:02:00.000Z",
      ["renderer.basic"]
    );

    assert.equal(second.contentHash, first.contentHash);
    assert.equal(first.provenance.sourceHash.length, 64);
    assert.deepEqual(first.policyReferences, ["policy://default/safety"]);
    assert.equal(store.auditEvents.some((event) => event.action === "persona_version.compiled"), true);
  });

  it("AT-PERSONA-002 rejects mutation of a published version", () => {
    const store = repo();
    const personaId = createPersona(store, context);
    createPersonaVersion(store, context, personaId, contract, "2026-07-05T00:00:00.000Z");
    publishPersonaVersion(store, context, personaId, "1.0.0", "2026-07-05T00:01:00.000Z");

    assert.throws(
      () => createPersonaVersion(store, context, personaId, contract, "2026-07-05T00:02:00.000Z"),
      (error: unknown) => error instanceof DriftError && error.code === "VERSION_CONFLICT"
    );
  });

  it("AT-PERSONA-003 fails closed for unknown plugin references", () => {
    const store = repo();
    const personaId = createPersona(store, context);
    createPersonaVersion(store, context, personaId, contract, "2026-07-05T00:00:00.000Z");
    publishPersonaVersion(store, context, personaId, "1.0.0", "2026-07-05T00:01:00.000Z");

    assert.throws(
      () => compilePersonaVersion(store, context, personaId, "1.0.0", "2026-07-05T00:02:00.000Z", []),
      (error: unknown) => error instanceof DriftError && error.code === "VALIDATION_FAILED"
    );
  });

  it("AT-PERSONA-004 denies cross-tenant compilation before resource exposure", () => {
    const store = repo();
    const personaId = createPersona(store, context);
    createPersonaVersion(store, context, personaId, contract, "2026-07-05T00:00:00.000Z");
    publishPersonaVersion(store, context, personaId, "1.0.0", "2026-07-05T00:01:00.000Z");

    const wrongTenant: TenantContext = {
      tenantId: "tenant_b",
      actorId: "actor_2",
      allowedTenantIds: ["tenant_b"],
      correlationId: "corr_wrong"
    };

    assert.throws(
      () =>
        compilePersonaVersion(
          store,
          wrongTenant,
          personaId,
          "1.0.0",
          "2026-07-05T00:02:00.000Z",
          ["renderer.basic"]
        ),
      (error: unknown) => error instanceof DriftError && error.code === "TENANT_SCOPE_DENIED"
    );
  });

  it("AT-PERSONA-005 validates required contract fields", () => {
    const store = repo();
    const personaId = createPersona(store, context);
    const invalid: PersonaContract = {
      ...contract,
      policyReferences: []
    };

    assert.throws(
      () => createPersonaVersion(store, context, personaId, invalid, "2026-07-05T00:00:00.000Z"),
      (error: unknown) => error instanceof DriftError && error.code === "VALIDATION_FAILED"
    );
  });
});
