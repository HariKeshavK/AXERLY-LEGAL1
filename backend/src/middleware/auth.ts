// AXERLY modified 2026-09-24; AXERLY modified 2026-09-25.
import type { NextFunction, Request, Response } from "express";
import { createRequestAuthSession } from "../lib/authSession";
import { can } from "../lib/authz";
import { requestOriginIsTrusted } from "../lib/origins";
import { setCurrentUser } from "../lib/observability/sentry";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = createRequestAuthSession(req, res);
    const result = await client.auth.getUser();
    const user = result.data.user;
    if (!user || !can(user, "session:use", { kind: "system" })) {
      res.status(401).json({ detail: "Invalid or expired session" });
      return;
    }
    if (user.must_change_password && !["/auth/me", "/auth/session", "/auth/password", "/auth/logout"].includes(req.originalUrl.split("?")[0])) {
      res.status(403).json({ code: "password_change_required", detail: "Change your temporary password before continuing." });
      return;
    }
    if (!SAFE_METHODS.has(req.method)) {
      if (!requestOriginIsTrusted(req.get("origin"))) {
        res.status(403).json({ code: "csrf_failed", detail: "Request verification failed." });
        return;
      }
      const header = req.get("x-csrf-token") ?? "";
      if (!(await client.auth.verifyCsrf(header))) {
        res.status(403).json({ code: "csrf_failed", detail: "Request verification failed." });
        return;
      }
    }
    res.locals.authClient = client;
    res.locals.authSource = "cookie";
    res.locals.userId = user.id;
    res.locals.userEmail = user.email;
    res.locals.userRole = user.role;
    res.locals.mustChangePassword = user.must_change_password === true;
    setCurrentUser(user.id);
    next();
  } catch (error) {
    console.error("[auth] session validation failed", error);
    res.status(500).json({ detail: "Authentication could not be completed." });
  }
}

// Kept as a compatibility export while MFA-only feature guards are removed in P6.
export const requireMfaIfEnrolled = (_req: Request, _res: Response, next: NextFunction): void => next();
