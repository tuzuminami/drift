import {
  createSession,
  getContextPack,
  processSessionEvent,
  publishScenarioVersion,
  publishScenarioVersionAsync,
  type ContextPack,
  type MutationMetadata,
  type ScenarioGraph,
  type ScenarioRepository,
  type ScenarioVersionRecord,
  type SessionEventRecord,
  type SessionRecord
} from "./scenario.js";
import type { TenantContext } from "./core.js";
import { createInMemoryScenarioRepository } from "./repository.js";
import type { AsyncVerifiedCompiledArtifactResolver } from "./artifact.js";

export interface ScenarioStore {
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
}

export function createInMemoryScenarioStore(
  repo: ScenarioRepository = createInMemoryScenarioRepository(),
  artifactResolver?: AsyncVerifiedCompiledArtifactResolver
): ScenarioStore {
  return {
    async checkReadiness() {
      return undefined;
    },
    async publishScenarioVersion(context, graph, metadata) {
      return artifactResolver
        ? publishScenarioVersionAsync(repo, context, graph, artifactResolver, metadata)
        : publishScenarioVersion(repo, context, graph, metadata);
    },
    async createSession(context, scenarioId, scenarioVersion, slots, metadata) {
      return createSession(repo, context, scenarioId, scenarioVersion, slots, metadata);
    },
    async processSessionEvent(context, sessionId, eventType, slotUpdates = {}, metadata) {
      return processSessionEvent(repo, context, sessionId, eventType, slotUpdates, metadata);
    },
    async getContextPack(context, sessionId) {
      return getContextPack(repo, context, sessionId);
    }
  };
}
