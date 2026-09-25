// AXERLY modified 2026-09-25.
import type { NextFunction, Request, Response } from "express";
import { databasePool } from "../lib/database";
import { loadOrCreateSecrets } from "../config/secrets";
import { LicenseError, validateLicense, verifiedLicense } from "../licensing/licenseClient";

export function isReadOnlyAllowed(method: string, path: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  if (method === "POST" && ["/auth/login", "/auth/logout", "/auth/storage-recovery/pending",
    "/auth/storage-recovery/acknowledge", "/setup/activate", "/setup/create", "/join/verify",
    "/licensing/refresh", "/register", "/user/exports", "/single-documents/download-zip"].includes(path)) return true;
  if (method === "POST" && /^\/library\/[^/]+\/levels$/.test(path)) return true;
  if (method === "POST" && path.endsWith("/export")) return true;
  if (method === "PATCH" && ["/auth/password", "/auth/email"].includes(path)) return true;
  return false;
}

/** The official build's server-side write gate. An unreachable service can use
 * the last verified token only until that token's signed offline deadline. */
export async function licenseWriteGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (process.env.NODE_ENV !== "production" && process.env.AXERLY_PACKAGED !== "true") { next(); return; }
  if (isReadOnlyAllowed(req.method, req.path)) { next(); return; }
  try {
    const secrets = await loadOrCreateSecrets();
    let claims = await verifiedLicense();
    const due = !secrets.licenseLastValidatedAt || (claims &&
      Date.now() - Date.parse(secrets.licenseLastValidatedAt) >= claims.recheck_after_hours * 3_600_000);
    if (secrets.licenseToken && (due || !claims)) {
      const org = await databasePool().query<{ id: string }>("select id from public.organizations limit 1");
      if (org.rows[0]) {
        const count = await databasePool().query<{ count: string }>("select count(*)::text as count from public.users where status='active'");
        try { claims = await validateLicense(org.rows[0].id, Number(count.rows[0]?.count ?? 0)); }
        catch (error) {
          if (!(error instanceof LicenseError && error.code === "license_unreachable")) claims = null;
        }
      }
    }
    if (!claims) { res.status(403).json({ code: "license_inactive", detail: "The organization is read-only until its license is active." }); return; }
    next();
  } catch {
    res.status(403).json({ code: "license_inactive", detail: "The organization is read-only until its license is active." });
  }
}
