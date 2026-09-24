// AXERLY modified 2026-09-24.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTeams: vi.fn(), createTeam: vi.fn(), updateTeam: vi.fn(), deleteTeam: vi.fn(),
  listTeamMembers: vi.fn(), addTeamMember: vi.fn(), removeTeamMember: vi.fn(),
}));
vi.mock("../../../middleware/auth", () => ({
  requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.locals.userId = "11111111-1111-4111-8111-111111111111";
    next();
  },
}));
vi.mock("../teams.service", () => mocks);
import { teamsRouter } from "../teams.routes";

const app = express();
app.use(express.json());
app.use("/teams", teamsRouter);
const TEAM = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";

describe("team HTTP contract", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it("lists teams and maps admin creation conflicts", async () => {
    mocks.listTeams.mockResolvedValue({ ok: true, value: [{ id: TEAM, name: "Litigation" }] });
    expect((await request(app).get("/teams")).body).toEqual([{ id: TEAM, name: "Litigation" }]);
    mocks.createTeam.mockResolvedValue({ ok: false, status: 409, detail: "A team with that name already exists" });
    const conflict = await request(app).post("/teams").send({ name: "Litigation" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.detail).toBe("A team with that name already exists");
  });

  it("404s invalid resource ids and rejects malformed membership input", async () => {
    expect((await request(app).patch("/teams/not-a-uuid").send({ name: "Other" })).status).toBe(404);
    expect((await request(app).post(`/teams/${TEAM}/members`).send({ user_id: "wrong" })).status).toBe(400);
    mocks.addTeamMember.mockResolvedValue({ ok: true, value: { user_id: MEMBER } });
    expect((await request(app).post(`/teams/${TEAM}/members`).send({ user_id: MEMBER })).status).toBe(201);
  });
});
