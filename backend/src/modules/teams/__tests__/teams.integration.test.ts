// AXERLY modified 2026-09-24.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EmbeddedPostgresManager } from "../../../db/embedded";
import { runMigrations } from "../../../db/migrations";
import {
  addTeamMember, createTeam, deleteTeam, listTeamMembers, listTeams,
  removeTeamMember, teamIdsForUser, updateTeam, type TeamQuery,
} from "../teams.service";

const windowsOnly = process.platform === "win32" && process.arch === "x64" ? describe : describe.skip;

windowsOnly("single firm and many teams", () => {
  let root = "";
  let manager: EmbeddedPostgresManager;
  let client: Client;
  let query: TeamQuery;
  let firmId: string;
  let adminId: string;
  let memberId: string;
  let secondMemberId: string;
  let outsiderId: string;

  async function user(email: string): Promise<string> {
    const id = randomUUID();
    await client.query(
      "insert into public.users(id,email,password_hash) values($1,$2,$3)",
      [id, email, randomBytes(32).toString("hex")]);
    return id;
  }

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "axerly-teams-test-"));
    manager = new EmbeddedPostgresManager(root);
    const info = await manager.start();
    await runMigrations({ adminUrl: info.adminUrl, appPassword: info.secrets.postgresPassword });
    client = new Client({ connectionString: info.adminUrl });
    await client.connect();
    query = (sql, values) => client.query(sql, values);
  }, 60_000);

  beforeEach(async () => {
    await client.query("delete from public.organizations");
    await client.query("delete from public.users");
    adminId = await user("admin@example.test");
    memberId = await user("member@example.test");
    secondMemberId = await user("second@example.test");
    outsiderId = await user("outsider@example.test");
    firmId = randomUUID();
    await client.query("insert into public.organizations(id,name,created_by) values($1,$2,$3)",
      [firmId, "AXERLY Firm", adminId]);
    await client.query("insert into public.org_members(org_id,user_id,role) values($1,$2,'admin'),($1,$3,'member'),($1,$4,'member')",
      [firmId, adminId, memberId, secondMemberId]);
  });

  afterAll(async () => {
    await client?.end();
    await manager?.stop();
    if (root.startsWith(os.tmpdir())) await rm(root, { recursive: true, force: true });
  }, 60_000);

  it("keeps a single firm row and synchronizes its private settings", async () => {
    const settings = await client.query("select name,org_code,org_password_hash from public.firm_settings where org_id=$1", [firmId]);
    expect(settings.rows[0]).toEqual({ name: "AXERLY Firm", org_code: null, org_password_hash: null });
    await client.query("update public.organizations set name='Renamed Firm' where id=$1", [firmId]);
    expect((await client.query("select name from public.firm_settings where org_id=$1", [firmId])).rows[0].name).toBe("Renamed Firm");
    await expect(client.query("insert into public.organizations(name) values('Second Firm')"))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("allows a member to belong to many teams without granting other users team membership", async () => {
    const a = await createTeam(query, adminId, "Litigation");
    const b = await createTeam(query, adminId, "Corporate");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    await addTeamMember(query, adminId, String(a.value.id), memberId);
    await addTeamMember(query, adminId, String(b.value.id), memberId);
    expect(await teamIdsForUser(query, memberId)).toEqual([String(a.value.id), String(b.value.id)].sort());
    const mine = await listTeams(query, memberId);
    expect(mine.ok && mine.value.filter((team) => team.is_member).map((team) => team.name))
      .toEqual(["Corporate", "Litigation"]);
    const other = await listTeams(query, secondMemberId);
    expect(other.ok && other.value.every((team) => !team.is_member)).toBe(true);
    expect((await listTeamMembers(query, adminId, String(a.value.id))).ok).toBe(true);
  });

  it("supports admin CRUD but denies members and outsiders", async () => {
    expect((await createTeam(query, memberId, "Hidden")).ok).toBe(false);
    expect((await listTeams(query, outsiderId)).ok).toBe(false);
    const created = await createTeam(query, adminId, "Litigation");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = String(created.value.id);
    expect(await createTeam(query, adminId, " litigation ")).toMatchObject({ ok: false, status: 409 });
    expect(await updateTeam(query, memberId, id, "Other")).toMatchObject({ ok: false, status: 404 });
    expect(await updateTeam(query, adminId, id, "Disputes")).toMatchObject({ ok: true, value: { name: "Disputes" } });
    expect(await deleteTeam(query, memberId, id)).toMatchObject({ ok: false, status: 404 });
    expect(await deleteTeam(query, adminId, id)).toMatchObject({ ok: true });
    expect(await listTeamMembers(query, adminId, id)).toMatchObject({ ok: false, status: 404 });
  });

  it("accepts only firm members and revokes team membership when a user leaves the firm", async () => {
    const created = await createTeam(query, adminId, "Litigation");
    if (!created.ok) throw new Error("Failed to create test team");
    const id = String(created.value.id);
    expect(await addTeamMember(query, adminId, id, outsiderId)).toMatchObject({ ok: false, status: 404 });
    expect(await addTeamMember(query, adminId, id, memberId)).toMatchObject({ ok: true });
    expect(await addTeamMember(query, adminId, id, memberId)).toMatchObject({ ok: false, status: 409 });
    await client.query("delete from public.org_members where org_id=$1 and user_id=$2", [firmId, memberId]);
    expect((await client.query("select count(*)::integer as n from public.team_members where team_id=$1", [id])).rows[0].n).toBe(0);
    expect(await removeTeamMember(query, adminId, id, memberId)).toMatchObject({ ok: false, status: 404 });
  });
});
