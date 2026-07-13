export type { TenantContext } from "./core.js";

export { DriftError, assertTenantAccess } from "./core.js";

export type {
  AsyncVerifiedCompiledArtifactResolver,
  CompiledArtifactLocator,
  ResolvedCompiledArtifact,
  VerifiedCompiledArtifactResolver
} from "./artifact.js";
export {
  ASTER_ARTIFACT_SCHEMA_VERSION,
  assertArtifactReferencesResolved,
  assertArtifactReferencesResolvedAsync,
  validateCompiledArtifactReferences
} from "./artifact.js";

export type {
  CompiledArtifactReference,
  ContextPack,
  MutationMetadata,
  ScenarioGraph,
  ScenarioRepository,
  ScenarioVersionRecord,
  SceneDefinition,
  SessionEventRecord,
  SessionRecord,
  TransitionDefinition
} from "./scenario.js";

export {
  createSession,
  getContextPack,
  processSessionEvent,
  publishScenarioVersion,
  publishScenarioVersionAsync,
  replaySession,
  validateScenarioGraph
} from "./scenario.js";

export type { DriftHttpRequest, DriftHttpResponse } from "./http.js";

export { createDriftAsyncHttpHandler, createDriftHttpHandler } from "./http.js";

export { createInMemoryScenarioRepository } from "./repository.js";

export type { DriftClient, DriftClientConfig, DriftFetchInit, DriftFetchResponse, FetchLike } from "./client.js";

export { DriftClientError, createDriftClient } from "./client.js";

export type { DriftCliIO, DriftCliOptions, WritableText } from "./cli.js";

export { runDriftCli } from "./cli.js";

export type { AuthAdapter, SyncAuthAdapter } from "./auth.js";

export {
  authenticateDevelopmentBearer,
  createDevelopmentAuthAdapter,
  createDevelopmentSyncAuthAdapter
} from "./auth.js";

export type { ScenarioStore } from "./store.js";

export { createInMemoryScenarioStore } from "./store.js";

export type { SafeLogEvent, SafeLogger } from "./observability.js";

export { createInMemoryLogger, createJsonStderrLogger } from "./observability.js";

export type { Plugin, PluginContext, PluginHealth, PluginHost } from "./plugin.js";

export { DRIFT_PLUGIN_CORE_API_VERSION, createNoopPlugin, createPluginHost } from "./plugin.js";

export type { DriftServerRuntime, ServerConfig, ServerRuntimeOptions } from "./server.js";

export {
  createDriftNodeServer,
  createOperationalHandler,
  createOperationalAsyncHandler,
  createServerRuntime,
  createServerConfig,
  startDriftServer
} from "./server.js";

export type { PostgresMigrationOptions, PostgresScenarioStore } from "./postgres.js";

export {
  createPostgresPool,
  createPostgresScenarioStore,
  runPostgresMigrations
} from "./postgres.js";
