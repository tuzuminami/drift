import { readdirSync, readFileSync } from "node:fs";

const migrationFiles = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const privateControlMarker = ["PRIVATE", "CONTROL", "DOCUMENT"].join(" ");

if (migrationFiles.length === 0) {
  throw new Error("no migrations found");
}

for (const file of migrationFiles) {
  const sql = readFileSync(`migrations/${file}`, "utf8");
  if (sql.includes(privateControlMarker)) {
    throw new Error(`private marker leaked into migration: ${file}`);
  }
  for (const table of [
    "scenario_versions",
    "sessions",
    "session_events",
    "idempotency_records",
    "audit_events",
    "outbox_events"
  ]) {
    if (!sql.includes(table)) {
      throw new Error(`migration ${file} missing table ${table}`);
    }
  }
}

console.log("migrations: passed");
