// AXERLY modified 2026-09-23.
import type { Request, Response } from "express";
import { requestOriginIsWordAddin } from "./origins";
import { createRequestDatabase, type Db } from "./database";
import type { AuthUser } from "./localAuth";

const AUTH_COOKIE_BASE_NAME = "axerly-session";

export function authCookiesAreSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function authCookieName(env: NodeJS.ProcessEnv = process.env): string {
  return `${authCookiesAreSecure(env) ? "__Host-" : ""}${AUTH_COOKIE_BASE_NAME}`;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const entry of (header ?? "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    try { cookies.set(name, decodeURIComponent(value)); }
    catch { /* Ignore malformed cookie values. */ }
  }
  return cookies;
}

function cookieHeader(req: Request, value: string, expires: Date): string {
  const wordAddin = requestOriginIsWordAddin(req.get("origin"));
  const parts = [
    `${authCookieName()}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${wordAddin ? "None" : "Lax"}`,
    `Expires=${expires.toUTCString()}`,
  ];
  if (wordAddin || authCookiesAreSecure()) parts.push("Secure");
  if (wordAddin) parts.push("Partitioned");
  return parts.join("; ");
}

export function clearRequestAuthCookies(req: Request, res: Response): void {
  res.append("Set-Cookie", cookieHeader(req, "", new Date(0)));
  res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
}

/** Create a direct-Postgres database/auth facade bound to this request cookie. */
export function createRequestAuthSession(req: Request, res: Response): Db {
  return createRequestDatabase({
    get: () => parseCookies(req.headers.cookie).get(authCookieName()) ?? null,
    set: (token, expires) => res.append("Set-Cookie", cookieHeader(req, token, expires)),
    clear: () => clearRequestAuthCookies(req, res),
  });
}

export interface PublicAuthUser {
  id: string;
  email: string;
  pendingEmail: string | null;
  createdWithGoogle: boolean;
}

export function publicAuthUser(user: AuthUser): PublicAuthUser {
  return {
    id: user.id,
    email: user.email ?? "",
    pendingEmail: user.new_email ?? null,
    createdWithGoogle: user.app_metadata?.provider === "google",
  };
}
