import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const outputDirectory = readOutputDirectory(process.argv.slice(2));

if (readdirSync(outputDirectory).length !== 0) {
  throw new Error(`release-assets: output directory must be empty: ${outputDirectory}`);
}

exec("npm", ["run", "build"]);
const packed = JSON.parse(exec("npm", ["pack", "--json", "--pack-destination", outputDirectory]));
const tarball = resolve(outputDirectory, packed[0]?.filename ?? "");
if (!tarball.endsWith(".tgz")) throw new Error("release-assets: npm pack did not produce a tarball");
smokeInstalledTarball(tarball);
writeEvidence(tarball, outputDirectory);
console.log(`Release assets prepared in ${outputDirectory}.`);

function readOutputDirectory(args) {
  const index = args.indexOf("--output-dir");
  if (index === -1 || !args[index + 1]) throw new Error("release-assets: pass --output-dir <empty directory>");
  const directory = resolve(args[index + 1]);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function smokeInstalledTarball(tarballPath) {
  const consumer = mkdtempSync(join(tmpdir(), "drift-release-consumer-"));
  try {
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "drift-release-consumer", private: true, type: "module" }, null, 2));
    writeFileSync(join(consumer, "auth-adapter.mjs"), `export const authAdapter = { async authenticate(request, correlationId) { return { tenantId: request.headers["x-tenant-id"], actorId: "consumer-actor", allowedTenantIds: [request.headers["x-tenant-id"]], scopes: ["scenario:publish", "scenario:validate", "scenario:read", "session:create", "session:read", "session:write"], correlationId }; } };\n`);
    writeFileSync(join(consumer, "aster-compiled-bundle.json"), readFileSync("tests/fixtures/aster-compiled-bundle.json", "utf8"));
    exec("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], { cwd: consumer });
    const program = [
      'import assert from "node:assert/strict";',
      'import bundle from "./aster-compiled-bundle.json" with { type: "json" };',
      'import { createDriftClient, deriveAsterCompiledArtifactReference } from "@tuzuminami/drift";',
      'import { createServerConfig, createServerRuntime, loadRuntimeAuthAdapter } from "@tuzuminami/drift/server";',
      'import { runPostgresMigrations } from "@tuzuminami/drift/migrations";',
      'assert.ok(createDriftClient({ baseUrl: "https://drift.example.test", tenantId: "tenant_a", bearerToken: "token" }));',
      'assert.equal(deriveAsterCompiledArtifactReference(bundle).producer, "aster");',
      'assert.equal(typeof runPostgresMigrations, "function");',
      'const adapter = await loadRuntimeAuthAdapter({ DRIFT_AUTH_MODULE: new URL("./auth-adapter.mjs", import.meta.url).pathname });',
      'const config = createServerConfig({ NODE_ENV: "production", DRIFT_AUTH_MODE: "external", DRIFT_STORAGE: "postgres", DATABASE_URL: "postgresql://drift:drift@127.0.0.1:5432/drift" });',
      'const runtime = await createServerRuntime(config, { authAdapter: adapter });',
      'await runtime.close?.();'
    ].join("\n");
    exec("node", ["--input-type=module", "--eval", program], { cwd: consumer });
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

function writeEvidence(tarballPath, directory) {
  const sha256 = digest(readFileSync(tarballPath));
  const tarballName = basename(tarballPath);
  writeFileSync(join(directory, "SHA256SUMS"), `${sha256}  ${tarballName}\n`);
  writeFileSync(join(directory, "sbom.cdx.json"), `${JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${sha256.slice(0, 8)}-${sha256.slice(8, 12)}-${sha256.slice(12, 16)}-${sha256.slice(16, 20)}-${sha256.slice(20, 32)}`,
    version: 1,
    metadata: { component: { type: "application", name: packageJson.name, version: packageJson.version } },
    components: dependencyComponents()
  }, null, 2)}\n`);
  const commit = exec("git", ["rev-parse", "HEAD"]).trim();
  const repository = exec("git", ["remote", "get-url", "origin"]).trim().replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, "");
  const provenance = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: tarballName, digest: { sha256 } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://github.com/tuzuminami/drift/.github/workflows/release-evidence.yml",
        externalParameters: { package: packageJson.name, version: packageJson.version },
        internalParameters: {},
        resolvedDependencies: [{ uri: `git+${repository}@${commit}`, digest: { gitCommit: commit } }]
      },
      runDetails: {
        builder: { id: process.env.GITHUB_WORKFLOW_REF ?? "local" },
        metadata: { invocationId: process.env.GITHUB_RUN_ID ?? "local" }
      }
    }
  };
  writeFileSync(join(directory, "provenance.intoto.jsonl"), `${JSON.stringify(provenance)}\n`);
}

function dependencyComponents() {
  const trees = JSON.parse(exec("pnpm", ["list", "--prod", "--depth", "Infinity", "--json"]));
  const tree = trees[0] ?? {};
  const components = new Map();
  function visit(dependencies = {}) {
    for (const [name, value] of Object.entries(dependencies)) {
      if (!value || typeof value !== "object") continue;
      if (typeof value.version === "string") components.set(`${name}@${value.version}`, { type: "library", name, version: value.version });
      visit(value.dependencies);
    }
  }
  visit(tree.dependencies);
  return [...components.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

function exec(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
