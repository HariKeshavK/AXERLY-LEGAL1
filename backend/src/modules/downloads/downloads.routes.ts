// AXERLY modified 2026-09-23; AXERLY modified 2026-09-24.
// HTTP layer for the downloads module.
//
// Route handlers parse params, call the downloads.service functions, and map
// their typed results onto status codes, headers, and JSON.

import { Router } from "express";
import { pipeline } from "node:stream/promises";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createDatabase } from "../../lib/database";
import { buildContentDisposition } from "../../lib/storage";
import { resolveTokenDownload } from "./downloads.service";

export const downloadsRouter = Router();

// GET /download/:token
downloadsRouter.get("/:token", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const db = createDatabase();
    const result = await resolveTokenDownload(db, {
        token: req.params.token,
        userId,
        userEmail,
    });
    if (!result.ok)
        return void res.status(404).json({
            detail:
                result.kind === "invalid_link" ? "Invalid link" : "File not found",
        });

    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
        "Content-Disposition",
        buildContentDisposition("attachment", result.filename),
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try { await pipeline(result.stream, res); }
    catch (error) {
        result.stream.destroy();
        if (!res.headersSent && !res.destroyed) res.status(500).json({ detail: "File could not be read" });
    }
}));

downloadsRouter.use(routerErrorHandler("[downloads]"));
