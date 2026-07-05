import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DriftError,
  createSession,
  getContextPack,
  processSessionEvent,
  publishScenarioVersion,
  replaySession,
  validateScenarioGraph,
  type ScenarioGraph,
  type ScenarioRepository,
  type TenantContext
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
            contentHash: "sha256:start",
            producer: "aster-compatible"
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
            contentHash: "sha256:plan",
            producer: "aster-compatible"
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
        contentHash: "sha256:plan",
        producer: "aster-compatible"
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
      { locale: "ja", consent: "granted", goal: "build MVP" },
      store.events
    );

    assert.equal(updated?.currentSceneId, "done");
    assert.equal(replayed.currentSceneId, "done");
    assert.equal(replayed.status, "ended");
    assert.equal(replayed.sequence, 2);
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
