// AXERLY modified 2026-09-25.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { can } from "../../lib/authz";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { OnboardingError } from "../onboarding/onboarding.service";
import { adminAudit, adminUsers, changeUserRole, disableUser, firmDetails, rotateJoinCredentials, temporaryPassword, transferOwnership } from "./admin.service";

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use((_req: Request, res: Response, next: NextFunction) => {
  if (!can({ id: res.locals.userId as string, role: res.locals.userRole as "admin" | "member", status: "active" }, "admin", { kind: "system" }))
    return void res.status(404).json({ detail: "Not found" });
  next();
});
adminRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
const uuid = z.string().uuid();
function fail(res: Response, error: unknown): void {
  if (error instanceof OnboardingError) { res.status(error.status).json({ code: error.code, detail: error.message }); return; }
  throw error;
}
adminRouter.get("/users", asyncRoute(async (_req, res) => { res.json(await adminUsers()); }));
adminRouter.patch("/users/:userId/role", asyncRoute(async (req, res) => {
  if (!uuid.safeParse(req.params.userId).success || !["admin", "member"].includes(req.body?.role))
    return void res.status(400).json({ code: "invalid_request" });
  try { await changeUserRole(res.locals.userId as string, req.params.userId, req.body.role); res.status(204).end(); }
  catch (error) { fail(res, error); }
}));
adminRouter.delete("/users/:userId", asyncRoute(async (req, res) => {
  if (!uuid.safeParse(req.params.userId).success) return void res.status(404).json({ detail: "Not found" });
  try { await disableUser(res.locals.userId as string, req.params.userId); res.status(204).end(); }
  catch (error) { fail(res, error); }
}));
adminRouter.post("/users/:userId/reset-password", asyncRoute(async (req, res) => {
  if (!uuid.safeParse(req.params.userId).success) return void res.status(404).json({ detail: "Not found" });
  try { res.json({ temporary_password: await temporaryPassword(res.locals.userId as string, req.params.userId) }); }
  catch (error) { fail(res, error); }
}));
adminRouter.post("/users/:userId/transfer-ownership", asyncRoute(async (req, res) => {
  const parsed = z.object({ to_user_id: uuid, kind: z.enum(["project", "workflow", "document", "chat"]), resource_id: uuid }).safeParse(req.body);
  if (!uuid.safeParse(req.params.userId).success || !parsed.success) return void res.status(400).json({ code: "invalid_request" });
  try {
    await transferOwnership(res.locals.userId as string, req.params.userId, parsed.data.to_user_id, parsed.data.kind, parsed.data.resource_id);
    res.status(204).end();
  } catch (error) { fail(res, error); }
}));
adminRouter.get("/firm", asyncRoute(async (_req, res) => { try { res.json(await firmDetails()); } catch (error) { fail(res, error); } }));
adminRouter.post("/firm/rotate-join", asyncRoute(async (_req, res) => {
  try { res.json(await rotateJoinCredentials(res.locals.userId as string)); } catch (error) { fail(res, error); }
}));
adminRouter.get("/audit", asyncRoute(async (_req, res) => { res.json(await adminAudit()); }));
adminRouter.use(routerErrorHandler("[admin]"));
