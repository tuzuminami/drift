import { randomUUID } from "node:crypto";
import { DriftError, assertTenantAccess, type TenantContext } from "./persona-contract.js";

export interface SceneDefinition {
  readonly id: string;
  readonly kind: "start" | "normal" | "terminal";
  readonly context: {
    readonly instructions: readonly string[];
    readonly requiredSlots: readonly string[];
    readonly policyReferences: readonly string[];
  };
}

export interface TransitionDefinition {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly eventType: string;
  readonly guard?: {
    readonly slotEquals: Record<string, string>;
    readonly reasonCode: string;
  };
}

export interface ScenarioGraph {
  readonly scenarioId: string;
  readonly version: string;
  readonly scenes: readonly SceneDefinition[];
  readonly transitions: readonly TransitionDefinition[];
}

export interface ScenarioVersionRecord {
  readonly tenantId: string;
  readonly graph: ScenarioGraph;
  readonly status: "draft" | "published";
  readonly versionNumber: number;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly currentSceneId: string;
  readonly slots: Readonly<Record<string, string>>;
  readonly status: "active" | "ended";
  readonly sequence: number;
  readonly versionNumber: number;
}

export interface SessionEventRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly transitionId?: string;
  readonly fromSceneId: string;
  readonly toSceneId: string;
  readonly outcome: "transitioned" | "guard_failed";
  readonly reasonCode?: string;
}

export interface ContextPack {
  readonly sessionId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly sceneId: string;
  readonly instructions: readonly string[];
  readonly slots: Readonly<Record<string, string>>;
  readonly policyReferences: readonly string[];
  readonly provenance: {
    readonly sequence: number;
    readonly correlationId: string;
  };
}

export interface ScenarioRepository {
  scenarios: Map<string, ScenarioVersionRecord>;
  sessions: Map<string, SessionRecord>;
  events: SessionEventRecord[];
  idempotencyKeys: Map<string, unknown>;
  auditEvents: AuditEventRecord[];
  outboxEvents: OutboxEventRecord[];
}

export interface MutationMetadata {
  readonly idempotencyKey: string;
  readonly reasonCode: string;
}

export interface AuditEventRecord {
  readonly auditId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly subjectId: string;
  readonly reasonCode: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export interface OutboxEventRecord {
  readonly eventId: string;
  readonly tenantId: string;
  readonly eventType: string;
  readonly subjectId: string;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

export function validateScenarioGraph(graph: ScenarioGraph): void {
  const errors: string[] = [];
  const sceneIds = new Set<string>();
  const startScenes = graph.scenes.filter((scene) => scene.kind === "start");
  if (startScenes.length !== 1) {
    errors.push("scenario must have exactly one start scene");
  }

  for (const scene of graph.scenes) {
    if (sceneIds.has(scene.id)) {
      errors.push(`duplicate scene id: ${scene.id}`);
    }
    sceneIds.add(scene.id);
  }

  for (const transition of graph.transitions) {
    if (!sceneIds.has(transition.from)) {
      errors.push(`transition ${transition.id} has unknown from scene`);
    }
    if (!sceneIds.has(transition.to)) {
      errors.push(`transition ${transition.id} has unknown to scene`);
    }
  }

  if (startScenes[0]) {
    const reachable = reachableScenes(startScenes[0].id, graph.transitions);
    for (const scene of graph.scenes) {
      if (!reachable.has(scene.id)) {
        errors.push(`unreachable scene: ${scene.id}`);
      }
    }
  }

  const terminalScenes = graph.scenes.filter((scene) => scene.kind === "terminal");
  if (terminalScenes.length === 0) {
    errors.push("scenario must have at least one terminal scene");
  }

  for (const scene of graph.scenes) {
    if (scene.kind !== "terminal" && !hasPathToTerminal(scene.id, graph, new Set())) {
      errors.push(`scene cannot reach terminal scene: ${scene.id}`);
    }
  }

  if (errors.length > 0) {
    throw new DriftError("VALIDATION_FAILED", errors.join("; "));
  }
}

export function publishScenarioVersion(
  repo: ScenarioRepository,
  context: TenantContext,
  graph: ScenarioGraph,
  metadata?: MutationMetadata
): ScenarioVersionRecord {
  assertTenantAccess(context, context.tenantId);
  const cached = getIdempotentResult<ScenarioVersionRecord>(repo, context, metadata);
  if (cached) return cached;

  validateScenarioGraph(graph);
  const key = scenarioKey(context.tenantId, graph.scenarioId, graph.version);
  const record: ScenarioVersionRecord = {
    tenantId: context.tenantId,
    graph,
    status: "published",
    versionNumber: 1
  };
  repo.scenarios.set(key, record);
  appendAudit(repo, context, "scenario_version.published", `${graph.scenarioId}@${graph.version}`, metadata);
  appendOutbox(repo, context, "drift.scenario_version.published.v1", `${graph.scenarioId}@${graph.version}`, {
    scenarioId: graph.scenarioId,
    version: graph.version
  });
  setIdempotentResult(repo, context, metadata, record);
  return record;
}

export function createSession(
  repo: ScenarioRepository,
  context: TenantContext,
  scenarioId: string,
  scenarioVersion: string,
  slots: Readonly<Record<string, string>>,
  metadata?: MutationMetadata
): SessionRecord {
  assertTenantAccess(context, context.tenantId);
  const cached = getIdempotentResult<SessionRecord>(repo, context, metadata);
  if (cached) return cached;

  const scenario = getScenario(repo, context, scenarioId, scenarioVersion);
  const startScene = scenario.graph.scenes.find((scene) => scene.kind === "start");
  if (!startScene) {
    throw new DriftError("VALIDATION_FAILED", "Scenario has no start scene.");
  }

  const session: SessionRecord = {
    sessionId: `session_${randomUUID()}`,
    tenantId: context.tenantId,
    scenarioId,
    scenarioVersion,
    currentSceneId: startScene.id,
    slots,
    status: "active",
    sequence: 0,
    versionNumber: 1
  };
  repo.sessions.set(session.sessionId, session);
  appendAudit(repo, context, "session.created", session.sessionId, metadata);
  appendOutbox(repo, context, "drift.session.created.v1", session.sessionId, {
    scenarioId,
    scenarioVersion
  });
  setIdempotentResult(repo, context, metadata, session);
  return session;
}

export function processSessionEvent(
  repo: ScenarioRepository,
  context: TenantContext,
  sessionId: string,
  eventType: string,
  slotUpdates: Readonly<Record<string, string>> = {},
  metadata?: MutationMetadata
): SessionEventRecord {
  const cached = getIdempotentResult<SessionEventRecord>(repo, context, metadata);
  if (cached) return cached;

  const session = getSession(repo, context, sessionId);
  if (session.status !== "active") {
    throw new DriftError("VALIDATION_FAILED", "Session is not active.");
  }

  const scenario = getScenario(repo, context, session.scenarioId, session.scenarioVersion);
  const transition = scenario.graph.transitions.find(
    (candidate) => candidate.from === session.currentSceneId && candidate.eventType === eventType
  );
  if (!transition) {
    throw new DriftError("VALIDATION_FAILED", "Event is not permitted from the current scene.");
  }

  const nextSlots = { ...session.slots, ...slotUpdates };
  const guardFailure = evaluateGuard(transition, nextSlots);
  if (guardFailure) {
    const event: SessionEventRecord = {
      sessionId,
      tenantId: session.tenantId,
      sequence: session.sequence + 1,
      eventType,
      transitionId: transition.id,
      fromSceneId: session.currentSceneId,
      toSceneId: session.currentSceneId,
      outcome: "guard_failed",
      reasonCode: guardFailure
    };
    repo.events.push(event);
    repo.sessions.set(sessionId, {
      ...session,
      sequence: session.sequence + 1,
      versionNumber: session.versionNumber + 1
    });
    appendAudit(repo, context, "session_event.guard_failed", sessionId, metadata);
    appendOutbox(repo, context, "drift.session_event.guard_failed.v1", sessionId, {
      eventType,
      reasonCode: guardFailure,
      sequence: event.sequence
    });
    setIdempotentResult(repo, context, metadata, event);
    return event;
  }

  const targetScene = scenario.graph.scenes.find((scene) => scene.id === transition.to);
  if (!targetScene) {
    throw new DriftError("VALIDATION_FAILED", "Transition target is missing.");
  }

  const updated: SessionRecord = {
    ...session,
    currentSceneId: transition.to,
    slots: nextSlots,
    status: targetScene.kind === "terminal" ? "ended" : "active",
    sequence: session.sequence + 1,
    versionNumber: session.versionNumber + 1
  };
  repo.sessions.set(sessionId, updated);
  const event: SessionEventRecord = {
    sessionId,
    tenantId: session.tenantId,
    sequence: updated.sequence,
    eventType,
    transitionId: transition.id,
    fromSceneId: session.currentSceneId,
    toSceneId: transition.to,
    outcome: "transitioned"
  };
  repo.events.push(event);
  appendAudit(repo, context, "session_event.transitioned", sessionId, metadata);
  appendOutbox(repo, context, "drift.session_event.transitioned.v1", sessionId, {
    eventType,
    fromSceneId: event.fromSceneId,
    toSceneId: event.toSceneId,
    sequence: event.sequence
  });
  setIdempotentResult(repo, context, metadata, event);
  return event;
}

export function getContextPack(
  repo: ScenarioRepository,
  context: TenantContext,
  sessionId: string
): ContextPack {
  const session = getSession(repo, context, sessionId);
  const scenario = getScenario(repo, context, session.scenarioId, session.scenarioVersion);
  const scene = scenario.graph.scenes.find((candidate) => candidate.id === session.currentSceneId);
  if (!scene) {
    throw new DriftError("VALIDATION_FAILED", "Current scene is missing.");
  }

  const minimalSlots = Object.fromEntries(
    scene.context.requiredSlots
      .filter((slotName) => session.slots[slotName] !== undefined)
      .map((slotName) => [slotName, session.slots[slotName] as string])
  );

  return {
    sessionId,
    scenarioId: session.scenarioId,
    scenarioVersion: session.scenarioVersion,
    sceneId: session.currentSceneId,
    instructions: scene.context.instructions,
    slots: minimalSlots,
    policyReferences: scene.context.policyReferences,
    provenance: {
      sequence: session.sequence,
      correlationId: context.correlationId
    }
  };
}

export function replaySession(
  graph: ScenarioGraph,
  startSlots: Readonly<Record<string, string>>,
  events: readonly Pick<SessionEventRecord, "eventType" | "outcome" | "toSceneId">[]
): Pick<SessionRecord, "currentSceneId" | "slots" | "status" | "sequence"> {
  validateScenarioGraph(graph);
  const startScene = graph.scenes.find((scene) => scene.kind === "start");
  if (!startScene) {
    throw new DriftError("VALIDATION_FAILED", "Scenario has no start scene.");
  }

  let currentSceneId = startScene.id;
  for (const event of events) {
    if (event.outcome === "transitioned") {
      currentSceneId = event.toSceneId;
    }
  }

  const currentScene = graph.scenes.find((scene) => scene.id === currentSceneId);
  return {
    currentSceneId,
    slots: startSlots,
    status: currentScene?.kind === "terminal" ? "ended" : "active",
    sequence: events.length
  };
}

function getScenario(
  repo: ScenarioRepository,
  context: TenantContext,
  scenarioId: string,
  version: string
): ScenarioVersionRecord {
  const scenario = repo.scenarios.get(scenarioKey(context.tenantId, scenarioId, version));
  if (!scenario) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Scenario version was not found.");
  }
  assertTenantAccess(context, scenario.tenantId);
  return scenario;
}

function getSession(repo: ScenarioRepository, context: TenantContext, sessionId: string): SessionRecord {
  const session = repo.sessions.get(sessionId);
  if (!session) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Session was not found.");
  }
  assertTenantAccess(context, session.tenantId);
  return session;
}

function evaluateGuard(
  transition: TransitionDefinition,
  slots: Readonly<Record<string, string>>
): string | undefined {
  if (!transition.guard) {
    return undefined;
  }

  for (const [slotName, expected] of Object.entries(transition.guard.slotEquals)) {
    if (slots[slotName] !== expected) {
      return transition.guard.reasonCode;
    }
  }
  return undefined;
}

function reachableScenes(startSceneId: string, transitions: readonly TransitionDefinition[]): Set<string> {
  const seen = new Set<string>([startSceneId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of transitions) {
      if (seen.has(transition.from) && !seen.has(transition.to)) {
        seen.add(transition.to);
        changed = true;
      }
    }
  }
  return seen;
}

function hasPathToTerminal(sceneId: string, graph: ScenarioGraph, visited: Set<string>): boolean {
  const scene = graph.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    return false;
  }
  if (scene.kind === "terminal") {
    return true;
  }
  if (visited.has(sceneId)) {
    return false;
  }
  visited.add(sceneId);

  return graph.transitions
    .filter((transition) => transition.from === sceneId)
    .some((transition) => hasPathToTerminal(transition.to, graph, new Set(visited)));
}

function scenarioKey(tenantId: string, scenarioId: string, version: string): string {
  return `${tenantId}:${scenarioId}:${version}`;
}

function getIdempotentResult<T>(
  repo: ScenarioRepository,
  context: TenantContext,
  metadata: MutationMetadata | undefined
): T | undefined {
  if (!metadata) return undefined;
  return repo.idempotencyKeys.get(idempotencyKey(context.tenantId, metadata.idempotencyKey)) as T | undefined;
}

function setIdempotentResult(
  repo: ScenarioRepository,
  context: TenantContext,
  metadata: MutationMetadata | undefined,
  value: unknown
): void {
  if (!metadata) return;
  repo.idempotencyKeys.set(idempotencyKey(context.tenantId, metadata.idempotencyKey), value);
}

function appendAudit(
  repo: ScenarioRepository,
  context: TenantContext,
  action: string,
  subjectId: string,
  metadata: MutationMetadata | undefined
): void {
  repo.auditEvents.push({
    auditId: `audit_${randomUUID()}`,
    tenantId: context.tenantId,
    actorId: context.actorId,
    action,
    subjectId,
    reasonCode: metadata?.reasonCode ?? "unspecified",
    correlationId: context.correlationId,
    occurredAt: new Date().toISOString()
  });
}

function appendOutbox(
  repo: ScenarioRepository,
  context: TenantContext,
  eventType: string,
  subjectId: string,
  payload: Readonly<Record<string, string | number | boolean>>
): void {
  repo.outboxEvents.push({
    eventId: `outbox_${randomUUID()}`,
    tenantId: context.tenantId,
    eventType,
    subjectId,
    correlationId: context.correlationId,
    payload
  });
}

function idempotencyKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`;
}
