// AXERLY modified 2026-09-24.
/** Teams are permission principals, never automatic access to firm content. */
import { can } from "../../lib/authz";

export type TeamQuery = (sql: string, values?: unknown[]) => Promise<{
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}>;
export type TeamResult<T> = { ok: true; value: T } | {
  ok: false; status: 400 | 404 | 409; detail: string;
};
type FirmMembership = { org_id: string; role: "admin" | "member" };

async function membership(query: TeamQuery, userId: string): Promise<FirmMembership | null> {
  const result = await query(
    "select org_id, role from public.org_members where user_id = $1 limit 1", [userId]);
  const firm = result.rows[0] as FirmMembership | undefined;
  return firm && can({ id: userId, role: "member", status: "active" }, "read", {
    kind: "team", accessRole: "viewer",
  }) ? firm : null;
}

function mayManage(userId: string, role: FirmMembership["role"]): boolean {
  // The firm role is mapped into the central authz decision; no global-admin
  // shortcut may grant access to a firm the caller has not joined.
  return can({ id: userId, role: "member", status: "active" }, "update", {
    kind: "team", accessRole: role === "admin" ? "owner" : undefined,
  });
}

function nameValue(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  return name.length >= 1 && name.length <= 120 && !/[\x00-\x1f\x7f]/.test(name)
    ? name : null;
}

async function teamInFirm(query: TeamQuery, teamId: string, orgId: string): Promise<Record<string, unknown> | null> {
  const result = await query(
    "select id, org_id, name, created_at, updated_at from public.teams where id=$1 and org_id=$2",
    [teamId, orgId]);
  return result.rows[0] ?? null;
}

const missing = (): TeamResult<never> => ({ ok: false, status: 404, detail: "Team not found" });

export async function listTeams(query: TeamQuery, actorId: string): Promise<TeamResult<Record<string, unknown>[]>> {
  const firm = await membership(query, actorId);
  if (!firm) return missing();
  const result = await query(
    `select t.id, t.org_id, t.name, t.created_at, t.updated_at,
       count(tm.user_id)::integer as member_count,
       coalesce(bool_or(tm.user_id = $2), false) as is_member
     from public.teams t left join public.team_members tm on tm.team_id=t.id
     where t.org_id=$1 group by t.id order by lower(t.name), t.id`,
    [firm.org_id, actorId]);
  return { ok: true, value: result.rows };
}

/** P7 model grants will union entitlements for every id returned here. */
export async function teamIdsForUser(query: TeamQuery, userId: string): Promise<string[]> {
  const firm = await membership(query, userId);
  if (!firm) return [];
  const result = await query(
    "select team_id from public.team_members where org_id=$1 and user_id=$2 order by team_id",
    [firm.org_id, userId]);
  return result.rows.map((row) => String(row.team_id));
}

export async function createTeam(query: TeamQuery, actorId: string, input: unknown): Promise<TeamResult<Record<string, unknown>>> {
  const firm = await membership(query, actorId);
  if (!firm) return missing();
  if (!mayManage(actorId, firm.role)) return missing();
  const name = nameValue(input);
  if (!name) return { ok: false, status: 400, detail: "Team name must be 1–120 characters" };
  try {
    const result = await query(
      "insert into public.teams(org_id,name,created_by) values($1,$2,$3) returning id,org_id,name,created_at,updated_at",
      [firm.org_id, name, actorId]);
    return { ok: true, value: result.rows[0] };
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return { ok: false, status: 409, detail: "A team with that name already exists" };
    throw error;
  }
}

export async function updateTeam(query: TeamQuery, actorId: string, teamId: string, input: unknown): Promise<TeamResult<Record<string, unknown>>> {
  const firm = await membership(query, actorId);
  if (!firm || !await teamInFirm(query, teamId, firm.org_id) || !mayManage(actorId, firm.role)) return missing();
  const name = nameValue(input);
  if (!name) return { ok: false, status: 400, detail: "Team name must be 1–120 characters" };
  try {
    const result = await query(
      "update public.teams set name=$3,updated_at=now() where id=$1 and org_id=$2 returning id,org_id,name,created_at,updated_at",
      [teamId, firm.org_id, name]);
    return result.rows[0] ? { ok: true, value: result.rows[0] } : missing();
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return { ok: false, status: 409, detail: "A team with that name already exists" };
    throw error;
  }
}

export async function deleteTeam(query: TeamQuery, actorId: string, teamId: string): Promise<TeamResult<null>> {
  const firm = await membership(query, actorId);
  if (!firm || !mayManage(actorId, firm.role)) return missing();
  const result = await query("delete from public.teams where id=$1 and org_id=$2 returning id", [teamId, firm.org_id]);
  return result.rows[0] ? { ok: true, value: null } : missing();
}

export async function listTeamMembers(query: TeamQuery, actorId: string, teamId: string): Promise<TeamResult<Record<string, unknown>[]>> {
  const firm = await membership(query, actorId);
  if (!firm || !await teamInFirm(query, teamId, firm.org_id)) return missing();
  const result = await query(
    `select tm.user_id, u.email, tm.created_at from public.team_members tm
      join public.users u on u.id=tm.user_id
      where tm.team_id=$1 and tm.org_id=$2 order by u.email`,
    [teamId, firm.org_id]);
  return { ok: true, value: result.rows };
}

export async function addTeamMember(query: TeamQuery, actorId: string, teamId: string, targetId: string): Promise<TeamResult<Record<string, unknown>>> {
  const firm = await membership(query, actorId);
  if (!firm || !await teamInFirm(query, teamId, firm.org_id) || !mayManage(actorId, firm.role)) return missing();
  const target = await query("select user_id from public.org_members where org_id=$1 and user_id=$2", [firm.org_id, targetId]);
  if (!target.rows[0]) return missing();
  try {
    const result = await query(
      "insert into public.team_members(team_id,org_id,user_id) values($1,$2,$3) returning user_id,created_at",
      [teamId, firm.org_id, targetId]);
    return { ok: true, value: result.rows[0] };
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return { ok: false, status: 409, detail: "User is already in this team" };
    if ((error as { code?: string }).code === "23503") return missing();
    throw error;
  }
}

export async function removeTeamMember(query: TeamQuery, actorId: string, teamId: string, targetId: string): Promise<TeamResult<null>> {
  const firm = await membership(query, actorId);
  if (!firm || !mayManage(actorId, firm.role)) return missing();
  const result = await query(
    "delete from public.team_members where team_id=$1 and org_id=$2 and user_id=$3 returning user_id",
    [teamId, firm.org_id, targetId]);
  return result.rows[0] ? { ok: true, value: null } : missing();
}
