export interface TenantContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly allowedTenantIds: readonly string[];
  readonly correlationId: string;
}

export class DriftError extends Error {
  public constructor(
    public readonly code:
      | "AUTHENTICATION_REQUIRED"
      | "TENANT_SCOPE_DENIED"
      | "VALIDATION_FAILED"
      | "VERSION_CONFLICT"
      | "IDEMPOTENCY_CONFLICT"
      | "CONFIGURATION_INVALID"
      | "PLUGIN_INCOMPATIBLE"
      | "DEPENDENCY_UNAVAILABLE"
      | "RESOURCE_NOT_FOUND",
    message: string
  ) {
    super(message);
  }
}

export function assertTenantAccess(context: TenantContext, tenantId: string): void {
  if (!context.actorId) {
    throw new DriftError("AUTHENTICATION_REQUIRED", "Authentication is required.");
  }

  if (!context.allowedTenantIds.includes(tenantId)) {
    throw new DriftError("TENANT_SCOPE_DENIED", "Request cannot access this tenant.");
  }
}
