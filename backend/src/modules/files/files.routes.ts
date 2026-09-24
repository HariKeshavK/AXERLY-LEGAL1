// AXERLY modified 2026-09-24.
import { Router } from "express";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { openFileForUser } from "./files.service";

export const filesRouter = Router();
const fileId = z.string().uuid();

filesRouter.get("/:id", requireAuth, asyncRoute(async (req, res) => {
  if (!fileId.safeParse(req.params.id).success) {
    return void res.status(404).json({ detail: "File not found" });
  }
  const source = await openFileForUser(req.params.id, {
    id: res.locals.userId as string,
    email: res.locals.userEmail as string | undefined,
    role: res.locals.userRole === "admin" ? "admin" : "member",
    status: "active",
  });
  // Deliberately indistinguishable from a missing id.
  if (!source) return void res.status(404).json({ detail: "File not found" });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    await pipeline(source, res);
  } catch (error) {
    source.destroy();
    if (!res.headersSent && !res.destroyed) res.status(500).json({ detail: "File could not be read" });
  }
}));

filesRouter.use(routerErrorHandler("[files]"));
