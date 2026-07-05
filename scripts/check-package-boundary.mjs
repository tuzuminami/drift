import { execFileSync } from "node:child_process";

const prohibited = [
  /CODEX.*HARNESS\.md/,
  /(^|\/).*_PRIVATE\.md/,
  /docs\/[0-9]{2}_[^/]+\.md/,
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
