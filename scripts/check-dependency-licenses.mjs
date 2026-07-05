import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const packageRoots = ["node_modules/.pnpm", "node_modules"];
const forbidden = /\b(A?GPL|LGPL)\b/i;
const seen = new Map();

for (const root of packageRoots) {
  scan(root, 0);
}

if (seen.size === 0) {
  throw new Error("license check found no installed packages");
}

const offenders = [];
for (const [name, license] of seen.entries()) {
  if (forbidden.test(license)) {
    offenders.push(`${name}: ${license}`);
  }
}

if (offenders.length > 0) {
  throw new Error(`forbidden dependency license found: ${offenders.join(", ")}`);
}

console.log(`dependency-licenses: passed (${seen.size} packages scanned)`);

function scan(directory, depth) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  if (entries.some((entry) => entry.name === "package.json")) {
    recordPackage(join(directory, "package.json"));
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".bin") continue;
    const path = join(directory, entry.name);
    try {
      if (!statSync(path).isDirectory()) continue;
    } catch {
      continue;
    }
    scan(path, depth + 1);
  }
}

function recordPackage(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const name = typeof parsed.name === "string" ? parsed.name : path;
  const version = typeof parsed.version === "string" ? parsed.version : "unknown";
  const license = normalizeLicense(parsed.license ?? parsed.licenses);
  seen.set(`${name}@${version}`, license);
}

function normalizeLicense(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(normalizeLicense).join(" OR ");
  }
  if (value && typeof value === "object" && typeof value.type === "string") {
    return value.type;
  }
  return "UNKNOWN";
}
