import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Pool } from "pg";
import {
  DriftError,
  createPostgresPool,
  createPostgresScenarioStore,
  runPostgresMigrations,
  type PostgresScenarioStore,
  type ScenarioGraph,
  type TenantContext
} from "../src/index.js";

const postgresUrl = process.env.DRIFT_POSTGRES_TEST_URL;
const integrationSkip = postgresUrl ? false : "Set DRIFT_POSTGRES_TEST_URL to run PostgreSQL integration tests.";

const context: TenantContext = {
  tenantId: "tenant_pg_a",
  actorId: "actor_pg_1",
  allowedTenantIds: ["tenant_pg_a"],
  correlationId: "corr_pg"
};

const graph: ScenarioGraph = {
  scenarioId: "postgres-onboarding",
  version: "1.0.0",
  scenes: [
    {
      id: "start",
      kind: "start",
      context: {
        instructions: ["Ask for the user's goal."],
        requiredSlots: ["locale"],
        policyReferences: ["policy://default/chat"]
      }
    },
    {
      id: "plan",
      kind: "normal",
      context: {
        instructions: ["Summarize the plan."],
        requiredSlots: ["locale", "goal"],
        policyReferences: ["policy://default/chat"]
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

describe("PostgreSQL scenario store", { skip: integrationSkip }, () => {
  let pool: Pool;
  let store: PostgresScenarioStore;

  before(async () => {
    assert.ok(postgresUrl);
    pool = createPostgresPool({
      connectionString: postgresUrl,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true
    });
    await resetDatabase(pool);
    await runPostgresMigrations(pool);
    store = createPostgresScenarioStore(pool);
  });

  after(async () => {
    await store?.close();
  });

  it("AT-PG-001 applies the initial migration into a fresh database", async () => {
    const tables = [
      "scenario_versions",
      "sessions",
      "session_events",
      "idempotency_records",
      "audit_events",
      "outbox_events",
      "schema_migrations"
    ];
    const result = await pool.query<{ readonly table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [tables]
    );

    assert.deepEqual(result.rows.map((row) => row.table_name), [...tables].sort());
  });

  it("AT-PG-002 persists scenario, session, audit, outbox, and idempotency atomically", async () => {
    await store.publishScenarioVersion(context, graph, {
      idempotencyKey: "publish-1",
      reasonCode: "test"
    });
    const session = await store.createSession(
      context,
      "postgres-onboarding",
      "1.0.0",
      { locale: "ja", consent: "granted", private_note: "exclude" },
      { idempotencyKey: "session-1", reasonCode: "test" }
    );
    const event = await store.processSessionEvent(
      context,
      session.sessionId,
      "goal_received",
      { goal: "ship 0.1" },
      { idempotencyKey: "event-1", reasonCode: "test" }
    );
    const replayed = await store.processSessionEvent(
      context,
      session.sessionId,
      "goal_received",
      { goal: "ship 0.1" },
      { idempotencyKey: "event-1", reasonCode: "test" }
    );
    const pack = await store.getContextPack(context, session.sessionId);

    assert.equal(event.outcome, "transitioned");
    assert.deepEqual(replayed, event);
    assert.deepEqual(pack.slots, { locale: "ja", goal: "ship 0.1" });
    assert.equal(await countRows(pool, "session_events", context.tenantId), 1);
    assert.equal(await countRows(pool, "audit_events", context.tenantId), 3);
    assert.equal(await countRows(pool, "outbox_events", context.tenantId), 3);
    assert.equal(await countRows(pool, "idempotency_records", context.tenantId), 3);
  });

  it("AT-PG-003 enforces tenant predicates and rejects idempotency conflicts", async () => {
    const session = await store.createSession(
      context,
      "postgres-onboarding",
      "1.0.0",
      { locale: "ja", consent: "granted" },
      { idempotencyKey: "session-2", reasonCode: "test" }
    );

    const wrongTenant: TenantContext = {
      tenantId: "tenant_pg_b",
      actorId: "actor_pg_2",
      allowedTenantIds: ["tenant_pg_b"],
      correlationId: "corr_pg_wrong"
    };

    await assert.rejects(
      () => store.getContextPack(wrongTenant, session.sessionId),
      (error: unknown) => error instanceof DriftError && error.code === "RESOURCE_NOT_FOUND"
    );

    await store.processSessionEvent(
      context,
      session.sessionId,
      "goal_received",
      { goal: "first" },
      { idempotencyKey: "event-2", reasonCode: "test" }
    );

    await assert.rejects(
      () =>
        store.processSessionEvent(
          context,
          session.sessionId,
          "goal_received",
          { goal: "different" },
          { idempotencyKey: "event-2", reasonCode: "test" }
        ),
      (error: unknown) => error instanceof DriftError && error.code === "IDEMPOTENCY_CONFLICT"
    );
  });
});

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    DROP TABLE IF EXISTS
      outbox_events,
      audit_events,
      idempotency_records,
      session_events,
      sessions,
      scenario_versions,
      schema_migrations
    CASCADE
  `);
}

async function countRows(pool: Pool, tableName: string, tenantId: string): Promise<number> {
  if (!/^[a-z_]+$/.test(tableName)) {
    throw new Error("Unsafe table name.");
  }
  const result = await pool.query<{ readonly count: string }>(
    `SELECT COUNT(*) AS count FROM ${tableName} WHERE tenant_id = $1`,
    [tenantId]
  );
  return Number(result.rows[0]?.count ?? "0");
}
