// AXERLY modified 2026-09-24.
import { Router } from "express";
import { z } from "zod";
import { databasePool } from "../../lib/database";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import {
  addTeamMember, createTeam, deleteTeam, listTeamMembers,
  listTeams, removeTeamMember, updateTeam, type TeamQuery, type TeamResult,
} from "./teams.service";

export const teamsRouter = Router();
teamsRouter.use(requireAuth);
const uuid = z.string().uuid();
const query: TeamQuery = (sql, values) => databasePool().query(sql, values);

teamsRouter.param("teamId", (_req, res, next, id) => {
  if (!uuid.safeParse(id).success) return void res.status(404).json({ detail: "Team not found" });
  next();
});
teamsRouter.param("userId", (_req, res, next, id) => {
  if (!uuid.safeParse(id).success) return void res.status(404).json({ detail: "Team member not found" });
  next();
});

function send<T>(res: import("express").Response, result: TeamResult<T>, success = 200): void {
  if (!result.ok) { res.status(result.status).json({ detail: result.detail }); return; }
  if (success === 204) { res.status(204).end(); return; }
  res.status(success).json(result.value);
}

teamsRouter.get("/", asyncRoute(async (_req, res) => {
  send(res, await listTeams(query, res.locals.userId as string));
}));
teamsRouter.post("/", asyncRoute(async (req, res) => {
  send(res, await createTeam(query, res.locals.userId as string, req.body?.name), 201);
}));
teamsRouter.patch("/:teamId", asyncRoute(async (req, res) => {
  send(res, await updateTeam(query, res.locals.userId as string, req.params.teamId, req.body?.name));
}));
teamsRouter.delete("/:teamId", asyncRoute(async (req, res) => {
  send(res, await deleteTeam(query, res.locals.userId as string, req.params.teamId), 204);
}));
teamsRouter.get("/:teamId/members", asyncRoute(async (req, res) => {
  send(res, await listTeamMembers(query, res.locals.userId as string, req.params.teamId));
}));
teamsRouter.post("/:teamId/members", asyncRoute(async (req, res) => {
  if (!uuid.safeParse(req.body?.user_id).success)
    return void res.status(400).json({ detail: "Valid user_id required" });
  send(res, await addTeamMember(query, res.locals.userId as string, req.params.teamId, req.body.user_id), 201);
}));
teamsRouter.delete("/:teamId/members/:userId", asyncRoute(async (req, res) => {
  send(res, await removeTeamMember(query, res.locals.userId as string, req.params.teamId, req.params.userId), 204);
}));
teamsRouter.use(routerErrorHandler("[teams]"));
