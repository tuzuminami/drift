import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const prohibitedPathPatterns = [
  /(^|\/)CODEX(_AI_COMPANION_OSS)?_IMPLEMENTATION_HARNESS\.md$/,
  /(^|\/)(AGENTS\.private|AGENTS_PRIVATE|README_PRIVATE)\.md$/,
  /(^|\/)(00_GLOSSARY|01_BMA|02_StRS|03_SyRS|04_AD|05_DD|06_API_CONTRACT|07_VV_PLAN|08_TRACEABILITY|09_MVP_BACKLOG|10_RELEASE_CRITERIA)\.md$/,
  /(^|\/)(private-ai-control-plane|\.private|\.codex-private|evidence-private|private-fixtures)(\/|$)/,
  /(^|\/)\.env($|\.)/,
  /\.(sqlite|sqlite3|db|dump|jsonl)$/
];

const prohibitedMarkers = [
  ["PRIVATE", "SPECIFICATION", "DO", "NOT", "COMMIT"].join("_"),
  ["PRIVATE", "OPERATOR", "MATERIAL"].join("_"),
  ["DO", "NOT", "COMMIT", "OR", "PUBLISH"].join("_")
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function fail(message) {
  console.error(`private-boundary: ${message}`);
  process.exitCode = 1;
}

const tracked = git(["ls-files"]);
const stagedNames = git(["diff", "--cached", "--name-only"]);
const stagedStatuses = git(["diff", "--cached", "--name-status"]);
const stagedDeletes = new Set(
  stagedStatuses
    .filter((line) => line.startsWith("D\t"))
    .map((line) => line.slice(2))
);
const nextTrackedState = tracked.filter((file) => !stagedDeletes.has(file));
const nextStagedNames = stagedNames.filter((file) => !stagedDeletes.has(file));
const candidates = [...new Set([...nextTrackedState, ...nextStagedNames])];

for (const file of candidates) {
  if (prohibitedPathPatterns.some((pattern) => pattern.test(file)) && file !== ".env.example") {
    fail(`prohibited path is tracked or staged: ${file}`);
    continue;
  }

  try {
    const content = readFileSync(file, "utf8");
    if (prohibitedMarkers.some((marker) => content.includes(marker))) {
      fail(`private marker found in tracked or staged file: ${file}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "EISDIR") {
      fail(`could not scan ${file}`);
    }
  }
}

if (process.exitCode) {
  process.exit();
}

console.log("private-boundary: passed");
