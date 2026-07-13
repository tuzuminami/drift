import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("version-metadata: package.json version must be SemVer");
}

const openapi = readFileSync(resolve(root, "openapi/openapi.yaml"), "utf8");
const openApiVersion = openapi.match(/^  version:\s*([^\s#]+)\s*$/m)?.[1];
if (openApiVersion !== version) {
  throw new Error(`version-metadata: OpenAPI version must equal package version ${version}`);
}

const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
if (!changelog.startsWith(`# Changelog\n\n## ${version} - `)) {
  throw new Error(`version-metadata: changelog must start with ${version}`);
}

const readme = readFileSync(resolve(root, "README.md"), "utf8");
const compatibilityStatement = `The npm package, OpenAPI release metadata, and changelog release are \`${version}\`.`;
if (!readme.includes(compatibilityStatement) || !readme.includes("JSON Schemas ship with the same DRIFT package release but do not have independent SemVer.")) {
  throw new Error("version-metadata: README compatibility version policy is missing or stale");
}

const security = readFileSync(resolve(root, "SECURITY.md"), "utf8");
if (security.includes("pre-1.0") || !security.includes("current supported release line is v1.0")) {
  throw new Error("version-metadata: SECURITY.md release support statement is stale");
}

for (const relativePath of [
  "schemas/scenario-graph.schema.json",
  "schemas/context-pack.schema.json",
  "schemas/session-event.schema.json"
]) {
  const schema = JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
  if (typeof schema.$schema !== "string" || typeof schema.$id !== "string") {
    throw new Error(`version-metadata: ${relativePath} must retain JSON Schema dialect and stable identity`);
  }
}

console.log(`version-metadata: passed (${version})`);
