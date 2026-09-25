// AXERLY modified 2026-09-25.
import { Router, type Response } from "express";
import { z } from "zod";
import { createRequestAuthSession, publicAuthUser } from "../../lib/authSession";
import { requireTrustedOrigin } from "../../middleware/trustedOrigin";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { credentialsSchema } from "../auth/auth.service";
import { activateLicense, LicenseError } from "../../licensing/licenseClient";
import { createFirstFirm, OnboardingError, registerWithJoinToken, setupStatus, verifyJoin } from "./onboarding.service";

export const onboardingRouter = Router();
onboardingRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
const nameSchema = z.string().trim().min(1).max(120);
const setupSchema = credentialsSchema.extend({ name: nameSchema });
const joinSchema = z.object({ code: z.string().min(1).max(64), password: z.string().min(1).max(128) });
const registrationSchema = credentialsSchema.extend({ join_token: z.string().min(32).max(128) });

function fail(res: Response, error: unknown): void {
  if (error instanceof LicenseError) {
    res.status(error.code === "rate_limited" ? 429 : error.code === "license_unreachable" ? 503 : 400)
      .json({ code: error.code, detail: error.code === "license_unreachable" ? "The license server could not be reached. Please try again." : "The license could not be activated." });
    return;
  }
  if (error instanceof OnboardingError) {
    res.status(error.status).json({ code: error.code, detail: error.message });
    return;
  }
  throw error;
}

onboardingRouter.get("/setup/status", asyncRoute(async (_req, res) => { res.json(await setupStatus()); }));
onboardingRouter.post("/setup/activate", requireTrustedOrigin, asyncRoute(async (req, res) => {
  const parsed = z.object({ license_key: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ code: "invalid_request", detail: "Invalid license key format." });
  if ((await setupStatus()).created) return void res.status(409).json({ code: "already_created", detail: "Organization setup has already completed." });
  try {
    const claims = await activateLicense(parsed.data.license_key);
    res.json({ practice_name: claims.practice_name, max_users: claims.max_users });
  } catch (error) { fail(res, error); }
}));
onboardingRouter.post("/setup/create", requireTrustedOrigin, asyncRoute(async (req, res) => {
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ code: "invalid_request", detail: "Invalid organization or administrator details." });
  try {
    const result = await createFirstFirm(parsed.data);
    const signedIn = await createRequestAuthSession(req, res).auth.signInWithPassword(parsed.data);
    if (signedIn.error || !signedIn.data.user) throw new Error("Created administrator could not sign in");
    res.locals.userId = signedIn.data.user.id;
    res.status(201).json({ org_id: result.orgId, join: result.credentials, user: publicAuthUser(signedIn.data.user) });
  } catch (error) { fail(res, error); }
}));
onboardingRouter.post("/join/verify", requireTrustedOrigin, asyncRoute(async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ code: "join_failed", detail: "Invalid organization code or password." });
  try { res.json({ join_token: await verifyJoin(parsed.data.code, parsed.data.password, req.ip ?? "unknown") }); }
  catch (error) { fail(res, error); }
}));
onboardingRouter.post("/register", requireTrustedOrigin, asyncRoute(async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ code: "registration_failed", detail: "Registration could not be completed." });
  try {
    await registerWithJoinToken({ token: parsed.data.join_token, email: parsed.data.email, password: parsed.data.password, ip: req.ip ?? "unknown" });
    const signedIn = await createRequestAuthSession(req, res).auth.signInWithPassword(parsed.data);
    if (signedIn.error || !signedIn.data.user) throw new Error("Registered member could not sign in");
    res.locals.userId = signedIn.data.user.id;
    res.status(201).json({ user: publicAuthUser(signedIn.data.user) });
  } catch (error) { fail(res, error); }
}));
onboardingRouter.use(routerErrorHandler("[onboarding]"));
