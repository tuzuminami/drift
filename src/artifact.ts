import { DriftError, type TenantContext } from "./core.js";
import type { CompiledArtifactReference } from "./scenario.js";

export const ASTER_ARTIFACT_SCHEMA_VERSION = "aster.drift-reference/1";

export interface CompiledArtifactLocator {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly producer: "aster";
}

export interface ResolvedCompiledArtifact extends CompiledArtifactReference {
  readonly tenantId: string;
}

export interface AsterCompiledBundle {
  readonly personaId: string;
  readonly version: number;
  readonly compilerVersion: "aster-compiler/0.1.0";
  readonly contentHash: string;
  readonly provenance: {
    readonly sourceContractHash: string;
    readonly compiledAt: string;
    readonly componentIds: readonly string[];
    readonly policyReferenceIds: readonly string[];
    readonly pluginReferenceIds: readonly string[];
  };
  readonly context: {
    readonly displayName: string;
    readonly purpose: string;
    readonly instructions: readonly string[];
    readonly boundaries: readonly string[];
    readonly contextBlocks: readonly string[];
    readonly policyReferences: readonly { readonly id: string; readonly version: string; readonly required: boolean }[];
    readonly pluginReferences: readonly { readonly name: string; readonly version: string; readonly capability: "context_injector" | "renderer" }[];
  };
}

export function deriveAsterCompiledArtifactReference(bundle: unknown): CompiledArtifactReference {
  const value = requireRecord(bundle, "CompiledBundle");
  const provenance = requireRecord(value.provenance, "CompiledBundle provenance");
  const context = requireRecord(value.context, "CompiledBundle context");
  const personaId = requireNonEmpty(value.personaId, "personaId");
  const version = value.version;
  if (!Number.isInteger(version) || (version as number) < 1) throw invalidBundle("version must be a positive integer");
  const compilerVersion = requireNonEmpty(value.compilerVersion, "compilerVersion");
  if (compilerVersion !== "aster-compiler/0.1.0") throw invalidBundle("compilerVersion is unsupported");
  const contentHash = requireHash(value.contentHash, "contentHash");
  requireHash(provenance.sourceContractHash, "provenance.sourceContractHash");
  requireIsoDate(provenance.compiledAt, "provenance.compiledAt");
  for (const field of ["componentIds", "policyReferenceIds", "pluginReferenceIds"] as const) requireStringArray(provenance[field], `provenance.${field}`);
  requireNonEmpty(context.displayName, "context.displayName");
  requireNonEmpty(context.purpose, "context.purpose");
  for (const field of ["instructions", "boundaries", "contextBlocks"] as const) requireStringArray(context[field], `context.${field}`);
  requireReferences(context.policyReferences, "policy");
  requireReferences(context.pluginReferences, "plugin");
  return { artifactId: personaId, artifactVersion: String(version), producer: "aster", schemaVersion: ASTER_ARTIFACT_SCHEMA_VERSION, compilerVersion, digestAlgorithm: "sha256", contentHash: `sha256:${contentHash}` };
}

/**
 * The integration adapter owns lookup and bundle-content verification. DRIFT
 * verifies that the resolved, tenant-bound artifact exactly matches the stored reference.
 */
export interface VerifiedCompiledArtifactResolver {
  resolve(context: TenantContext, locator: CompiledArtifactLocator): ResolvedCompiledArtifact | undefined;
}

export interface AsyncVerifiedCompiledArtifactResolver {
  resolve(
    context: TenantContext,
    locator: CompiledArtifactLocator
  ): Promise<ResolvedCompiledArtifact | undefined>;
}

export function validateCompiledArtifactReferences(
  references: readonly CompiledArtifactReference[]
): void {
  for (const reference of references) {
    if (
      reference.artifactId.length === 0 ||
      reference.artifactVersion.length === 0 ||
      reference.compilerVersion.length === 0
    ) {
      throw new DriftError("VALIDATION_FAILED", "Compiled artifact reference fields must be non-empty.");
    }
    if (reference.producer !== "aster") {
      throw new DriftError("VALIDATION_FAILED", "Compiled artifact producer must be aster.");
    }
    if (reference.schemaVersion !== ASTER_ARTIFACT_SCHEMA_VERSION) {
      throw new DriftError("VALIDATION_FAILED", "Compiled artifact schemaVersion is unsupported.");
    }
    if (reference.digestAlgorithm !== "sha256" || !/^sha256:[0-9a-f]{64}$/.test(reference.contentHash)) {
      throw new DriftError("VALIDATION_FAILED", "Compiled artifact contentHash must be a SHA-256 digest.");
    }
  }
}

export function assertArtifactReferencesResolved(
  context: TenantContext,
  references: readonly CompiledArtifactReference[],
  resolver: VerifiedCompiledArtifactResolver | undefined
): void {
  if (references.length === 0) return;
  if (resolver === undefined) {
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Compiled artifact verification is required before publishing this scenario.");
  }

  for (const reference of references) {
    const resolved = resolver.resolve(context, locatorFrom(reference));
    if (resolved === undefined) {
      throw new DriftError("RESOURCE_NOT_FOUND", "Referenced compiled artifact was not found for this tenant.");
    }
    if (resolved.tenantId !== context.tenantId) {
      throw new DriftError("RESOURCE_NOT_FOUND", "Referenced compiled artifact was not found for this tenant.");
    }
    if (
      resolved.artifactId !== reference.artifactId ||
      resolved.artifactVersion !== reference.artifactVersion ||
      resolved.producer !== reference.producer ||
      resolved.schemaVersion !== reference.schemaVersion ||
      resolved.compilerVersion !== reference.compilerVersion ||
      resolved.digestAlgorithm !== reference.digestAlgorithm ||
      resolved.contentHash !== reference.contentHash
    ) {
      throw new DriftError("VERSION_CONFLICT", "Referenced compiled artifact does not match its verified content hash.");
    }
  }
}

export async function assertArtifactReferencesResolvedAsync(
  context: TenantContext,
  references: readonly CompiledArtifactReference[],
  resolver: AsyncVerifiedCompiledArtifactResolver | undefined
): Promise<readonly ResolvedCompiledArtifact[]> {
  if (references.length === 0) return [];
  if (resolver === undefined) {
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Compiled artifact verification is required before publishing this scenario.");
  }
  const resolvedReferences = await Promise.all(references.map((reference) => resolver.resolve(context, locatorFrom(reference))));
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index] as CompiledArtifactReference;
    const resolved = resolvedReferences[index];
    if (resolved === undefined) throw new DriftError("RESOURCE_NOT_FOUND", "Referenced compiled artifact was not found for this tenant.");
    if (resolved.tenantId !== context.tenantId) throw new DriftError("RESOURCE_NOT_FOUND", "Referenced compiled artifact was not found for this tenant.");
    if (!matchesReference(resolved, reference)) {
      throw new DriftError("VERSION_CONFLICT", "Referenced compiled artifact does not match its verified content hash.");
    }
  }
  return resolvedReferences as readonly ResolvedCompiledArtifact[];
}

function matchesReference(resolved: CompiledArtifactReference, reference: CompiledArtifactReference): boolean {
  return resolved.artifactId === reference.artifactId &&
    resolved.artifactVersion === reference.artifactVersion &&
    resolved.producer === reference.producer &&
    resolved.schemaVersion === reference.schemaVersion &&
    resolved.compilerVersion === reference.compilerVersion &&
    resolved.digestAlgorithm === reference.digestAlgorithm &&
    resolved.contentHash === reference.contentHash;
}

function locatorFrom(reference: CompiledArtifactReference): CompiledArtifactLocator {
  return {
    artifactId: reference.artifactId,
    artifactVersion: reference.artifactVersion,
    producer: reference.producer
  };
}

function invalidBundle(message: string): DriftError { return new DriftError("VALIDATION_FAILED", `ASTER CompiledBundle ${message}.`); }
function requireRecord(value: unknown, name: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidBundle(`${name} must be an object`); return value as Record<string, unknown>; }
function requireNonEmpty(value: unknown, name: string): string { if (typeof value !== "string" || value.length === 0) throw invalidBundle(`${name} must be a non-empty string`); return value; }
function requireHash(value: unknown, name: string): string { const hash = requireNonEmpty(value, name); if (!/^[a-f0-9]{64}$/.test(hash)) throw invalidBundle(`${name} must be a SHA-256 hash`); return hash; }
function requireIsoDate(value: unknown, name: string): void { if (Number.isNaN(Date.parse(requireNonEmpty(value, name)))) throw invalidBundle(`${name} must be an ISO timestamp`); }
function requireStringArray(value: unknown, name: string): void { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) throw invalidBundle(`${name} must contain non-empty strings`); }
function requireReferences(value: unknown, kind: "policy" | "plugin"): void { if (!Array.isArray(value)) throw invalidBundle(`context.${kind}References must be an array`); for (const item of value) { const record = requireRecord(item, `${kind} reference`); if (kind === "policy") { requireNonEmpty(record.id, "policy reference id"); requireNonEmpty(record.version, "policy reference version"); if (typeof record.required !== "boolean") throw invalidBundle("policy reference required must be boolean"); } else { requireNonEmpty(record.name, "plugin reference name"); requireNonEmpty(record.version, "plugin reference version"); if (record.capability !== "context_injector" && record.capability !== "renderer") throw invalidBundle("plugin reference capability is invalid"); } } }
