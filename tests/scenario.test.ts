import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DriftError,
  createInMemoryScenarioStore,
  createSession,
  getContextPack,
  processSessionEvent,
  publishScenarioVersion,
  replaySession,
  validateScenarioGraph,
  type AsyncVerifiedCompiledArtifactResolver,
  type ScenarioGraph,
  type ScenarioRepository,
  type TenantContext,
  type VerifiedCompiledArtifactResolver
} from "../src/index.js";

function repo(): ScenarioRepository {
  return {
    scenarios: new Map(),
    sessions: new Map(),
    events: [],
    idempotencyKeys: new Map(),
    auditEvents: [],
    outboxEvents: [],
    artifactResolver: {
      resolve(requestContext, locator) {
        if (requestContext.tenantId !== "tenant_a" || !knownArtifactIds.has(locator.artifactId)) return undefined;
        if (locator.artifactId === "aster_context_start") {
          return {
            artifactId: locator.artifactId,
            artifactVersion: locator.artifactVersion,
            producer: "aster",
            schemaVersion: "aster.drift-reference/1",
            compilerVersion: ASTER_COMPILER_VERSION,
            digestAlgorithm: "sha256",
            contentHash: START_HASH,
            tenantId: requestContext.tenantId
          };
        }
        return {
          artifactId: locator.artifactId,
          artifactVersion: locator.artifactVersion,
          producer: "aster",
          schemaVersion: "aster.drift-reference/1",
          compilerVersion: ASTER_COMPILER_VERSION,
          digestAlgorithm: "sha256",
          contentHash: PLAN_HASH,
          tenantId: requestContext.tenantId
        };
      }
    }
  };
}

const knownArtifactIds = new Set(["aster_context_start", "aster_context_plan"]);
const ASTER_COMPILER_VERSION = "aster-compiler/0.1.0";
const START_HASH = `sha256:${"a".repeat(64)}`;
const PLAN_HASH = `sha256:${"b".repeat(64)}`;
const asterBundle = JSON.parse(
  readFileSync("tests/fixtures/aster-compiled-bundle.json", "utf8")
) as {
  readonly personaId: string;
  readonly version: number;
  readonly compilerVersion: string;
  readonly contentHash: string;
};

const context: TenantContext = {
  tenantId: "tenant_a",
  actorId: "actor_1",
  allowedTenantIds: ["tenant_a"],
  correlationId: "corr_scenario"
};

const graph: ScenarioGraph = {
  scenarioId: "onboarding",
  version: "1.0.0",
  scenes: [
    {
      id: "start",
      kind: "start",
      context: {
        instructions: ["Ask for the user's goal."],
        requiredSlots: ["locale"],
        policyReferences: ["policy://default/chat"],
        artifactReferences: [
          {
            artifactId: "aster_context_start",
            artifactVersion: "1.0.0",
            producer: "aster",
            schemaVersion: "aster.drift-reference/1",
            compilerVersion: ASTER_COMPILER_VERSION,
            digestAlgorithm: "sha256",
            contentHash: START_HASH
          }
        ]
      }
    },
    {
      id: "plan",
      kind: "normal",
      context: {
        instructions: ["Summarize the plan."],
        requiredSlots: ["locale", "goal"],
        policyReferences: ["policy://default/chat"],
        artifactReferences: [
          {
            artifactId: "aster_context_plan",
            artifactVersion: "1.0.0",
            producer: "aster",
            schemaVersion: "aster.drift-reference/1",
            compilerVersion: ASTER_COMPILER_VERSION,
            digestAlgorithm: "sha256",
            contentHash: PLAN_HASH
          }
        ]
      }
    },
    {
      id: "done",
      kind: "terminal",
      context: {
        instructions: ["End the scenario."],
        requiredSlots: [],
        policyReferences: ["policy://default/chat"]
      }
    }
  ],
  transitions: [
    {
      id: "start_to_plan",
      from: "start",
      to: "plan",
      eventType: "goal_received",
      guard: {
        slotEquals: { consent: "granted" },
        reasonCode: "CONSENT_REQUIRED"
      }
    },
    {
      id: "plan_to_done",
      from: "plan",
      to: "done",
      eventType: "accepted"
    }
  ]
};

describe("scenario graph and session orchestration", () => {
  it("AT-DRIFT-001 validates reachable scenario graphs and rejects unreachable scenes", () => {
    assert.doesNotThrow(() => validateScenarioGraph(graph));

    const invalid: ScenarioGraph = {
      ...graph,
      scenes: [
        ...graph.scenes,
        {
          id: "orphan",
          kind: "normal",
          context: { instructions: [], requiredSlots: [], policyReferences: [] }
        }
      ]
    };
    assert.throws(
      () => validateScenarioGraph(invalid),
      (error: unknown) => error instanceof DriftError && error.code === "VALIDATION_FAILED"
    );
  });

  it("AT-DRIFT-001B rejects duplicate scene IDs", () => {
    const invalid: ScenarioGraph = {
      ...graph,
      scenes: [
        ...graph.scenes,
        {
          id: "plan",
          kind: "normal",
          context: {
            instructions: ["Duplicate plan."],
            requiredSlots: [],
            policyReferences: []
          }
        }
      ]
    };

    assert.throws(
      () => validateScenarioGraph(invalid),
      (error: unknown) =>
        error instanceof DriftError &&
        error.code === "VALIDATION_FAILED" &&
        error.message.includes("duplicate scene id")
    );
  });

  it("AT-DRIFT-001C rejects non-terminating required paths", () => {
    const invalid: ScenarioGraph = {
      ...graph,
      scenes: [
        {
          id: "start",
          kind: "start",
          context: { instructions: [], requiredSlots: [], policyReferences: [] }
        },
        {
          id: "loop",
          kind: "normal",
          context: { instructions: [], requiredSlots: [], policyReferences: [] }
        },
        {
          id: "done",
          kind: "terminal",
          context: { instructions: [], requiredSlots: [], policyReferences: [] }
        }
      ],
      transitions: [
        { id: "start_to_loop", from: "start", to: "loop", eventType: "next" },
        { id: "loop_self", from: "loop", to: "loop", eventType: "again" }
      ]
    };

    assert.throws(
      () => validateScenarioGraph(invalid),
      (error: unknown) =>
        error instanceof DriftError &&
        error.code === "VALIDATION_FAILED" &&
        error.message.includes("scene cannot reach terminal scene")
    );
  });

  it("AT-DRIFT-001D rejects ambiguous transition dispatch", () => {
    const invalid: ScenarioGraph = {
      ...graph,
      transitions: [
        ...graph.transitions,
        {
          id: "start_to_done_duplicate_event",
          from: "start",
          to: "done",
          eventType: "goal_received"
        }
      ]
    };

    assert.throws(
      () => validateScenarioGraph(invalid),
      (error: unknown) =>
        error instanceof DriftError &&
        error.code === "VALIDATION_FAILED" &&
        error.message.includes("ambiguous transition dispatch")
    );
  });

  it("AT-DRIFT-001E rejects terminal outgoing transitions", () => {
    const invalid: ScenarioGraph = {
      ...graph,
      transitions: [
        ...graph.transitions,
        {
          id: "done_to_start",
          from: "done",
          to: "start",
          eventType: "restart"
        }
      ]
    };

    assert.throws(
      () => validateScenarioGraph(invalid),
      (error: unknown) =>
        error instanceof DriftError &&
        error.code === "VALIDATION_FAILED" &&
        error.message.includes("terminal scene has outgoing transition")
    );
  });

  it("AT-ASTER-DRIFT-001 accepts a verified reference derived from an ASTER compiled bundle", () => {
    const reference = {
      artifactId: asterBundle.personaId,
      artifactVersion: String(asterBundle.version),
      producer: "aster" as const,
      schemaVersion: "aster.drift-reference/1" as const,
      compilerVersion: asterBundle.compilerVersion,
      digestAlgorithm: "sha256" as const,
      contentHash: `sha256:${asterBundle.contentHash}`
    };
    const verifiedResolver: VerifiedCompiledArtifactResolver = {
      resolve(requestContext, requested) {
        if (requestContext.tenantId !== "tenant_a" || requested.artifactId !== reference.artifactId) return undefined;
        return { ...reference, tenantId: "tenant_a" };
      }
    };
    const store = { ...repo(), artifactResolver: verifiedResolver };
    const asterGraph: ScenarioGraph = {
      ...graph,
      scenarioId: "aster-supported-onboarding",
      scenes: graph.scenes.map((scene) =>
        scene.id === "start"
          ? { ...scene, context: { ...scene.context, artifactReferences: [reference] } }
          : { ...scene, context: { ...scene.context, artifactReferences: [] } }
      )
    };

    assert.equal(publishScenarioVersion(store, context, asterGraph).status, "published");
  });

  it("AT-ASTER-DRIFT-002 rejects absent, tampered, and cross-tenant compiled artifacts", () => {
    const knownReference = graph.scenes[0]?.context.artifactReferences?.[0];
    assert.ok(knownReference);
    const canonicalResolver: VerifiedCompiledArtifactResolver = {
      resolve(requestContext, requested) {
        if (requested.artifactId === "missing") return undefined;
        return { ...knownReference, tenantId: requestContext.tenantId === "tenant_b" ? "tenant_a" : requestContext.tenantId };
      }
    };
    const withReference = (reference: typeof knownReference): ScenarioGraph => ({
      ...graph,
      scenes: graph.scenes.map((scene) =>
        scene.id === "start" ? { ...scene, context: { ...scene.context, artifactReferences: [reference] } } : scene
      )
    });

    assert.throws(
      () => publishScenarioVersion({ ...repo(), artifactResolver: canonicalResolver }, context, withReference({ ...knownReference, artifactId: "missing" })),
      (error: unknown) => error instanceof DriftError && error.code === "RESOURCE_NOT_FOUND"
    );
    assert.throws(
      () => publishScenarioVersion(
        { ...repo(), artifactResolver: canonicalResolver },
        context,
        withReference({ ...knownReference, contentHash: `sha256:${"c".repeat(64)}` })
      ),
      (error: unknown) => error instanceof DriftError && error.code === "VERSION_CONFLICT"
    );
    assert.throws(
      () => publishScenarioVersion(
        { ...repo(), artifactResolver: canonicalResolver },
        { ...context, tenantId: "tenant_b", allowedTenantIds: ["tenant_b"] },
        withReference(knownReference)
      ),
      (error: unknown) => error instanceof DriftError && error.code === "RESOURCE_NOT_FOUND"
    );
    const withoutResolver = repo();
    delete withoutResolver.artifactResolver;
    assert.throws(
      () => publishScenarioVersion(withoutResolver, context, withReference(knownReference)),
      (error: unknown) => error instanceof DriftError && error.code === "DEPENDENCY_UNAVAILABLE"
    );
  });

  it("AT-ASTER-DRIFT-003 snapshots verified references at publish and context-pack boundaries", () => {
    const store = repo();
    const input = structuredClone(graph);
    publishScenarioVersion(store, context, input);
    const inputReference = input.scenes[0]?.context.artifactReferences?.[0];
    assert.ok(inputReference);
    (inputReference as { contentHash: string }).contentHash = `sha256:${"c".repeat(64)}`;
    const session = createSession(store, context, "onboarding", "1.0.0", { locale: "ja" });
    const firstPack = getContextPack(store, context, session.sessionId);
    assert.equal(firstPack.artifactReferences[0]?.contentHash, START_HASH);

    const returnedReference = firstPack.artifactReferences[0];
    assert.ok(returnedReference);
    (returnedReference as { contentHash: string }).contentHash = `sha256:${"d".repeat(64)}`;
    assert.equal(getContextPack(store, context, session.sessionId).artifactReferences[0]?.contentHash, START_HASH);
  });

  it("AT-ASTER-DRIFT-004 supports an asynchronous verified resolver for store-backed publication", async () => {
    const syncResolver = repo().artifactResolver;
    assert.ok(syncResolver);
    const asyncResolver: AsyncVerifiedCompiledArtifactResolver = {
      async resolve(requestContext, locator) {
        await Promise.resolve();
        return syncResolver.resolve(requestContext, locator);
      }
    };
    const store = createInMemoryScenarioStore(undefined, asyncResolver);
    const record = await store.publishScenarioVersion(context, graph);
    assert.equal(record.status, "published");
  });

  it("AT-DRIFT-002 starts a version-pinned session and transitions deterministically", () => {
    const store = repo();
    publishScenarioVersion(store, context, graph);
    const session = createSession(store, context, "onboarding", "1.0.0", {
      locale: "ja",
      consent: "granted"
    });

    const event = processSessionEvent(store, context, session.sessionId, "goal_received", {
      goal: "build MVP"
    });
    const updated = store.sessions.get(session.sessionId);

    assert.equal(event.outcome, "transitioned");
    assert.equal(updated?.scenarioVersion, "1.0.0");
    assert.equal(updated?.currentSceneId, "plan");
    assert.equal(updated?.slots.goal, "build MVP");
  });

  it("AT-DRIFT-002B keeps published versions and active-session hashes immutable", () => {
    const store = repo();
    const published = publishScenarioVersion(store, context, graph);
    const session = createSession(store, context, "onboarding", "1.0.0", { locale: "ja" });
    const modified: ScenarioGraph = {
      ...graph,
      scenes: graph.scenes.map((scene) =>
        scene.id === "start" ? { ...scene, context: { ...scene.context, instructions: ["Changed after publish."] } } : scene
      )
    };

    assert.throws(
      () => publishScenarioVersion(store, context, modified),
      (error: unknown) => error instanceof DriftError && error.code === "VERSION_CONFLICT"
    );
    assert.equal(store.scenarios.get("tenant_a:onboarding:1.0.0")?.graph.scenes[0]?.context.instructions[0], "Ask for the user's goal.");
    assert.equal(store.sessions.get(session.sessionId)?.scenarioContentHash, published.contentHash);
  });

  it("AT-DRIFT-003 leaves state unchanged when guard evaluation fails", () => {
    const store = repo();
    publishScenarioVersion(store, context, graph);
    const session = createSession(store, context, "onboarding", "1.0.0", { locale: "ja" });

    const event = processSessionEvent(store, context, session.sessionId, "goal_received", {
      goal: "build MVP"
    });
    const updated = store.sessions.get(session.sessionId);

    assert.equal(event.outcome, "guard_failed");
    assert.equal(event.reasonCode, "CONSENT_REQUIRED");
    assert.equal(updated?.currentSceneId, "start");
    assert.equal(updated?.slots.goal, undefined);
  });

  it("AT-DRIFT-004 returns only the current scene's required slots in context pack", () => {
    const store = repo();
    publishScenarioVersion(store, context, graph);
    const session = createSession(store, context, "onboarding", "1.0.0", {
      locale: "ja",
      consent: "granted",
      private_note: "do not include"
    });

    processSessionEvent(store, context, session.sessionId, "goal_received", {
      goal: "build MVP"
    });
    const pack = getContextPack(store, context, session.sessionId);

    assert.equal(pack.sceneId, "plan");
    assert.deepEqual(pack.slots, { locale: "ja", goal: "build MVP" });
    assert.deepEqual(pack.artifactReferences, [
      {
        artifactId: "aster_context_plan",
        artifactVersion: "1.0.0",
        producer: "aster",
        schemaVersion: "aster.drift-reference/1",
        compilerVersion: ASTER_COMPILER_VERSION,
        digestAlgorithm: "sha256",
        contentHash: PLAN_HASH
      }
    ]);
    assert.equal(Object.hasOwn(pack.slots, "private_note"), false);
  });

  it("AT-DRIFT-005 replays an event stream to the same end state", () => {
    const store = repo();
    publishScenarioVersion(store, context, graph);
    const session = createSession(store, context, "onboarding", "1.0.0", {
      locale: "ja",
      consent: "granted"
    });

    processSessionEvent(store, context, session.sessionId, "goal_received", { goal: "build MVP" });
    processSessionEvent(store, context, session.sessionId, "accepted");

    const updated = store.sessions.get(session.sessionId);
    const replayed = replaySession(
      graph,
      { locale: "ja", consent: "granted" },
      store.events
    );

    assert.equal(updated?.currentSceneId, "done");
    assert.equal(replayed.currentSceneId, "done");
    assert.deepEqual(replayed.slots, { locale: "ja", consent: "granted", goal: "build MVP" });
    assert.equal(replayed.status, "ended");
    assert.equal(replayed.sequence, 2);
  });

  it("AT-DRIFT-005B rejects non-contiguous replay event logs", () => {
    assert.throws(
      () =>
        replaySession(graph, { locale: "ja", consent: "granted" }, [
          {
            sequence: 2,
            eventType: "goal_received",
            slotUpdates: { goal: "build MVP" }
          }
        ]),
      (error: unknown) =>
        error instanceof DriftError &&
        error.code === "VALIDATION_FAILED" &&
        error.message.includes("sequence")
    );
  });

  it("AT-DRIFT-006 denies cross-tenant session access", () => {
    const store = repo();
    publishScenarioVersion(store, context, graph);
    const session = createSession(store, context, "onboarding", "1.0.0", {
      locale: "ja",
      consent: "granted"
    });
    const wrongTenant: TenantContext = {
      tenantId: "tenant_b",
      actorId: "actor_2",
      allowedTenantIds: ["tenant_b"],
      correlationId: "corr_wrong"
    };

    assert.throws(
      () => getContextPack(store, wrongTenant, session.sessionId),
      (error: unknown) => error instanceof DriftError && error.code === "TENANT_SCOPE_DENIED"
    );
  });

  it("AT-DRIFT-007 applies idempotency to side-effecting session events", () => {
    const store = repo();
    publishScenarioVersion(store, context, graph, {
      idempotencyKey: "publish-1",
      reasonCode: "test"
    });
    const session = createSession(
      store,
      context,
      "onboarding",
      "1.0.0",
      {
        locale: "ja",
        consent: "granted"
      },
      {
        idempotencyKey: "session-1",
        reasonCode: "test"
      }
    );

    const first = processSessionEvent(
      store,
      context,
      session.sessionId,
      "goal_received",
      { goal: "build MVP" },
      {
        idempotencyKey: "event-1",
        reasonCode: "test"
      }
    );
    const second = processSessionEvent(
      store,
      context,
      session.sessionId,
      "goal_received",
      { goal: "build MVP" },
      {
        idempotencyKey: "event-1",
        reasonCode: "test"
      }
    );

    assert.deepEqual(second, first);
    assert.equal(store.events.length, 1);
    assert.equal(
      store.auditEvents.filter((event) => event.action === "session_event.transitioned").length,
      1
    );
    assert.equal(
      store.outboxEvents.filter((event) => event.eventType === "drift.session_event.transitioned.v1").length,
      1
    );
  });

  it("AT-DRIFT-008 rejects idempotency key reuse with different operation payload", () => {
    const store = repo();
    publishScenarioVersion(store, context, graph, {
      idempotencyKey: "publish-1",
      reasonCode: "test"
    });
    const session = createSession(
      store,
      context,
      "onboarding",
      "1.0.0",
      {
        locale: "ja",
        consent: "granted"
      },
      {
        idempotencyKey: "session-1",
        reasonCode: "test"
      }
    );

    processSessionEvent(
      store,
      context,
      session.sessionId,
      "goal_received",
      { goal: "build MVP" },
      {
        idempotencyKey: "event-1",
        reasonCode: "test"
      }
    );

    assert.throws(
      () =>
        processSessionEvent(
          store,
          context,
          session.sessionId,
          "goal_received",
          { goal: "different goal" },
          {
            idempotencyKey: "event-1",
            reasonCode: "test"
          }
        ),
      (error: unknown) => error instanceof DriftError && error.code === "IDEMPOTENCY_CONFLICT"
    );
    assert.equal(store.events.length, 1);
  });
});
