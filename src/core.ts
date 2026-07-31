export type DriftScope =
  | "scenario:publish"
  | "scenario:validate"
  | "scenario:read"
  | "session:create"
  | "session:read"
  | "session:write";

export const DRIFT_ALL_SCOPES: readonly DriftScope[] = [
  "scenario:publish",
  "scenario:validate",
  "scenario:read",
  "session:create",
  "session:read",
  "session:write"
];

export interface ResourceDelegation {
  readonly resourceType: "scenario" | "session";
  readonly resourceId: string;
  readonly scopes: readonly DriftScope[];
}

export interface TenantContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly allowedTenantIds: readonly string[];
  readonly scopes: readonly DriftScope[];
  readonly delegations?: readonly ResourceDelegation[];
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

export function assertScope(context: TenantContext, scope: DriftScope): void {
  if (!context.scopes.includes(scope)) {
    throw new DriftError("TENANT_SCOPE_DENIED", "Request is not authorized for this operation.");
  }
}

export function assertResourceAccess(
  context: TenantContext,
  ownerActorId: string,
  resourceType: ResourceDelegation["resourceType"],
  resourceId: string,
  scope: DriftScope
): void {
  assertScope(context, scope);
  if (context.actorId === ownerActorId) return;
  const delegated = context.delegations?.some((delegation) =>
    delegation.resourceType === resourceType &&
    delegation.resourceId === resourceId &&
    delegation.scopes.includes(scope)
  );
  if (!delegated) {
    throw new DriftError("RESOURCE_NOT_FOUND", "Resource was not found.");
  }
}
