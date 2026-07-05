import { readFileSync } from "node:fs";

const requiredFiles = [
  "openapi/openapi.yaml",
  "schemas/scenario-graph.schema.json",
  "schemas/context-pack.schema.json"
];
const privateControlMarker = ["PRIVATE", "CONTROL", "DOCUMENT"].join(" ");

for (const file of requiredFiles) {
  const content = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    JSON.parse(content);
  }
  if (content.includes(privateControlMarker)) {
    throw new Error(`private marker leaked into public contract: ${file}`);
  }
}

const openapi = readFileSync("openapi/openapi.yaml", "utf8");
const requiredPaths = [
  "/v1/scenarios",
  "/v1/scenarios/{scenarioId}/versions/{version}/validate",
  "/v1/sessions",
  "/v1/sessions/{sessionId}/events",
  "/v1/sessions/{sessionId}/context-pack"
];

for (const path of requiredPaths) {
  if (!openapi.includes(path)) {
    throw new Error(`missing OpenAPI path: ${path}`);
  }
}

console.log("public-contracts: passed");
