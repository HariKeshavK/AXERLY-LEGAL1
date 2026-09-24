// AXERLY modified 2026-09-24.
// The only public authorization boundary for backend feature modules.
// Implementation files remain separate to keep each policy area testable.
export type AuthzAction = "session:use" | "read" | "create" | "update" | "delete" | "share" | "admin";
export interface AuthzUser { id: string; role: "admin" | "member"; status: "active" | "disabled"; }
export interface AuthzResource { kind: "system" | "user" | "project" | "document" | "library" | "team"; ownerId?: string; accessRole?: "viewer" | "editor" | "owner"; }

/** Deny-by-default authorization entry point. Route and service code must use this function. */
import { can as canPermission, type Capability, type ProjectRole } from "./permissions";

export function can(role: ProjectRole | null | undefined, capability: Capability): boolean;
export function can(user: AuthzUser | null | undefined, action: AuthzAction, resource: AuthzResource): boolean;
export function can(userOrRole: AuthzUser | ProjectRole | null | undefined, action: AuthzAction | Capability, resource?: AuthzResource): boolean {
  if (resource === undefined) return canPermission(userOrRole as ProjectRole | null | undefined, action as Capability);
  const user = userOrRole as AuthzUser | null | undefined;
  if (!user || user.status !== "active") return false;
  if (action === "session:use") return resource.kind === "system";
  if (resource.kind === "team") {
    if (action === "read") return !!resource.accessRole;
    if (action === "create" || action === "update" || action === "delete")
      return resource.accessRole === "owner";
    return false;
  }
  if (user.role === "admin") return true;
  if (resource.kind === "user") return resource.ownerId === user.id && action !== "admin";
  const access = resource.accessRole;
  if (!access) return false;
  if (action === "read") return true;
  if (action === "update" || action === "create") return access === "editor" || access === "owner";
  if (action === "delete" || action === "share") return access === "owner";
  return false;
}

export * from "./access";
export * from "./contentAccess";
export * from "./projectAccess";
export * from "./orgAccessOverrides";
