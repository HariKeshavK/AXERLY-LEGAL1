// AXERLY modified 2026-09-24; AXERLY modified 2026-09-25.
import type { Request, Response } from "express";
import { createRequestDatabase, type Db } from "./database";
import type { AuthUser } from "./localAuth";

const SESSION_COOKIE = "__Host-axerly-session";
const CSRF_COOKIE = "__Host-axerly-csrf";
export function authCookieName(): string { return SESSION_COOKIE; }
export function csrfCookieName(): string { return CSRF_COOKIE; }

export function parseCookies(header: string | undefined): Map<string, string> {
  const values = new Map<string, string>();
  for (const entry of (header ?? "").split(";")) {
    const index = entry.indexOf("=");
    if (index < 1) continue;
    try { values.set(entry.slice(0, index).trim(), decodeURIComponent(entry.slice(index + 1).trim())); } catch { /* malformed cookie */ }
  }
  return values;
}

function cookie(name: string, value: string, expires: Date, httpOnly: boolean): string {
  return [`${name}=${encodeURIComponent(value)}`, "Path=/", httpOnly ? "HttpOnly" : "", "Secure", "SameSite=Lax", `Expires=${expires.toUTCString()}`].filter(Boolean).join("; ");
}

export function authCookieHeaders(token: string, csrf: string, expires: Date): [string, string] {
  return [cookie(SESSION_COOKIE, token, expires, true), cookie(CSRF_COOKIE, csrf, expires, false)];
}

export function clearRequestAuthCookies(_req: Request, res: Response): void {
  res.append("Set-Cookie", cookie(SESSION_COOKIE, "", new Date(0), true));
  res.append("Set-Cookie", cookie(CSRF_COOKIE, "", new Date(0), false));
  res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
}

export function createRequestAuthSession(req: Request, res: Response): Db {
  return createRequestDatabase({
    get: () => parseCookies(req.headers.cookie).get(SESSION_COOKIE) ?? null,
    getCsrf: () => parseCookies(req.headers.cookie).get(CSRF_COOKIE) ?? null,
    set: (token, csrf, expires) => {
      for (const header of authCookieHeaders(token, csrf, expires)) res.append("Set-Cookie", header);
    },
    clear: () => clearRequestAuthCookies(req, res),
  });
}

export interface PublicAuthUser { id: string; email: string; role: "admin" | "member"; status: "active" | "disabled"; must_change_password?: boolean; }
export function publicAuthUser(user: AuthUser): PublicAuthUser { return { id: user.id, email: user.email, role: user.role, status: user.status,
  ...(user.must_change_password ? { must_change_password: true } : {}) }; }
