import { pathToFileURL } from "node:url";
import { DRIFT_ALL_SCOPES, DriftError, type TenantContext } from "./core.js";
import type { DriftHttpRequest } from "./http.js";

export interface AuthAdapter {
  authenticate(request: DriftHttpRequest, correlationId: string, signal?: AbortSignal): Promise<TenantContext>;
}

export interface SyncAuthAdapter {
  authenticate(request: DriftHttpRequest, correlationId: string): TenantContext;
}

export function missingAuthAdapter(): AuthAdapter {
  return {
    async authenticate() {
      throw new DriftError("CONFIGURATION_INVALID", "An explicit authentication adapter is required.");
    }
  };
}

export function missingSyncAuthAdapter(): SyncAuthAdapter {
  return {
    authenticate() {
      throw new DriftError("CONFIGURATION_INVALID", "An explicit authentication adapter is required.");
    }
  };
}

export function createDevelopmentAuthAdapter(): AuthAdapter {
  return {
    async authenticate(request, correlationId) {
      return authenticateDevelopmentBearer(request, correlationId);
    }
  };
}

export function createDevelopmentSyncAuthAdapter(): SyncAuthAdapter {
  return {
    authenticate: authenticateDevelopmentBearer
  };
}

export function authenticateDevelopmentBearer(
  request: DriftHttpRequest,
  correlationId: string
): TenantContext {
  const tenantId = request.headers["x-tenant-id"];
  const authorization = request.headers.authorization;
  if (!tenantId || !authorization?.startsWith("Bearer ")) {
    throw new DriftError("AUTHENTICATION_REQUIRED", "Authentication is required.");
  }

  const token = authorization.slice("Bearer ".length);
  const [actorId, tenantList] = token.split(":");
  const allowedTenantIds = tenantList?.split(",").filter(Boolean) ?? [];
  if (!actorId || allowedTenantIds.length === 0) {
    throw new DriftError("AUTHENTICATION_REQUIRED", "Authentication is required.");
  }

  return {
    tenantId,
    actorId,
    allowedTenantIds,
    scopes: DRIFT_ALL_SCOPES,
    correlationId
  };
}

export async function loadRuntimeAuthAdapter(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<AuthAdapter> {
  const modulePath = env.DRIFT_AUTH_MODULE;
  if (!modulePath) {
    throw new DriftError("CONFIGURATION_INVALID", "DRIFT_AUTH_MODULE is required for external authentication.");
  }
  let module: unknown;
  try {
    module = await import(pathToFileURL(modulePath).href);
  } catch {
    throw new DriftError("CONFIGURATION_INVALID", "DRIFT_AUTH_MODULE could not be loaded.");
  }
  const adapter = (module as { readonly authAdapter?: unknown }).authAdapter;
  if (!isAuthAdapter(adapter)) {
    throw new DriftError("CONFIGURATION_INVALID", "DRIFT_AUTH_MODULE must export authAdapter.authenticate.");
  }
  return adapter;
}

export function authAdapterTimeoutFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env
): number {
  const value = env.DRIFT_AUTH_TIMEOUT_MS;
  if (value === undefined) return 2_500;
  if (!/^\d+$/.test(value)) {
    throw new DriftError("CONFIGURATION_INVALID", "DRIFT_AUTH_TIMEOUT_MS must be a positive integer.");
  }
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) {
    throw new DriftError("CONFIGURATION_INVALID", "DRIFT_AUTH_TIMEOUT_MS must be between 1 and 30000.");
  }
  return timeout;
}

export async function authenticateWithAdapter(
  adapter: AuthAdapter,
  request: DriftHttpRequest,
  correlationId: string,
  timeoutMs: number
): Promise<TenantContext> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  try {
    const identity = await Promise.race([
      adapter.authenticate(request, correlationId, controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new DriftError("DEPENDENCY_UNAVAILABLE", "Authentication dependency is unavailable."));
        }, timeoutMs);
      })
    ]);
    return validateAuthenticatedContext(identity, correlationId);
  } catch (error) {
    if (error instanceof DriftError && (error.code === "AUTHENTICATION_REQUIRED" || error.code === "TENANT_SCOPE_DENIED")) {
      throw error;
    }
    if (error instanceof DriftError && error.code === "CONFIGURATION_INVALID") {
      throw error;
    }
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Authentication dependency is unavailable.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function authenticateWithSyncAdapter(
  adapter: SyncAuthAdapter,
  request: DriftHttpRequest,
  correlationId: string
): TenantContext {
  try {
    return validateAuthenticatedContext(adapter.authenticate(request, correlationId), correlationId);
  } catch (error) {
    if (error instanceof DriftError && (error.code === "AUTHENTICATION_REQUIRED" || error.code === "TENANT_SCOPE_DENIED" || error.code === "CONFIGURATION_INVALID")) {
      throw error;
    }
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Authentication dependency is unavailable.");
  }
}

function validateAuthenticatedContext(value: unknown, correlationId: string): TenantContext {
  if (!value || typeof value !== "object") {
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Authentication dependency is unavailable.");
  }
  const candidate = value as Partial<TenantContext>;
  if (!isNonEmptyString(candidate.actorId) || !isNonEmptyString(candidate.tenantId)) {
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Authentication dependency is unavailable.");
  }
  if (!Array.isArray(candidate.allowedTenantIds) || !candidate.allowedTenantIds.every(isNonEmptyString)) {
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Authentication dependency is unavailable.");
  }
  if (!Array.isArray(candidate.scopes) || !candidate.scopes.every((scope): scope is TenantContext["scopes"][number] => DRIFT_ALL_SCOPES.includes(scope as TenantContext["scopes"][number]))) {
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Authentication dependency is unavailable.");
  }
  if (candidate.delegations !== undefined && (!Array.isArray(candidate.delegations) || !candidate.delegations.every(isDelegation))) {
    throw new DriftError("DEPENDENCY_UNAVAILABLE", "Authentication dependency is unavailable.");
  }
  return {
    tenantId: candidate.tenantId,
    actorId: candidate.actorId,
    allowedTenantIds: [...candidate.allowedTenantIds],
    scopes: [...candidate.scopes],
    ...(candidate.delegations === undefined ? {} : { delegations: candidate.delegations.map((delegation) => ({ ...delegation, scopes: [...delegation.scopes] })) }),
    correlationId
  };
}

function isAuthAdapter(value: unknown): value is AuthAdapter {
  return typeof value === "object" && value !== null && typeof (value as { readonly authenticate?: unknown }).authenticate === "function";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDelegation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const delegation = value as { readonly resourceType?: unknown; readonly resourceId?: unknown; readonly scopes?: unknown };
  return (delegation.resourceType === "scenario" || delegation.resourceType === "session") &&
    isNonEmptyString(delegation.resourceId) &&
    Array.isArray(delegation.scopes) &&
    delegation.scopes.every((scope) => DRIFT_ALL_SCOPES.includes(scope));
}
