export const ACCOUNT_ROLES = ["user", "support", "admin"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const PERMISSIONS = [
  "account:read",
  "account:write",
  "security:write",
  "wallet:read",
  "wallet:deposit",
  "wallet:withdraw",
  "orders:read",
  "orders:create",
  "orders:cancel",
  "orders:execute",
  "trades:read",
  "coin:create",
  "admin:read",
  "admin:write"
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type AuthorizationContext = {
  userId: string;
  role: AccountRole;
  status: "active" | "suspended" | "closed";
  ownerUserId?: string;
};

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: "UNAUTHENTICATED" | "ACCOUNT_INACTIVE" | "PERMISSION_DENIED" | "RESOURCE_OWNERSHIP_REQUIRED" };

export const DEFAULT_USER_PERMISSIONS: readonly Permission[] = [
  "account:read",
  "account:write",
  "security:write",
  "wallet:read",
  "wallet:deposit",
  "wallet:withdraw",
  "orders:read",
  "orders:create",
  "orders:cancel",
  "orders:execute",
  "trades:read",
  "coin:create"
];

export const ROLE_PERMISSIONS: Readonly<Record<AccountRole, readonly Permission[]>> = {
  user: DEFAULT_USER_PERMISSIONS,
  support: [
    "account:read",
    "wallet:read",
    "orders:read",
    "trades:read",
    "admin:read"
  ],
  admin: PERMISSIONS
};

export function hasPermission(role: AccountRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function authorize(
  context: AuthorizationContext | null,
  permission: Permission,
  ownerUserId?: string
): AuthorizationDecision {
  if (!context) return { allowed: false, reason: "UNAUTHENTICATED" };
  if (context.status !== "active") return { allowed: false, reason: "ACCOUNT_INACTIVE" };
  if (!hasPermission(context.role, permission)) return { allowed: false, reason: "PERMISSION_DENIED" };
  if (ownerUserId !== undefined && ownerUserId !== context.userId && context.role !== "admin") {
    return { allowed: false, reason: "RESOURCE_OWNERSHIP_REQUIRED" };
  }
  return { allowed: true };
}
