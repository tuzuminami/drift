import { DriftError, type TenantContext } from "./persona-contract.js";

export const DRIFT_PLUGIN_CORE_API_VERSION = "drift-plugin/0.2";

export interface PluginContext {
  readonly tenant: TenantContext;
  readonly correlationId: string;
  readonly timeoutMs: number;
}

export interface PluginHealth {
  readonly status: "ok" | "degraded" | "unavailable";
  readonly reasonCode?: string;
}

export interface Plugin {
  readonly name: string;
  readonly version: string;
  readonly coreApiVersion: string;
  readonly capabilities: readonly string[];
  healthCheck(context: PluginContext): Promise<PluginHealth>;
  shutdown?(): Promise<void>;
}

export interface PluginHost {
  requireCapabilities(requiredCapabilities: readonly string[]): void;
  healthCheckAll(context: PluginContext): Promise<Readonly<Record<string, PluginHealth>>>;
  shutdown(): Promise<void>;
}

export function createPluginHost(plugins: readonly Plugin[]): PluginHost {
  const uniqueNames = new Set<string>();
  for (const plugin of plugins) {
    validatePlugin(plugin);
    if (uniqueNames.has(plugin.name)) {
      throw new DriftError("PLUGIN_INCOMPATIBLE", `Duplicate plugin name: ${plugin.name}.`);
    }
    uniqueNames.add(plugin.name);
  }

  return {
    requireCapabilities(requiredCapabilities) {
      const provided = new Set(plugins.flatMap((plugin) => plugin.capabilities));
      const missing = requiredCapabilities.filter((capability) => !provided.has(capability));
      if (missing.length > 0) {
        throw new DriftError("PLUGIN_INCOMPATIBLE", `Missing plugin capabilities: ${missing.join(", ")}.`);
      }
    },
    async healthCheckAll(context) {
      const entries = await Promise.all(
        plugins.map(async (plugin) => [
          plugin.name,
          await withTimeout(plugin.healthCheck(context), context.timeoutMs, plugin.name)
        ] as const)
      );
      return Object.fromEntries(entries);
    },
    async shutdown() {
      for (const plugin of plugins) {
        await plugin.shutdown?.();
      }
    }
  };
}

export function createNoopPlugin(name = "noop.action"): Plugin {
  return {
    name,
    version: "0.2.0",
    coreApiVersion: DRIFT_PLUGIN_CORE_API_VERSION,
    capabilities: ["healthcheck"],
    async healthCheck() {
      return { status: "ok" };
    }
  };
}

function validatePlugin(plugin: Plugin): void {
  if (plugin.coreApiVersion !== DRIFT_PLUGIN_CORE_API_VERSION) {
    throw new DriftError("PLUGIN_INCOMPATIBLE", "Plugin core API version is incompatible.");
  }
  if (!plugin.name || !plugin.version || plugin.capabilities.length === 0) {
    throw new DriftError("PLUGIN_INCOMPATIBLE", "Plugin metadata is incomplete.");
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, pluginName: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new DriftError("DEPENDENCY_UNAVAILABLE", `Plugin timed out: ${pluginName}.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
