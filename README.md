# DRIFT
<p align="center">
  <img src="./docs/brand/banner.svg" width="100%" alt="DRIFT — Scenario and Session Orchestrator" />
</p>

<p align="center"><strong>Part of the Tuzuminami AI Systems reference architecture.</strong><br />Independent packages, designed to compose — without claiming runtime package dependencies.</p>

> **System role:** Run the conversation, replay every decision. DRIFT orchestrates deterministic scenario and session state.

## Ecosystem reference architecture

The map below describes an **intended composition**, not current npm/package dependencies. Every repository remains independently usable and independently versioned. An application verifies a VEIL decision before it invokes RELAY; this does not indicate direct VEIL-to-RELAY SDK integration.

```mermaid
flowchart LR
  ASTER["ASTER<br/>Persona contracts"] -->|"compiled artifact reference"| DRIFT["DRIFT<br/>Scenarios & replay"]
  MORROW["MORROW<br/>Consent-aware memory"] --> APP["AI application"]
  TETHER["TETHER<br/>Relationship state"] --> APP
  APP -->|"action context"| VEIL["VEIL<br/>Policy decision"]
  APP -->|"model request after decision verification"| RELAY["RELAY<br/>Inference gateway"]
  RELAY --> PROVIDER["Model / tool provider"]
  PULSE["PULSE<br/>Evaluation harness"] -. "evaluates HTTP targets" .-> APP
  PULSE -.-> VEIL
  PULSE -.-> RELAY
  classDef policy fill:#1D2645,stroke:#6FF6C8,color:#FFFFFF
  classDef relationship fill:#3C144C,stroke:#E82973,color:#FFFFFF
  classDef gateway fill:#113A48,stroke:#31D2C9,color:#FFFFFF
  classDef eval fill:#3F215A,stroke:#E8A1FF,color:#FFFFFF
  classDef memory fill:#3D3A20,stroke:#EFD576,color:#FFFFFF
  classDef orchestration fill:#1D3942,stroke:#6DD9DF,color:#FFFFFF
  classDef persona fill:#3B1E14,stroke:#FFC79F,color:#FFFFFF
  class VEIL policy
  class TETHER relationship
  class RELAY gateway
  class PULSE eval
  class MORROW memory
  class DRIFT orchestration
  class ASTER persona
```

| System | What it contributes |
| --- | --- |
| [VEIL](https://github.com/tuzuminami/veil) | Fail-closed policy decisions and receipts before agent actions. |
| [TETHER](https://github.com/tuzuminami/tether) | Explicit, explainable relationship state. |
| [RELAY](https://github.com/tuzuminami/relay) | Tenant-aware inference routing and provider enforcement. |
| [PULSE](https://github.com/tuzuminami/pulse) | Regression evaluation for HTTP targets and release evidence. |
| [MORROW](https://github.com/tuzuminami/morrow) | Consent, purpose, retention, and revocation-aware memory. |
| [DRIFT](https://github.com/tuzuminami/drift) | Deterministic scenario/session orchestration and replay. |
| [ASTER](https://github.com/tuzuminami/aster) | Versioned persona contracts compiled into portable artifacts. |



> **V1.0.0** Deterministic scenario and session replay primitives for PULSE.
<p align="center">
  <img src="./docs/brand/banner.svg" width="100%" alt="DRIFT — Scenario and Session Orchestrator" />
</p>

<p align="center"><strong>Part of the Tuzuminami AI Systems reference architecture.</strong><br />Independent packages, designed to compose — without claiming runtime package dependencies.</p>

> **System role:** Run the conversation, replay every decision. DRIFT orchestrates deterministic scenario and session state.

## Ecosystem reference architecture

The map below describes an **intended composition**, not current npm/package dependencies. Every repository remains independently usable and independently versioned. An application verifies a VEIL decision before it invokes RELAY; this does not indicate direct VEIL-to-RELAY SDK integration.

```mermaid
flowchart LR
  ASTER["ASTER<br/>Persona contracts"] -->|"compiled artifact reference"| DRIFT["DRIFT<br/>Scenarios & replay"]
  MORROW["MORROW<br/>Consent-aware memory"] --> APP["AI application"]
  TETHER["TETHER<br/>Relationship state"] --> APP
  APP -->|"action context"| VEIL["VEIL<br/>Policy decision"]
  APP -->|"model request after decision verification"| RELAY["RELAY<br/>Inference gateway"]
  RELAY --> PROVIDER["Model / tool provider"]
  PULSE["PULSE<br/>Evaluation harness"] -. "evaluates HTTP targets" .-> APP
  PULSE -.-> VEIL
  PULSE -.-> RELAY
  classDef policy fill:#1D2645,stroke:#6FF6C8,color:#FFFFFF
  classDef relationship fill:#3C144C,stroke:#E82973,color:#FFFFFF
  classDef gateway fill:#113A48,stroke:#31D2C9,color:#FFFFFF
  classDef eval fill:#3F215A,stroke:#E8A1FF,color:#FFFFFF
  classDef memory fill:#3D3A20,stroke:#EFD576,color:#FFFFFF
  classDef orchestration fill:#1D3942,stroke:#6DD9DF,color:#FFFFFF
  classDef persona fill:#3B1E14,stroke:#FFC79F,color:#FFFFFF
  class VEIL policy
  class TETHER relationship
  class RELAY gateway
  class PULSE eval
  class MORROW memory
  class DRIFT orchestration
  class ASTER persona
```

| System | What it contributes |
| --- | --- |
| [VEIL](https://github.com/tuzuminami/veil) | Fail-closed policy decisions and receipts before agent actions. |
| [TETHER](https://github.com/tuzuminami/tether) | Explicit, explainable relationship state. |
| [RELAY](https://github.com/tuzuminami/relay) | Tenant-aware inference routing and provider enforcement. |
| [PULSE](https://github.com/tuzuminami/pulse) | Regression evaluation for HTTP targets and release evidence. |
| [MORROW](https://github.com/tuzuminami/morrow) | Consent, purpose, retention, and revocation-aware memory. |
| [DRIFT](https://github.com/tuzuminami/drift) | Deterministic scenario/session orchestration and replay. |
| [ASTER](https://github.com/tuzuminami/aster) | Versioned persona contracts compiled into portable artifacts. |



DRIFT is an early-stage TypeScript toolkit for deterministic scenario and session orchestration.

## Compatibility Versions

- The npm package, OpenAPI release metadata, and changelog release are `1.0.0`.
- `/v1` is the HTTP API namespace and compatibility boundary; it is not a second package release version.
- JSON Schemas ship with the same DRIFT package release but do not have independent SemVer. Their `$schema` and `$id` values describe JSON Schema dialect and stable schema identity, not the DRIFT release.
- `drift-plugin/0.2` is a separately versioned Plugin SPI. Plugin host compatibility is checked independently and does not imply that the public package or HTTP API is `0.2.0`.
- `npm run check:version` rejects a release when its public version metadata drifts.

## 概要

The current product slice is intentionally narrow: versioned scenario graphs that create
version-pinned sessions, process guarded events, append audit/outbox records, return minimal context
packs, and replay event logs deterministically.

DRIFT does not compile Persona Contracts. It can carry references to already-compiled, public-safe
persona or context artifacts produced by ASTER or compatible tools, but compilation and policy
authoring live outside this repository.

## Non-goals

- No chat UI.
- No model inference.
- No Persona Contract compilation.
- No long-term memory engine.
- No policy PDP.
- No plugin marketplace.
- No private planning material in the public package.

## Install

```bash
pnpm install
pnpm run check
pnpm run build
NODE_ENV=development DRIFT_AUTH_MODE=development pnpm start
```

## Public API Contract

The public API contract is in `openapi/openapi.yaml`. JSON Schema fixtures for released request/response shapes live in `schemas/`.

Current endpoint families:

- `POST /v1/scenarios`
- `POST /v1/scenarios/{scenarioId}/versions/{version}/validate`
- `POST /v1/sessions`
- `POST /v1/sessions/{sessionId}/events`
- `GET /v1/sessions/{sessionId}/context-pack`

## Local PostgreSQL

The PostgreSQL schema lives in `migrations/`. The package includes a transactional PostgreSQL
scenario store and migration runner. A local database can be started with:

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://drift:drift_dev_password@localhost:5432/drift pnpm run db:migrate
```

Run the optional PostgreSQL integration suite against a disposable database:

```bash
DRIFT_POSTGRES_TEST_URL=postgresql://drift:drift_dev_password@localhost:5432/drift pnpm run check
```

See `docs/runbooks/local-postgres.md` for migration, recovery, rollback, and cleanup notes.

## Executable API Server

The package includes a minimal Node HTTP server for the current public contract. The default storage
mode is in-memory for development. PostgreSQL can be selected explicitly:

```bash
NODE_ENV=development DRIFT_AUTH_MODE=development pnpm start
DRIFT_STORAGE=postgres DATABASE_URL=postgresql://drift:drift_dev_password@localhost:5432/drift pnpm start
```

The built-in bearer token parser is development/test-only. Production startup requires
`DRIFT_AUTH_MODE=external`, `DRIFT_STORAGE=postgres`, `DATABASE_URL`, and an application-supplied
production auth adapter.

## TypeScript SDK And CLI

Use the typed SDK client against the public HTTP API:

```ts
import { createDriftClient } from "@tuzuminami/drift";

const client = createDriftClient({
  baseUrl: "http://127.0.0.1:3000",
  tenantId: "tenant_a",
  bearerToken: "actor_1:tenant_a"
});

const pack = await client.getContextPack("session_...");
console.log(pack.sceneId);
```

Run the primary smoke flow from the CLI:

```bash
drift smoke \
  --base-url http://127.0.0.1:3000 \
  --tenant tenant_a \
  --token actor_1:tenant_a
```

The smoke command exits non-zero on API errors and does not print the bearer token.

## Plugin SPI

DRIFT exposes a narrow plugin host contract for explicit capability checks and health validation:

```ts
import { createNoopPlugin, createPluginHost } from "@tuzuminami/drift";

const host = createPluginHost([createNoopPlugin()]);
host.requireCapabilities(["healthcheck"]);
```

Plugins declare `coreApiVersion` and capabilities. Incompatible plugins, missing capabilities, and
health-check timeouts fail closed with typed errors.

## Scenario Session Example

```ts
import {
  createSession,
  getContextPack,
  processSessionEvent,
  publishScenarioVersion
} from "@tuzuminami/drift";

const repo = {
  scenarios: new Map(),
  sessions: new Map(),
  events: [],
  idempotencyKeys: new Map(),
  auditEvents: [],
  outboxEvents: []
};
const context = {
  tenantId: "tenant_a",
  actorId: "actor_1",
  allowedTenantIds: ["tenant_a"],
  correlationId: "corr_1"
};

publishScenarioVersion(repo, context, {
  scenarioId: "onboarding",
  version: "1.0.0",
  scenes: [
    {
      id: "start",
      kind: "start",
      context: {
        instructions: ["Ask for the user's goal."],
        requiredSlots: ["locale"],
        policyReferences: ["policy://default/chat"],
        artifactReferences: [
          {
            artifactId: "aster_context_onboarding_start",
            artifactVersion: "1.0.0",
            contentHash: "sha256:public-safe-context"
          }
        ]
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
  transitions: [{ id: "finish", from: "start", to: "done", eventType: "accepted" }]
});

const session = createSession(repo, context, "onboarding", "1.0.0", { locale: "ja" });
processSessionEvent(repo, context, session.sessionId, "accepted");
console.log(getContextPack(repo, context, session.sessionId).sceneId);
```

## Safety Properties

- Scenario validation rejects duplicate IDs, unreachable scenes, and paths that cannot terminate.
- Scenario validation rejects duplicate transition IDs, ambiguous event dispatch, and outgoing
  terminal transitions.
- Guard failure leaves session state unchanged.
- Replay recalculates transitions, guards, slot updates, and sequence from the event log instead of
  trusting recorded target scenes.
- Context packs include only the current scene's instructions, policy references, artifact
  references, and required slots.
- Scenario publish, session create, and session event processing append audit/outbox records.
- PostgreSQL scenario mutations commit aggregate state, audit event, outbox event, and idempotency
  record in one transaction.
- PostgreSQL readiness checks the expected migrated schema before reporting ready.
- Plugin registration validates core API compatibility and required capabilities before use.
- Release checks scan dependency licenses and package dry-run contents.
- A public boundary guard rejects private operator material and high-risk local artifacts.

## Current Production Gaps

The repository has domain logic, a small HTTP contract boundary, OpenAPI/JSON Schema, PostgreSQL
schema and adapter, migration runner, TypeScript SDK, CLI smoke path, CI, and package boundary
checks. It is not yet a full production service: production authentication implementation,
full asynchronous action execution/compensation, and deeper operational telemetry still need to be
completed before production deployment.

## Security And Contributing

See `SECURITY.md` and `CONTRIBUTING.md`. Do not paste secrets, production conversation data, or private operator material into public issues, pull requests, fixtures, logs, or examples.

## License

Apache-2.0. See `LICENSE`.
