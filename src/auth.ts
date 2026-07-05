import { DriftError, type TenantContext } from "./persona-contract.js";
import type { DriftHttpRequest } from "./http.js";

export interface AuthAdapter {
  authenticate(request: DriftHttpRequest, correlationId: string): Promise<TenantContext>;
}

export interface SyncAuthAdapter {
  authenticate(request: DriftHttpRequest, correlationId: string): TenantContext;
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
    correlationId
  };
}
