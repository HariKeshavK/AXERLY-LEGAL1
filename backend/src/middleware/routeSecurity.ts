// AXERLY modified 2026-09-24; AXERLY modified 2026-09-25.
import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "./auth";

export const PUBLIC_ROUTE_ALLOWLIST = Object.freeze([
  { method: "GET", path: "/health" },
  { method: "GET", path: "/manifest-signing-key" },
  { method: "POST", path: "/auth/login" },
  { method: "GET", path: "/setup/status" },
  { method: "POST", path: "/setup/activate" },
  { method: "POST", path: "/setup/create" },
  { method: "POST", path: "/join/verify" },
  { method: "POST", path: "/register" },
] as const);

export function isPublicRoute(method: string, path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (method === "OPTIONS") return true;
  if (env.NODE_ENV !== "production" && env.AXERLY_PACKAGED !== "true" && method === "POST" && path === "/auth/dev/bootstrap") return true;
  if (env.SENTRY_ENABLE_TEST_ROUTE === "true" && method === "GET" && path === "/observability/sentry-test") return true;
  return PUBLIC_ROUTE_ALLOWLIST.some((route) => route.method === method && route.path === path);
}

/** A single default-deny boundary mounted before every application route. */
export function authenticationBoundary(req: Request, res: Response, next: NextFunction): void {
  if (isPublicRoute(req.method, req.path)) { next(); return; }
  void requireAuth(req, res, next);
}
