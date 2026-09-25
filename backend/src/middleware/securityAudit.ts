// AXERLY modified 2026-09-25.
import { createHmac } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { loadOrCreateSecrets } from "../config/secrets";
import { databasePool } from "../lib/database";

export type SecurityEvent = { action: string; targetKind?: string; targetId?: string };

/** Classify routes without ever reading a credential, header or request body. */
export function classifySecurityEvent(method: string, path: string, status: number): SecurityEvent | null {
  if (method === "POST" && path === "/auth/login") return { action: "auth.login" };
  if (method === "POST" && path === "/auth/logout") return { action: "auth.logout" };
  if (method === "PATCH" && path === "/auth/password") return { action: "auth.password_change" };
  if (method === "POST" && path === "/setup/activate") return { action: "license.activate" };
  if (method === "POST" && path === "/join/verify") return { action: "join.verify" };
  if (method === "POST" && path === "/register") return { action: "join.register" };
  if (method === "POST" && path === "/licensing/refresh") return { action: "license.refresh" };
  const file = path.match(/^\/files\/([0-9a-f-]{36})$/i);
  if (method === "GET" && file) return { action: "file.download", targetKind: "file", targetId: file[1] };
  const key = path.match(/^\/user\/api-keys\/([a-z0-9-]{1,40})$/i);
  if (method === "PUT" && key) return { action: "provider_key.changed", targetKind: "provider", targetId: key[1] };
  const role = path.match(/^\/admin\/users\/([0-9a-f-]{36})\/(role|reset-password|transfer-ownership)$/i);
  if (role && ["PATCH", "POST"].includes(method)) return { action: `admin.${role[2]}`, targetKind: "user", targetId: role[1] };
  const removal = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/i);
  if (method === "DELETE" && removal) return { action: "admin.user_removed", targetKind: "user", targetId: removal[1] };
  if (method === "POST" && path === "/admin/firm/rotate-join") return { action: "firm.join_credentials_rotated" };
  const team = path.match(/^\/teams(?:\/([0-9a-f-]{36})(?:\/members(?:\/([0-9a-f-]{36}))?)?)?$/i);
  if (team && ["POST", "PATCH", "DELETE"].includes(method)) return { action: "team.changed", targetKind: "team", targetId: team[1] };
  const share = path.match(/^\/(projects|chat|workflows|library)\/([0-9a-f-]{36})\/(?:access|share|shares)(?:\/.*)?$/i);
  if (share && ["POST", "PUT", "PATCH", "DELETE"].includes(method))
    return { action: "share.changed", targetKind: share[1], targetId: share[2] };
  if (status >= 400 && ["POST", "PUT", "PATCH"].includes(method) &&
      (/^\/(?:chat|word-chat)(?:\/|$)/.test(path) || /^\/projects\/[0-9a-f-]{36}\/chat/.test(path)))
    return { action: "model.request_blocked" };
  return null;
}

export async function writeSecurityEvent(input: SecurityEvent & { actorId?: string; ip: string; status: number }): Promise<void> {
  const secrets = await loadOrCreateSecrets();
  const ipHash = createHmac("sha256", secrets.sessionSecret).update(`security-ip:${input.ip}`).digest("hex");
  await databasePool().query(`insert into public.security_audit_events
    (actor_id,ip_hash,action,http_status,target_kind,target_id) values($1,$2,$3,$4,$5,$6)`,
    [input.actorId ?? null, ipHash, input.action, input.status, input.targetKind ?? null, input.targetId ?? null]);
}

export function securityAuditBoundary(req: Request, res: Response, next: NextFunction): void {
  res.once("finish", () => {
    const event = classifySecurityEvent(req.method, req.path, res.statusCode);
    if (!event) return;
    void writeSecurityEvent({ ...event, actorId: res.locals.userId as string | undefined,
      ip: req.ip ?? "unknown", status: res.statusCode }).catch(() => {
      // Do not emit request data or raw errors: DB connection strings can carry secrets.
      console.error("[security-audit] event write failed");
    });
  });
  next();
}
