# DRIFT

DRIFT is an early-stage TypeScript toolkit for deterministic conversational orchestration primitives.

## 概要

The current bootstrap slice creates versioned Persona Contracts and compiles published versions into deterministic `CompiledBundle` objects. The compiler uses canonical JSON and SHA-256 hashes so the same source contract, compiler version, and compile timestamp produce the same content hash.

## Non-goals

- No chat UI.
- No model inference.
- No plugin marketplace.
- No private planning material in the public package.

## Install

```bash
pnpm install
pnpm run check
```

## Example

```ts
import {
  compilePersonaVersion,
  createPersona,
  createPersonaVersion,
  publishPersonaVersion
} from "@tuzuminami/drift";

const repo = { personas: new Map(), versions: new Map(), auditEvents: [] };
const context = {
  tenantId: "tenant_a",
  actorId: "actor_1",
  allowedTenantIds: ["tenant_a"],
  correlationId: "corr_1"
};

const personaId = createPersona(repo, context);
createPersonaVersion(repo, context, personaId, {
  id: "contract_1",
  displayName: "Guide",
  version: "1.0.0",
  behavior: {
    voice: ["concise"],
    boundaries: ["do not claim real-world agency"]
  },
  policyReferences: ["policy://default/safety"],
  pluginReferences: ["renderer.basic"]
}, new Date().toISOString());

publishPersonaVersion(repo, context, personaId, "1.0.0", new Date().toISOString());

const bundle = compilePersonaVersion(
  repo,
  context,
  personaId,
  "1.0.0",
  "2026-07-05T00:00:00.000Z",
  ["renderer.basic"]
);

console.log(bundle.contentHash);
```

## Safety Properties

- Published persona versions are immutable.
- Unknown plugin references block compilation.
- Tenant access is checked before version compilation.
- Audit events are appended for create, version write, publish, and compile operations.
- A public boundary guard rejects private operator material and high-risk local artifacts.

## Current Limitations

This bootstrap slice is intentionally small. Persistence is represented by an in-process repository interface for deterministic compiler behavior; HTTP transport, database migrations, SDK generation, and scenario-session orchestration are future work.

## License

Apache-2.0.
