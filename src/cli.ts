#!/usr/bin/env node
import { DriftClientError, createDriftClient, type FetchLike } from "./client.js";
import type { ScenarioGraph } from "./scenario.js";

export interface DriftCliIO {
  readonly stdout: WritableText;
  readonly stderr: WritableText;
}

export interface WritableText {
  write(chunk: string): boolean;
}

export interface DriftCliOptions {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchLike;
  readonly io?: DriftCliIO;
}

export async function runDriftCli(options: DriftCliOptions): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const command = options.argv[2];
  if (command !== "smoke") {
    io.stderr.write("Usage: drift smoke --base-url <url> --tenant <tenant> --token <actor:tenant>\n");
    return 2;
  }

  try {
    const args = parseArgs(options.argv.slice(3));
    const baseUrl = args["base-url"] ?? options.env.DRIFT_BASE_URL;
    const tenantId = args.tenant ?? options.env.DRIFT_TENANT_ID;
    const token = args.token ?? options.env.DRIFT_BEARER_TOKEN;
    if (!baseUrl || !tenantId || !token) {
      io.stderr.write("Missing required configuration: base-url, tenant, and token are required.\n");
      return 2;
    }

    const client = createDriftClient({
      baseUrl,
      tenantId,
      bearerToken: token,
      correlationId: args["correlation-id"] ?? "corr_cli_smoke",
      ...(options.fetch ? { fetch: options.fetch } : {})
    });

    const graph = sampleGraph();
    await client.validateScenario(graph);
    await client.publishScenario(graph, { idempotencyKey: "cli-smoke-publish" });
    const session = await client.createSession(
      graph.scenarioId,
      graph.version,
      { locale: "ja" },
      { idempotencyKey: "cli-smoke-session" }
    );
    await client.processSessionEvent(
      session.sessionId,
      "accepted",
      {},
      { idempotencyKey: "cli-smoke-event" }
    );
    const pack = await client.getContextPack(session.sessionId);
    io.stdout.write(
      `${JSON.stringify({
        ok: true,
        sessionId: session.sessionId,
        sceneId: pack.sceneId,
        sequence: pack.provenance.sequence
      })}\n`
    );
    return 0;
  } catch (error) {
    if (error instanceof DriftClientError) {
      io.stderr.write(`${JSON.stringify({ ok: false, code: error.code, status: error.status })}\n`);
      return 1;
    }
    io.stderr.write(`${JSON.stringify({ ok: false, code: "UNEXPECTED_CLI_ERROR" })}\n`);
    return 1;
  }
}

function parseArgs(args: readonly string[]): Readonly<Record<string, string>> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new DriftClientError("INVALID_CLI_ARGUMENTS", "CLI arguments must be --key value pairs.", 0);
    }
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function sampleGraph(): ScenarioGraph {
  return {
    scenarioId: "cli-smoke",
    version: "1.0.0",
    scenes: [
      {
        id: "start",
        kind: "start",
        context: {
          instructions: ["Confirm the smoke flow."],
          requiredSlots: ["locale"],
          policyReferences: ["policy://default/chat"]
        }
      },
      {
        id: "done",
        kind: "terminal",
        context: {
          instructions: ["End the smoke flow."],
          requiredSlots: [],
          policyReferences: ["policy://default/chat"]
        }
      }
    ],
    transitions: [{ id: "finish", from: "start", to: "done", eventType: "accepted" }]
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runDriftCli({
    argv: process.argv,
    env: process.env
  });
}
