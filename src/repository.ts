import type { ScenarioRepository } from "./scenario.js";

export function createInMemoryScenarioRepository(): ScenarioRepository {
  return {
    scenarios: new Map(),
    sessions: new Map(),
    events: [],
    idempotencyKeys: new Map(),
    auditEvents: [],
    outboxEvents: []
  };
}
