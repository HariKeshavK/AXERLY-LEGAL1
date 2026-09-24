// AXERLY modified 2026-09-24.
import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openFileForUser = vi.hoisted(() => vi.fn());
vi.mock("../../../middleware/auth", () => ({
  requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.locals.userId = "11111111-1111-4111-8111-111111111111";
    res.locals.userEmail = "lawyer@example.test";
    res.locals.userRole = "member";
    next();
  },
}));
vi.mock("../files.service", () => ({ openFileForUser }));
import { filesRouter } from "../files.routes";

const app = express();
app.use("/files", filesRouter);
const FILE_ID = "22222222-2222-4222-8222-222222222222";

describe("authenticated file route", () => {
  beforeEach(() => openFileForUser.mockReset());

  it("returns 404 when the caller cannot read the file", async () => {
    openFileForUser.mockResolvedValue(null);
    const response = await request(app).get(`/files/${FILE_ID}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: "File not found" });
  });

  it("streams an authorized file without caching or MIME sniffing", async () => {
    openFileForUser.mockResolvedValue(Readable.from(Buffer.from("private contents")));
    const response = await request(app).get(`/files/${FILE_ID}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body).toEqual(Buffer.from("private contents"));
  });
});
