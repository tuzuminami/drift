import { createHash, randomUUID } from "node:crypto";

export interface TenantContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly allowedTenantIds: readonly string[];
  readonly correlationId: string;
}

export interface PersonaContract {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly behavior: {
    readonly voice: readonly string[];
    readonly boundaries: readonly string[];
  };
  readonly policyReferences: readonly string[];
  readonly pluginReferences?: readonly string[];
}

export interface PersonaVersionRecord {
  readonly personaId: string;
  readonly tenantId: string;
  readonly version: string;
  readonly status: "draft" | "published" | "deprecated";
  readonly contract: PersonaContract;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly versionNumber: number;
}

export interface CompileProvenance {
  readonly personaId: string;
  readonly personaVersion: string;
  readonly compilerVersion: string;
  readonly compiledAt: string;
  readonly sourceHash: string;
  readonly correlationId: string;
}

export interface CompiledBundle {
  readonly schemaVersion: "drift.compiled-persona.v1";
  readonly personaId: string;
  readonly personaVersion: string;
  readonly contentHash: string;
  readonly instructions: readonly string[];
  readonly policyReferences: readonly string[];
  readonly provenance: CompileProvenance;
}

export interface PersonaRepository {
  personas: Map<string, { tenantId: string; createdBy: string }>;
  versions: Map<string, PersonaVersionRecord>;
  auditEvents: Array<{
    readonly eventId: string;
    readonly tenantId: string;
    readonly actorId: string;
    readonly action: string;
    readonly subjectId: string;
    readonly correlationId: string;
    readonly occurredAt: string;
  }>;
}

export class DriftError extends Error {
  public constructor(
    public readonly code:
      | "AUTHENTICATION_REQUIRED"
      | "TENANT_SCOPE_DENIED"
      | "VALIDATION_FAILED"
      | "VERSION_CONFLICT"
      | "RESOURCE_NOT_FOUND",
    message: string
  ) {
    super(message);
  }
}

const COMPILER_VERSION = "drift-persona-compiler/0.1.0";

export function assertTenantAccess(context: TenantContext, tenantId: string): void {
  if (!context.actorId) {
    throw new DriftError("AUTHENTICATION_REQUIRED", "Authentication is required.");
  }

  if (!context.allowedTenantIds.includes(tenantId)) {
    throw new DriftError("TENANT_SCOPE_DENIED", "Request cannot access this tenant.");
  }
}

export function createPersona(repo: PersonaRepository, context: TenantContext): string {
  assertTenantAccess(context, context.tenantId);
  const personaId = `persona_${randomUUID()}`;
  repo.personas.set(personaId, { tenantId: context.tenantId, createdBy: context.actorId });
  audit(repo, context, "persona.created", personaId);
  return personaId;
}

export function createPersonaVersion(
  repo: PersonaRepository,
  context: TenantContext,
  personaId: string,
  contract: PersonaContract,
  now: string
): PersonaVersionRecord {
  const persona = repo.personas.get(personaId);
  if (!persona) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Persona was not found.");
  }
  assertTenantAccess(context, persona.tenantId);
  validateContract(contract);

  const key = versionKey(persona.tenantId, personaId, contract.version);
  const existing = repo.versions.get(key);
  if (existing?.status === "published") {
    throw new DriftError("VERSION_CONFLICT", "Published versions are immutable.");
  }

  const nextVersionNumber = existing ? existing.versionNumber + 1 : 1;
  const record: PersonaVersionRecord = {
    personaId,
    tenantId: persona.tenantId,
    version: contract.version,
    status: "draft",
    contract,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? context.actorId,
    updatedAt: now,
    versionNumber: nextVersionNumber
  };
  repo.versions.set(key, record);
  audit(repo, context, "persona_version.upserted", `${personaId}@${contract.version}`);
  return record;
}

export function publishPersonaVersion(
  repo: PersonaRepository,
  context: TenantContext,
  personaId: string,
  version: string,
  now: string
): PersonaVersionRecord {
  const record = getVersion(repo, context, personaId, version);
  if (record.status === "published") {
    return record;
  }

  const published: PersonaVersionRecord = {
    ...record,
    status: "published",
    updatedAt: now,
    versionNumber: record.versionNumber + 1
  };
  repo.versions.set(versionKey(record.tenantId, personaId, version), published);
  audit(repo, context, "persona_version.published", `${personaId}@${version}`);
  return published;
}

export function compilePersonaVersion(
  repo: PersonaRepository,
  context: TenantContext,
  personaId: string,
  version: string,
  compiledAt: string,
  enabledPlugins: readonly string[] = []
): CompiledBundle {
  const record = getVersion(repo, context, personaId, version);
  if (record.status !== "published") {
    throw new DriftError("VALIDATION_FAILED", "Only published persona versions can be compiled.");
  }

  for (const pluginReference of record.contract.pluginReferences ?? []) {
    if (!enabledPlugins.includes(pluginReference)) {
      throw new DriftError("VALIDATION_FAILED", "Unknown plugin reference blocks compilation.");
    }
  }

  const sourceHash = sha256(canonicalize(record.contract));
  const instructions = [
    `Persona: ${record.contract.displayName}`,
    ...record.contract.behavior.voice.map((voice) => `Voice: ${voice}`),
    ...record.contract.behavior.boundaries.map((boundary) => `Boundary: ${boundary}`)
  ];
  const unsignedBundle = {
    schemaVersion: "drift.compiled-persona.v1" as const,
    personaId,
    personaVersion: version,
    instructions,
    policyReferences: record.contract.policyReferences,
    provenance: {
      personaId,
      personaVersion: version,
      compilerVersion: COMPILER_VERSION,
      compiledAt,
      sourceHash,
      correlationId: context.correlationId
    }
  };
  const contentHash = sha256(canonicalize(unsignedBundle));
  audit(repo, context, "persona_version.compiled", `${personaId}@${version}`);

  return {
    ...unsignedBundle,
    contentHash
  };
}

function getVersion(
  repo: PersonaRepository,
  context: TenantContext,
  personaId: string,
  version: string
): PersonaVersionRecord {
  const persona = repo.personas.get(personaId);
  if (!persona) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Persona was not found.");
  }
  assertTenantAccess(context, persona.tenantId);

  const record = repo.versions.get(versionKey(persona.tenantId, personaId, version));
  if (!record) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Persona version was not found.");
  }
  return record;
}

function validateContract(contract: PersonaContract): void {
  const errors: string[] = [];
  if (!contract.id) errors.push("id is required");
  if (!contract.displayName) errors.push("displayName is required");
  if (!contract.version) errors.push("version is required");
  if (contract.behavior.voice.length === 0) errors.push("behavior.voice must not be empty");
  if (contract.behavior.boundaries.length === 0) errors.push("behavior.boundaries must not be empty");
  if (contract.policyReferences.length === 0) errors.push("policyReferences must not be empty");

  if (errors.length > 0) {
    throw new DriftError("VALIDATION_FAILED", errors.join("; "));
  }
}

function audit(repo: PersonaRepository, context: TenantContext, action: string, subjectId: string): void {
  repo.auditEvents.push({
    eventId: `audit_${randomUUID()}`,
    tenantId: context.tenantId,
    actorId: context.actorId,
    action,
    subjectId,
    correlationId: context.correlationId,
    occurredAt: new Date().toISOString()
  });
}

function versionKey(tenantId: string, personaId: string, version: string): string {
  return `${tenantId}:${personaId}:${version}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value));
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForCanonicalJson);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, nested]) => [key, sortForCanonicalJson(nested)]));
  }

  return value;
}
