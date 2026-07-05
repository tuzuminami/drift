import { execFileSync } from "node:child_process";

const prohibited = [
  /CODEX(_AI_COMPANION_OSS)?_IMPLEMENTATION_HARNESS\.md/,
  /AGENTS_PRIVATE\.md/,
  /README_PRIVATE\.md/,
  /docs\/(00_GLOSSARY|01_BMA|02_StRS|03_SyRS|04_AD|05_DD|06_API_CONTRACT|07_VV_PLAN|08_TRACEABILITY|09_MVP_BACKLOG|10_RELEASE_CRITERIA)\.md/,
  /(^|\/)(\.env|private-fixtures|evidence-private|\.private|\.codex-private)(\/|$)/
];

const cache = process.env.DRIFT_NPM_CACHE ?? "/tmp/drift-npm-cache";
const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--cache", cache], {
  encoding: "utf8",
  env: {
    ...process.env,
    npm_config_cache: cache
  }
});
const parsed = JSON.parse(raw);
const files = parsed.flatMap((entry) =>
  Array.isArray(entry.files) ? entry.files.map((file) => file.path) : []
);

if (files.length === 0) {
  throw new Error("package-boundary: npm dry-run returned no files");
}

for (const file of files) {
  if (prohibited.some((pattern) => pattern.test(file))) {
    throw new Error(`package-boundary: prohibited file would be packed: ${file}`);
  }
}

console.log(`package-boundary: passed (${files.length} files)`);
