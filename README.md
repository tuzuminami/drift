# DRIFT

DRIFT is an early-stage TypeScript toolkit for deterministic conversational orchestration primitives.

## 概要

The current MVP slice covers two public-safe primitives:

- Versioned Persona Contracts that compile into deterministic `CompiledBundle` objects.
- Versioned scenario graphs that create version-pinned sessions, process guarded events, return minimal context packs, and replay event logs.

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

## Persona Compiler Example

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

## Scenario Session Example

```ts
import {
  createSession,
  getContextPack,
  processSessionEvent,
  publishScenarioVersion
} from "@tuzuminami/drift";

const repo = { scenarios: new Map(), sessions: new Map(), events: [] };
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
        policyReferences: ["policy://default/chat"]
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

- Published persona versions are immutable.
- Unknown plugin references block compilation.
- Tenant access is checked before version compilation.
- Audit events are appended for create, version write, publish, and compile operations.
- Scenario validation rejects duplicate IDs, unreachable scenes, and paths that cannot terminate.
- Guard failure leaves session state unchanged.
- Context packs include only the current scene's required slots.
- A public boundary guard rejects private operator material and high-risk local artifacts.

## Current Limitations

This MVP slice is intentionally small. Persistence is represented by in-process repository interfaces so the domain behavior is deterministic and easy to embed. HTTP transport, database migrations, SDK generation, and asynchronous action plugins are future work.

## License

Apache-2.0.
