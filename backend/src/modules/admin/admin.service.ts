// AXERLY modified 2026-09-25.
import { randomUUID } from "node:crypto";
import { databasePool } from "../../lib/database";
import { hashPassword } from "../../lib/localAuth";
import { newJoinCredentials, OnboardingError } from "../onboarding/onboarding.service";

async function firmId(): Promise<string> {
  const result = await databasePool().query<{ id: string }>("select id from public.organizations limit 1");
  if (!result.rows[0]) throw new OnboardingError(404, "not_found", "Organization not found.");
  return result.rows[0].id;
}
export async function adminUsers() {
  const id = await firmId();
  const result = await databasePool().query(`select u.id,u.email,u.role,u.status,u.created_at,u.must_change_password,
    coalesce(array_agg(t.name order by t.name) filter(where t.id is not null),'{}') as teams
    from public.org_members m join public.users u on u.id=m.user_id
    left join public.team_members tm on tm.user_id=u.id and tm.org_id=m.org_id
    left join public.teams t on t.id=tm.team_id where m.org_id=$1
    group by u.id order by u.created_at`, [id]);
  return result.rows;
}
export async function changeUserRole(actorId: string, targetId: string, role: "admin" | "member"): Promise<void> {
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    const org = await client.query<{ id: string }>("select id from public.organizations limit 1 for update");
    const orgId = org.rows[0]?.id;
    if (!orgId) throw new OnboardingError(404, "not_found", "User not found.");
    const target = await client.query<{ role: string }>("select role from public.org_members where org_id=$1 and user_id=$2", [orgId, targetId]);
    if (!target.rows[0]) throw new OnboardingError(404, "not_found", "User not found.");
    if (target.rows[0].role === "admin" && role === "member") {
      const count = await client.query<{ count: string }>("select count(*)::text as count from public.org_members m join public.users u on u.id=m.user_id where m.org_id=$1 and m.role='admin' and u.status='active'", [orgId]);
      if (Number(count.rows[0]?.count ?? 0) <= 1) throw new OnboardingError(409, "last_admin", "The final administrator cannot be demoted.");
    }
    await client.query("update public.org_members set role=$3,updated_at=now() where org_id=$1 and user_id=$2", [orgId, targetId, role]);
    await client.query("update public.users set role=$2 where id=$1", [targetId, role]);
    await client.query("insert into public.audit_events(user_id,action,surface,detail) values($1,'user.role_changed','admin',$2)", [actorId, JSON.stringify({ target_id: targetId, role })]);
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
export async function disableUser(actorId: string, targetId: string): Promise<void> {
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    const org = await client.query<{ id: string }>("select id from public.organizations limit 1 for update");
    const orgId = org.rows[0]?.id;
    if (!orgId) throw new OnboardingError(404, "not_found", "User not found.");
    const target = await client.query<{ role: string; status: string }>("select m.role,u.status from public.org_members m join public.users u on u.id=m.user_id where m.org_id=$1 and m.user_id=$2", [orgId, targetId]);
    if (!target.rows[0]) throw new OnboardingError(404, "not_found", "User not found.");
    if (target.rows[0].role === "admin") {
      const count = await client.query<{ count: string }>("select count(*)::text as count from public.org_members m join public.users u on u.id=m.user_id where m.org_id=$1 and m.role='admin' and u.status='active'", [orgId]);
      if (Number(count.rows[0]?.count ?? 0) <= 1) throw new OnboardingError(409, "last_admin", "The final administrator cannot be removed.");
    }
    await client.query("update public.users set status='disabled' where id=$1", [targetId]);
    await client.query("delete from public.team_members where org_id=$1 and user_id=$2", [orgId, targetId]);
    await client.query("insert into public.audit_events(user_id,action,surface,detail) values($1,'user.removed','admin',$2)", [actorId, JSON.stringify({ target_id: targetId })]);
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
export async function temporaryPassword(actorId: string, targetId: string): Promise<string> {
  const credential = `${newJoinCredentials().password}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    const updated = await client.query("update public.users set password_hash=$2,must_change_password=true where id=$1 and status='active' and exists(select 1 from public.org_members where user_id=$1) returning id", [targetId, await hashPassword(credential)]);
    if (!updated.rows[0]) throw new OnboardingError(404, "not_found", "User not found.");
    await client.query("insert into public.audit_events(user_id,action,surface,detail) values($1,'user.password_reset','admin',$2)", [actorId, JSON.stringify({ target_id: targetId })]);
    await client.query("commit");
    return credential;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
export async function rotateJoinCredentials(actorId: string): Promise<{ code: string; password: string }> {
  const credentials = newJoinCredentials();
  const hash = await hashPassword(credentials.password);
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    const firm = await client.query<{ org_id: string }>("select org_id from public.firm_settings limit 1 for update");
    if (!firm.rows[0]) throw new OnboardingError(404, "not_found", "Organization not found.");
    await client.query("update public.firm_settings set org_code=$2,org_password_hash=$3,updated_at=now() where org_id=$1", [firm.rows[0].org_id, credentials.code, hash]);
    await client.query("delete from public.join_tokens where org_id=$1 and consumed_at is null", [firm.rows[0].org_id]);
    await client.query("insert into public.audit_events(user_id,action,surface) values($1,'firm.join_credentials_rotated','admin')", [actorId]);
    await client.query("commit");
    return credentials;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
export async function firmDetails() {
  const result = await databasePool().query("select org_id,name,org_code,updated_at from public.firm_settings limit 1");
  if (!result.rows[0]) throw new OnboardingError(404, "not_found", "Organization not found.");
  return result.rows[0];
}
export async function adminAudit() {
  const id = await firmId();
  const result = await databasePool().query(`select a.id,a.created_at,a.user_id,a.user_email,a.action,a.status,a.surface,
    coalesce(a.detail->>'target_id',a.detail->>'resource_id') as target_id
    from public.audit_events a where a.user_id in(select user_id from public.org_members where org_id=$1)
    order by a.created_at desc limit 200`, [id]);
  return result.rows;
}
// Organization-scoped user_id is provenance, not ownership. Only standalone
// personal resources can be transferred by changing their implicit owner.
const OWNERSHIP_TABLES = {
  project: { table: "projects", condition: "org_id is null" },
  workflow: { table: "workflows", condition: "org_id is null" },
  document: { table: "documents", condition: "org_id is null and project_id is null and workflow_id is null" },
  chat: { table: "chats", condition: "org_id is null and project_id is null" },
} as const;
export async function transferOwnership(actorId: string, fromId: string, toId: string, kind: keyof typeof OWNERSHIP_TABLES, resourceId: string): Promise<void> {
  const { table, condition } = OWNERSHIP_TABLES[kind];
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    const org = await client.query<{ id: string }>("select id from public.organizations limit 1 for update");
    const orgId = org.rows[0]?.id;
    if (!orgId) throw new OnboardingError(404, "not_found", "Resource not found.");
    const target = await client.query("select 1 from public.org_members m join public.users u on u.id=m.user_id where m.org_id=$1 and m.user_id=$2 and u.status='active'", [orgId, toId]);
    if (!target.rows[0]) throw new OnboardingError(404, "not_found", "Resource not found.");
    // Transfers are a recovery tool for departing users, not a way to inspect
    // or seize an active colleague's private work.
    const source = await client.query("select 1 from public.org_members m join public.users u on u.id=m.user_id where m.org_id=$1 and m.user_id=$2 and u.status='disabled'", [orgId, fromId]);
    if (!source.rows[0]) throw new OnboardingError(404, "not_found", "Resource not found.");
    const moved = await client.query(`update public.${table} set user_id=$3 where id=$1 and user_id=$2 and ${condition} returning id`, [resourceId, fromId, toId]);
    if (!moved.rows[0]) throw new OnboardingError(404, "not_found", "Resource not found.");
    await client.query("insert into public.audit_events(user_id,action,surface,detail) values($1,'resource.ownership_transferred','admin',$2)", [actorId, JSON.stringify({ from_id: fromId, to_id: toId, kind, resource_id: resourceId })]);
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
