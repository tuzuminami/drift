import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cache = process.env.DRIFT_NPM_CACHE ?? "/tmp/drift-npm-cache";
const workspace = mkdtempSync(join(tmpdir(), "drift-consumer-"));

try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", workspace, "--cache", cache], {
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache }
  }));
  const artifact = packed[0];
  if (artifact === undefined || typeof artifact.filename !== "string" || !Array.isArray(artifact.files)) {
    throw new Error("consumer-package: npm pack did not report an artifact manifest");
  }

  const packagedFiles = artifact.files.map((file) => file.path);
  const prohibited = [/^dist\/tests\//, /^tests\//, /^scripts\//, /^\.github\//, /^AGENTS\.md$/];
  for (const file of packagedFiles) {
    if (prohibited.some((pattern) => pattern.test(file))) {
      throw new Error(`consumer-package: prohibited file was packed: ${file}`);
    }
  }

  const consumer = join(workspace, "consumer");
  mkdirSync(consumer);
  execFileSync("npm", ["init", "--yes"], { cwd: consumer, stdio: "pipe" });
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", join(workspace, artifact.filename)], {
    cwd: consumer,
    stdio: "pipe",
    env: { ...process.env, npm_config_cache: cache }
  });

  const rootCheck = [
    'import { createDriftClient } from "@tuzuminami/drift";',
    'import { startDriftServer } from "@tuzuminami/drift/server";',
    'import { runPostgresMigrations } from "@tuzuminami/drift/migrations";',
    'if (typeof createDriftClient !== "function" || typeof startDriftServer !== "function" || typeof runPostgresMigrations !== "function") process.exit(1);'
  ].join("\n");
  execFileSync(process.execPath, ["--input-type=module", "--eval", rootCheck], { cwd: consumer, stdio: "pipe" });

  const privateImport = [
    'import("@tuzuminami/drift/src/client.js")',
    '.then(() => process.exit(1))',
    '.catch((error) => { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") process.exit(1); })'
  ].join("");
  execFileSync(process.execPath, ["--input-type=module", "--eval", privateImport], { cwd: consumer, stdio: "pipe" });

  const packageJson = JSON.parse(readFileSync(join(consumer, "node_modules", "@tuzuminami", "drift", "package.json"), "utf8"));
  const binary = join(consumer, "node_modules", ".bin", "drift");
  const result = spawnSync(binary, ["unknown"], { cwd: consumer, encoding: "utf8" });
  if (packageJson.name !== "@tuzuminami/drift" || result.status !== 2 || !result.stderr.includes("Usage: drift smoke")) {
    throw new Error("consumer-package: packaged CLI did not run as expected");
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("consumer-package: passed");
