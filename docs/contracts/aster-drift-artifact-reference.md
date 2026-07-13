# ASTER to DRIFT compiled artifact reference

`aster.drift-reference/1` is the public, transport-neutral contract for attaching a verified ASTER
compiled bundle to a DRIFT scenario. It is deliberately a reference, not a package dependency.

| Field | Requirement |
| --- | --- |
| `artifactId` | ASTER `personaId` or a stable compiled-artifact identifier. |
| `artifactVersion` | String form of the ASTER bundle version. |
| `producer` | Exactly `aster`. |
| `schemaVersion` | Exactly `aster.drift-reference/1`. |
| `compilerVersion` | ASTER compiler version recorded on the bundle. |
| `digestAlgorithm` | Exactly `sha256`. |
| `contentHash` | `sha256:` followed by 64 lowercase hexadecimal characters. |

## Resolution boundary

The application supplies `VerifiedCompiledArtifactResolver` to DRIFT. It receives only the trusted
DRIFT tenant context plus artifact ID/version/producer; it does not receive the requested compiler
or digest fields. Before it returns a result, the adapter must resolve the bundle under that tenant
and verify the ASTER bundle content hash against the persisted bundle. DRIFT never trusts a tenant
identifier supplied inside a scenario payload.

At publish time DRIFT compares all fields in the stored reference with the verified resolver result:

- no resolver: `DEPENDENCY_UNAVAILABLE` (HTTP 503)
- no tenant-scoped artifact: `RESOURCE_NOT_FOUND` (HTTP 404)
- artifact owned by another tenant: `RESOURCE_NOT_FOUND` (HTTP 404), so external callers cannot
  distinguish it from an absent artifact
- digest, compiler, schema, producer, version, or identifier mismatch: `VERSION_CONFLICT` (HTTP 409)

Consumers should repeat resolver verification when resolving an artifact for execution. Publishing
creates an immutable scenario reference; it does not replace the execution-time integrity check.
