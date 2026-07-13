import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import { DriftError, assertTenantAccess, type TenantContext } from "./core.js";
import type { AsyncVerifiedCompiledArtifactResolver } from "./artifact.js";
import { createInMemoryScenarioRepository } from "./repository.js";
import {
  createSession,
  getContextPack,
  processSessionEvent,
  publishScenarioVersion,
  publishScenarioVersionAsync,
  validateScenarioGraph,
  type AuditEventRecord,
  type CompiledArtifactReference,
  type ContextPack,
  type IdempotencyRecord,
  type MutationMetadata,
  type OutboxEventRecord,
  type ScenarioGraph,
  type ScenarioRepository,
  type ScenarioVersionRecord,
  type SessionEventRecord,
  type SessionRecord
} from "./scenario.js";

export interface PostgresMigrationOptions {
  readonly migrationsDirectory?: string;
}

export interface PostgresScenarioStore {
  checkReadiness(): Promise<void>;
  publishScenarioVersion(
    context: TenantContext,
    graph: ScenarioGraph,
    metadata?: MutationMetadata
  ): Promise<ScenarioVersionRecord>;
  createSession(
    context: TenantContext,
    scenarioId: string,
    scenarioVersion: string,
    slots: Readonly<Record<string, string>>,
    metadata?: MutationMetadata
  ): Promise<SessionRecord>;
  processSessionEvent(
    context: TenantContext,
    sessionId: string,
    eventType: string,
    slotUpdates?: Readonly<Record<string, string>>,
    metadata?: MutationMetadata
  ): Promise<SessionEventRecord>;
  getContextPack(context: TenantContext, sessionId: string): Promise<ContextPack>;
  close(): Promise<void>;
}

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>>;
}

interface ScenarioVersionRow extends QueryResultRow {
  readonly tenant_id: string;
  readonly scenario_id: string;
  readonly scenario_version: string;
  readonly status: "draft" | "published";
  readonly graph_json: unknown;
  readonly version_number: number;
}

interface SessionRow extends QueryResultRow {
  readonly tenant_id: string;
  readonly session_id: string;
  readonly scenario_id: string;
  readonly scenario_version: string;
  readonly current_scene_id: string;
  readonly slots_json: unknown;
  readonly status: "active" | "ended";
  readonly sequence_number: number;
  readonly version_number: number;
}

interface IdempotencyRow extends QueryResultRow {
  readonly operation_hash: string;
  readonly response_json: unknown;
}

export function createPostgresPool(config: string | PoolConfig): Pool {
  if (typeof config === "string") {
    return new Pool({ connectionString: config });
  }
  return new Pool(config);
}

export function createPostgresScenarioStore(
  pool: Pool,
  artifactResolver?: AsyncVerifiedCompiledArtifactResolver
): PostgresScenarioStore {
  return new NodePostgresScenarioStore(pool, artifactResolver);
}

export async function runPostgresMigrations(
  pool: Pool,
  options: PostgresMigrationOptions = {}
): Promise<readonly string[]> {
  const migrationsDirectory = options.migrationsDirectory ?? join(process.cwd(), "migrations");
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new DriftError("CONFIGURATION_INVALID", "No PostgreSQL migrations were found.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied: string[] = [];
    for (const file of files) {
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      const checksum = await sha256(sql);
      const existing = await client.query<{ readonly checksum_sha256: string }>(
        "SELECT checksum_sha256 FROM schema_migrations WHERE filename = $1",
        [file]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum_sha256 !== checksum) {
          throw new DriftError("VERSION_CONFLICT", `Migration checksum changed: ${file}.`);
        }
        continue;
      }

      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum_sha256) VALUES ($1, $2)",
        [file, checksum]
      );
      applied.push(file);
    }

    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

class NodePostgresScenarioStore implements PostgresScenarioStore {
  public constructor(
    private readonly pool: Pool,
    private readonly artifactResolver?: AsyncVerifiedCompiledArtifactResolver
  ) {}

  public async checkReadiness(): Promise<void> {
    await assertPostgresSchemaReady(this.pool);
  }

  public async publishScenarioVersion(
    context: TenantContext,
    graph: ScenarioGraph,
    metadata?: MutationMetadata
  ): Promise<ScenarioVersionRecord> {
    assertTenantAccess(context, context.tenantId);
    return this.transaction(async (client) => {
      const repo = createInMemoryScenarioRepository();
      await hydrateIdempotency(client, repo, context, metadata);
      const record = this.artifactResolver
        ? await publishScenarioVersionAsync(repo, context, graph, this.artifactResolver, metadata)
        : publishScenarioVersion(repo, context, graph, metadata);
      if (repo.scenarios.has(scenarioKey(context.tenantId, graph.scenarioId, graph.version))) {
        await insertScenarioVersion(client, context, record);
        await flushSideEffects(client, repo, context);
      }
      return record;
    });
  }

  public async createSession(
    context: TenantContext,
    scenarioId: string,
    scenarioVersion: string,
    slots: Readonly<Record<string, string>>,
    metadata?: MutationMetadata
  ): Promise<SessionRecord> {
    assertTenantAccess(context, context.tenantId);
    return this.transaction(async (client) => {
      const repo = createInMemoryScenarioRepository();
      await hydrateIdempotency(client, repo, context, metadata);
      await hydrateScenario(client, repo, context, scenarioId, scenarioVersion);
      const session = createSession(repo, context, scenarioId, scenarioVersion, slots, metadata);
      if (repo.sessions.has(session.sessionId)) {
        await insertSession(client, context, session);
        await flushSideEffects(client, repo, context);
      }
      return session;
    });
  }

  public async processSessionEvent(
    context: TenantContext,
    sessionId: string,
    eventType: string,
    slotUpdates: Readonly<Record<string, string>> = {},
    metadata?: MutationMetadata
  ): Promise<SessionEventRecord> {
    assertTenantAccess(context, context.tenantId);
    return this.transaction(async (client) => {
      const repo = createInMemoryScenarioRepository();
      await hydrateIdempotency(client, repo, context, metadata);
      const session = await hydrateSession(client, repo, context, sessionId, true);
      await hydrateScenario(client, repo, context, session.scenarioId, session.scenarioVersion);
      const eventCount = repo.events.length;
      const event = processSessionEvent(repo, context, sessionId, eventType, slotUpdates, metadata);
      if (repo.events.length === eventCount) {
        return event;
      }
      const updated = repo.sessions.get(sessionId);
      if (!updated) {
        throw new DriftError("RESOURCE_NOT_FOUND", "Session was not found.");
      }
      await updateSession(client, context, updated);
      await insertSessionEvent(client, context, event);
      await flushSideEffects(client, repo, context);
      return event;
    });
  }

  public async getContextPack(context: TenantContext, sessionId: string): Promise<ContextPack> {
    assertTenantAccess(context, context.tenantId);
    const repo = createInMemoryScenarioRepository();
    const session = await hydrateSession(this.pool, repo, context, sessionId, false);
    await hydrateScenario(this.pool, repo, context, session.scenarioId, session.scenarioVersion);
    return getContextPack(repo, context, sessionId);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function assertPostgresSchemaReady(queryable: Queryable): Promise<void> {
  const result = await queryable.query<{ readonly exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'session_events'
          AND column_name = 'slot_updates_json'
     ) AS exists`
  );
  if (result.rows[0]?.exists !== true) {
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "PostgreSQL schema is not ready.");
  }
}

async function hydrateIdempotency(
  client: Queryable,
  repo: ScenarioRepository,
  context: TenantContext,
  metadata: MutationMetadata | undefined
): Promise<void> {
  if (!metadata) return;
  const result = await client.query<IdempotencyRow>(
    `SELECT operation_hash, response_json
       FROM idempotency_records
      WHERE tenant_id = $1 AND idempotency_key = $2
      FOR UPDATE`,
    [context.tenantId, metadata.idempotencyKey]
  );
  const row = result.rows[0];
  if (!row) return;
  repo.idempotencyKeys.set(idempotencyKey(context.tenantId, metadata.idempotencyKey), {
    operationHash: row.operation_hash,
    result: row.response_json
  });
}

async function hydrateScenario(
  client: Queryable,
  repo: ScenarioRepository,
  context: TenantContext,
  scenarioId: string,
  version: string
): Promise<ScenarioVersionRecord> {
  const result = await client.query<ScenarioVersionRow>(
    `SELECT tenant_id, scenario_id, scenario_version, status, graph_json, version_number
       FROM scenario_versions
      WHERE tenant_id = $1 AND scenario_id = $2 AND scenario_version = $3`,
    [context.tenantId, scenarioId, version]
  );
  const row = result.rows[0];
  if (!row) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Scenario version was not found.");
  }
  const record = scenarioRecordFromRow(row);
  repo.scenarios.set(scenarioKey(context.tenantId, scenarioId, version), record);
  return record;
}

async function hydrateSession(
  client: Queryable,
  repo: ScenarioRepository,
  context: TenantContext,
  sessionId: string,
  forUpdate: boolean
): Promise<SessionRecord> {
  const result = await client.query<SessionRow>(
    `SELECT tenant_id, session_id, scenario_id, scenario_version, current_scene_id,
            slots_json, status, sequence_number, version_number
       FROM sessions
      WHERE tenant_id = $1 AND session_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
    [context.tenantId, sessionId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Session was not found.");
  }
  const record = sessionRecordFromRow(row);
  repo.sessions.set(sessionId, record);
  return record;
}

async function insertScenarioVersion(
  client: Queryable,
  context: TenantContext,
  record: ScenarioVersionRecord
): Promise<void> {
  await client.query(
    `INSERT INTO scenario_versions (
       tenant_id, scenario_id, scenario_version, status, graph_json,
       created_by, updated_at, version_number, correlation_id
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, now(), $7, $8)
     ON CONFLICT (tenant_id, scenario_id, scenario_version)
     DO UPDATE SET
       status = EXCLUDED.status,
       graph_json = EXCLUDED.graph_json,
       updated_at = now(),
       version_number = scenario_versions.version_number + 1,
       correlation_id = EXCLUDED.correlation_id
     WHERE scenario_versions.tenant_id = $1
       AND scenario_versions.scenario_id = $2
       AND scenario_versions.scenario_version = $3`,
    [
      context.tenantId,
      record.graph.scenarioId,
      record.graph.version,
      record.status,
      JSON.stringify(record.graph),
      context.actorId,
      record.versionNumber,
      context.correlationId
    ]
  );
}

async function insertSession(
  client: Queryable,
  context: TenantContext,
  session: SessionRecord
): Promise<void> {
  await client.query(
    `INSERT INTO sessions (
       tenant_id, session_id, scenario_id, scenario_version, current_scene_id,
       slots_json, status, sequence_number, created_by, version_number, correlation_id
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      context.tenantId,
      session.sessionId,
      session.scenarioId,
      session.scenarioVersion,
      session.currentSceneId,
      JSON.stringify(session.slots),
      session.status,
      session.sequence,
      context.actorId,
      session.versionNumber,
      context.correlationId
    ]
  );
}

async function updateSession(
  client: Queryable,
  context: TenantContext,
  session: SessionRecord
): Promise<void> {
  const result = await client.query(
    `UPDATE sessions
        SET current_scene_id = $3,
            slots_json = $4::jsonb,
            status = $5,
            sequence_number = $6,
            updated_at = now(),
            version_number = version_number + 1,
            correlation_id = $7
      WHERE tenant_id = $1 AND session_id = $2`,
    [
      context.tenantId,
      session.sessionId,
      session.currentSceneId,
      JSON.stringify(session.slots),
      session.status,
      session.sequence,
      context.correlationId
    ]
  );
  if (result.rowCount !== 1) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Session was not found.");
  }
}

async function insertSessionEvent(
  client: Queryable,
  context: TenantContext,
  event: SessionEventRecord
): Promise<void> {
  await client.query(
    `INSERT INTO session_events (
       tenant_id, session_id, sequence_number, event_type, transition_id,
       from_scene_id, to_scene_id, outcome, reason_code, correlation_id, slot_updates_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      context.tenantId,
      event.sessionId,
      event.sequence,
      event.eventType,
      event.transitionId ?? null,
      event.fromSceneId,
      event.toSceneId,
      event.outcome,
      event.reasonCode ?? null,
      context.correlationId,
      JSON.stringify(event.slotUpdates)
    ]
  );
}

async function flushSideEffects(
  client: Queryable,
  repo: ScenarioRepository,
  context: TenantContext
): Promise<void> {
  for (const [key, record] of repo.idempotencyKeys.entries()) {
    const prefix = `${context.tenantId}:`;
    if (!key.startsWith(prefix)) continue;
    await insertIdempotency(client, context, key.slice(prefix.length), record);
  }
  for (const event of repo.auditEvents) {
    await insertAuditEvent(client, context, event);
  }
  for (const event of repo.outboxEvents) {
    await insertOutboxEvent(client, context, event);
  }
}

async function insertIdempotency(
  client: Queryable,
  context: TenantContext,
  key: string,
  record: IdempotencyRecord
): Promise<void> {
  const result = await client.query(
    `INSERT INTO idempotency_records (
       tenant_id, idempotency_key, operation_hash, response_json
     )
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant_id, idempotency_key)
     DO UPDATE SET response_json = EXCLUDED.response_json
     WHERE idempotency_records.tenant_id = $1
       AND idempotency_records.idempotency_key = $2
       AND idempotency_records.operation_hash = EXCLUDED.operation_hash`,
    [context.tenantId, key, record.operationHash, JSON.stringify(record.result)]
  );
  if (result.rowCount !== 1) {
    throw new DriftError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was already used for a different operation."
    );
  }
}

async function insertAuditEvent(
  client: Queryable,
  context: TenantContext,
  event: AuditEventRecord
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (
       audit_id, tenant_id, actor_id, action, subject_id,
       reason_code, correlation_id, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.auditId,
      context.tenantId,
      event.actorId,
      event.action,
      event.subjectId,
      event.reasonCode,
      event.correlationId,
      event.occurredAt
    ]
  );
}

async function insertOutboxEvent(
  client: Queryable,
  context: TenantContext,
  event: OutboxEventRecord
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (
       event_id, tenant_id, event_type, subject_id, correlation_id, payload_json
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      event.eventId,
      context.tenantId,
      event.eventType,
      event.subjectId,
      event.correlationId,
      JSON.stringify(event.payload)
    ]
  );
}

function scenarioRecordFromRow(row: ScenarioVersionRow): ScenarioVersionRecord {
  const graph = parseScenarioGraph(row.graph_json);
  if (row.tenant_id.length === 0 || row.scenario_id !== graph.scenarioId || row.scenario_version !== graph.version) {
    throw new DriftError("VALIDATION_FAILED", "Scenario row is inconsistent.");
  }
  return {
    tenantId: row.tenant_id,
    graph,
    status: row.status,
    versionNumber: row.version_number
  };
}

function sessionRecordFromRow(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version,
    currentSceneId: row.current_scene_id,
    slots: parseStringRecord(row.slots_json, "slots_json"),
    status: row.status,
    sequence: row.sequence_number,
    versionNumber: row.version_number
  };
}

function parseScenarioGraph(value: unknown): ScenarioGraph {
  const object = parseObject(value, "graph_json");
  const graph: ScenarioGraph = {
    scenarioId: requireString(object, "scenarioId"),
    version: requireString(object, "version"),
    scenes: requireArray(object.scenes, "scenes").map((item): ScenarioGraph["scenes"][number] => {
      const scene = parseObject(item, "scene");
      const context = parseObject(scene.context, "scene.context");
      const kind = requireString(scene, "kind");
      if (kind !== "start" && kind !== "normal" && kind !== "terminal") {
        throw new DriftError("VALIDATION_FAILED", "Scenario scene kind is invalid.");
      }
      const sceneContext: ScenarioGraph["scenes"][number]["context"] = {
        instructions: parseStringArray(context.instructions, "instructions"),
        requiredSlots: parseStringArray(context.requiredSlots, "requiredSlots"),
        policyReferences: parseStringArray(context.policyReferences, "policyReferences")
      };
      return {
        id: requireString(scene, "id"),
        kind,
        context: context.artifactReferences === undefined
          ? sceneContext
          : { ...sceneContext, artifactReferences: parseArtifactReferences(context.artifactReferences) }
      };
    }),
    transitions: requireArray(object.transitions, "transitions").map((item) => {
      const transition = parseObject(item, "transition");
      const guard = transition.guard === undefined ? undefined : parseObject(transition.guard, "guard");
      return {
        id: requireString(transition, "id"),
        from: requireString(transition, "from"),
        to: requireString(transition, "to"),
        eventType: requireString(transition, "eventType"),
        ...(guard
          ? {
              guard: {
                slotEquals: parseStringRecord(guard.slotEquals, "slotEquals"),
                reasonCode: requireString(guard, "reasonCode")
              }
            }
          : {})
      };
    })
  };
  validateScenarioGraph(graph);
  return graph;
}

function parseArtifactReferences(value: unknown): readonly CompiledArtifactReference[] {
  return requireArray(value, "artifactReferences").map((item) => {
    const artifact = parseObject(item, "artifactReference");
    if (requireString(artifact, "producer") !== "aster") {
      throw new DriftError("VALIDATION_FAILED", "artifact producer must be aster.");
    }
    if (requireString(artifact, "schemaVersion") !== "aster.drift-reference/1") {
      throw new DriftError("VALIDATION_FAILED", "artifact schemaVersion is unsupported.");
    }
    if (requireString(artifact, "digestAlgorithm") !== "sha256") {
      throw new DriftError("VALIDATION_FAILED", "artifact digestAlgorithm must be sha256.");
    }
    const contentHash = requireString(artifact, "contentHash");
    if (!/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
      throw new DriftError("VALIDATION_FAILED", "artifact contentHash must be a SHA-256 digest.");
    }
    return {
      artifactId: requireString(artifact, "artifactId"),
      artifactVersion: requireString(artifact, "artifactVersion"),
      producer: "aster",
      schemaVersion: "aster.drift-reference/1",
      compilerVersion: requireString(artifact, "compilerVersion"),
      digestAlgorithm: "sha256",
      contentHash
    };
  });
}

function parseObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DriftError("VALIDATION_FAILED", `${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new DriftError("VALIDATION_FAILED", `${name} must be an array.`);
  }
  return value;
}

function requireString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DriftError("VALIDATION_FAILED", `${key} must be a non-empty string.`);
  }
  return value;
}

function parseStringArray(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DriftError("VALIDATION_FAILED", `${key} must be a string array.`);
  }
  return value;
}

function parseStringRecord(value: unknown, key: string): Readonly<Record<string, string>> {
  const object = parseObject(value, key);
  if (Object.values(object).some((nested) => typeof nested !== "string")) {
    throw new DriftError("VALIDATION_FAILED", `${key} values must be strings.`);
  }
  return Object.fromEntries(Object.entries(object)) as Readonly<Record<string, string>>;
}

function scenarioKey(tenantId: string, scenarioId: string, version: string): string {
  return `${tenantId}:${scenarioId}:${version}`;
}

function idempotencyKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`;
}

async function sha256(input: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(input).digest("hex");
}

async function runCli(): Promise<void> {
  if (process.argv[2] !== "migrate") return;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new DriftError("CONFIGURATION_INVALID", "DATABASE_URL is required for PostgreSQL migrations.");
  }
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true
  });
  try {
    const applied = await runPostgresMigrations(pool);
    process.stdout.write(`postgres migrations applied: ${applied.length}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown PostgreSQL migration error.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
