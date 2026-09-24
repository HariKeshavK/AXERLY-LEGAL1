// AXERLY modified 2026-09-24.
import { Router, type Response } from "express";
import { clearRequestAuthCookies, createRequestAuthSession, publicAuthUser } from "../../lib/authSession";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireTrustedOrigin } from "../../middleware/trustedOrigin";
import { bootstrapAdmin, credentialsSchema, currentUser, emailSchema, passwordSchema, signInWithPassword, signOut, updateEmail, updatePassword } from "./auth.service";
import { acknowledgeStorageRecoveryKey, pendingStorageRecoveryKey } from "../../config/secrets";
import { can } from "../../lib/authz";
import { isFirstAdmin } from "./auth.service";

export const authRouter = Router();
authRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });

function invalid(res: Response) { res.status(400).json({ code: "invalid_request", detail: "The authentication request is invalid." }); }
function authFailure(res: Response, error: unknown) {
  const value = error as { status?: number; code?: string; message?: string };
  const status = value?.status && value.status >= 400 && value.status < 500 ? value.status : 500;
  res.status(status).json({ code: status === 500 ? null : value.code ?? null, detail: status === 500 ? "Authentication could not be completed." : value.message ?? "Authentication could not be completed." });
}

authRouter.post("/login", requireTrustedOrigin, asyncRoute(async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res);
  const { data, error } = await signInWithPassword(createRequestAuthSession(req, res), parsed.data);
  if (error || !data.user || !data.session) return authFailure(res, error);
  res.json({ user: publicAuthUser(data.user) });
}));

if (process.env.NODE_ENV !== "production") {
  authRouter.post("/dev/bootstrap", requireTrustedOrigin, asyncRoute(async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res);
    const { data, error } = await bootstrapAdmin(createRequestAuthSession(req, res), parsed.data);
    if (error || !data.user || !data.session) return authFailure(res, error);
    res.status(201).json({ user: publicAuthUser(data.user) });
  }));
}

async function recoveryAdmin(res: Response): Promise<boolean> {
  const user = {
    id: res.locals.userId as string,
    role: res.locals.userRole === "admin" ? "admin" as const : "member" as const,
    status: "active" as const,
  };
  return can(user, "admin", { kind: "system" }) && await isFirstAdmin(user.id);
}

authRouter.post("/storage-recovery/pending", requireAuth, asyncRoute(async (_req, res) => {
  if (!(await recoveryAdmin(res))) return void res.status(404).json({ detail: "Recovery key not available" });
  const recoveryKey = await pendingStorageRecoveryKey();
  res.json({ recovery_key: recoveryKey });
}));

authRouter.post("/storage-recovery/acknowledge", requireAuth, asyncRoute(async (_req, res) => {
  if (!(await recoveryAdmin(res))) return void res.status(404).json({ detail: "Recovery key not available" });
  await acknowledgeStorageRecoveryKey();
  res.status(204).end();
}));

authRouter.get("/me", requireAuth, asyncRoute(async (req, res) => {
  const { user, error } = await currentUser(res.locals.authClient);
  if (error || !user) return authFailure(res, error);
  res.json({ user: publicAuthUser(user) });
}));
authRouter.get("/session", requireAuth, asyncRoute(async (req, res) => {
  const { user, error } = await currentUser(res.locals.authClient);
  if (error || !user) return authFailure(res, error);
  res.json({ user: publicAuthUser(user) });
}));

authRouter.post("/logout", requireAuth, asyncRoute(async (req, res) => {
  await signOut(res.locals.authClient, req.body?.scope === "global" ? "global" : "local");
  clearRequestAuthCookies(req, res);
  res.status(204).end();
}));

authRouter.patch("/password", requireAuth, asyncRoute(async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res);
  const { data, error } = await updatePassword(res.locals.authClient, parsed.data.password);
  if (error || !data.user) return authFailure(res, error);
  clearRequestAuthCookies(req, res);
  res.json({ user: publicAuthUser(data.user), reauthenticationRequired: true });
}));

authRouter.patch("/email", requireAuth, asyncRoute(async (req, res) => {
  const parsed = emailSchema.safeParse(req.body?.email);
  if (!parsed.success) return invalid(res);
  const { data, error } = await updateEmail(res.locals.authClient, parsed.data);
  if (error || !data.user) return authFailure(res, error);
  res.json({ user: publicAuthUser({ ...data.user, email: parsed.data }) });
}));

authRouter.use(routerErrorHandler("[auth]"));
