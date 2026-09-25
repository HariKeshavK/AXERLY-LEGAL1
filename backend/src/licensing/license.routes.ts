// AXERLY modified 2026-09-25.
import { Router } from "express";
import { can } from "../lib/authz";
import { databasePool } from "../lib/database";
import { loadOrCreateSecrets } from "../config/secrets";
import { requireAuth } from "../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../middleware/asyncRoute";
import { LicenseError, validateLicense, verifiedLicense } from "./licenseClient";

export const licenseRouter = Router();
licenseRouter.use(requireAuth);
licenseRouter.use((_req, res, next) => {
  if (!can({ id: res.locals.userId as string, role: res.locals.userRole as "admin" | "member", status: "active" }, "admin", { kind: "system" }))
    return void res.status(404).json({ detail: "Not found" });
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
licenseRouter.get("/status", asyncRoute(async (_req, res) => {
  const secrets = await loadOrCreateSecrets();
  const claims = await verifiedLicense();
  res.json({ state: claims ? "active" : secrets.licenseToken ? "read_only" : "unactivated",
    code: secrets.licenseBlockedCode ?? null,
    ...(claims ? { plan: claims.plan, max_users: claims.max_users, expires_at: claims.expires_at,
      recheck_after_hours: claims.recheck_after_hours, last_validated_at: secrets.licenseLastValidatedAt } : {}) });
}));
licenseRouter.post("/refresh", asyncRoute(async (_req, res) => {
  const org = await databasePool().query<{ id: string }>("select id from public.organizations limit 1");
  if (!org.rows[0]) return void res.status(404).json({ detail: "Not found" });
  const count = await databasePool().query<{ count: string }>("select count(*)::text as count from public.users where status='active'");
  try {
    const claims = await validateLicense(org.rows[0].id, Number(count.rows[0]?.count ?? 0));
    res.json({ state: "active", plan: claims.plan, max_users: claims.max_users, expires_at: claims.expires_at });
  } catch (error) {
    if (error instanceof LicenseError) return void res.status(error.code === "license_unreachable" ? 503 : 403)
      .json({ code: error.code, detail: "The license could not be refreshed." });
    throw error;
  }
}));
licenseRouter.use(routerErrorHandler("[licensing]"));
