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
