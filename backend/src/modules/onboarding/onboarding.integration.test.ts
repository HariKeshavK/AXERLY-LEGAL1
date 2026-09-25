// AXERLY modified 2026-09-25.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prepareDatabaseRuntime } from "../../db/runtime";
import { embeddedPostgresManager } from "../../db/embedded";
import { databasePool } from "../../lib/database";
import { csrfTokenHash, sessionTokenHash } from "../../lib/localAuth";

vi.mock("../../licensing/licenseClient", () => ({
  freshlyActivatedLicense: async () => ({ max_users: 3 }),
  verifiedLicense: async () => ({ max_users: 3 }),
}));

import { createFirstFirm, registerWithJoinToken, verifyJoin } from "./onboarding.service";
import { changeUserRole, disableUser, temporaryPassword, transferOwnership } from "../admin/admin.service";
import { adminAudit } from "../admin/admin.service";
import { writeSecurityEvent } from "../../middleware/securityAudit";

describe("P6 onboarding on bundled PostgreSQL", () => {
  let tempDir: string;
  let adminId: string;
  let code: string;
  let joinPassword: string;
  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axerly-p6-test-"));
    process.env.AXERLY_DATA_DIR = tempDir;
    await prepareDatabaseRuntime({ forceEmbedded: true });
    const created = await createFirstFirm({ name: "Test Firm", email: "admin@example.test", password: "a-test-password-123" });
    code = created.credentials.code;
    joinPassword = created.credentials.password;
    const admin = await databasePool().query<{ id: string }>("select id from public.users where email='admin@example.test'");
    adminId = admin.rows[0].id;
  }, 90_000);
  afterAll(async () => {
    await databasePool().end();
    await embeddedPostgresManager().stop();
    if (tempDir && path.basename(tempDir).startsWith("axerly-p6-test-") && path.dirname(tempDir) === os.tmpdir())
      await rm(tempDir, { recursive: true, force: true });
    delete process.env.AXERLY_DATA_DIR;
    delete process.env.DATABASE_URL;
  }, 30_000);

  it("creates one firm and refuses a second setup", async () => {
    const orgs = await databasePool().query("select id from public.organizations");
    expect(orgs.rowCount).toBe(1);
    await expect(createFirstFirm({ name: "Other", email: "other@example.test", password: "another-long-password" }))
      .rejects.toMatchObject({ code: "already_created" });
  });
  it("uses a generic error and locks out an IP after five bad attempts", async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(verifyJoin(code, "wrong-password", "198.51.100.1")).rejects.toMatchObject({ code: "join_failed" });
    await expect(verifyJoin(code, joinPassword, "198.51.100.1")).rejects.toMatchObject({ code: "rate_limited" });
  });
  it("binds a 10-minute join token to its IP and consumes it once", async () => {
    const token = await verifyJoin(code, joinPassword, "198.51.100.2");
    await expect(registerWithJoinToken({ token, ip: "198.51.100.3", email: "wrongip@example.test", password: "member-password-123" }))
      .rejects.toMatchObject({ code: "join_failed" });
    await registerWithJoinToken({ token, ip: "198.51.100.2", email: "member@example.test", password: "member-password-123" });
    await expect(registerWithJoinToken({ token, ip: "198.51.100.2", email: "other@example.test", password: "member-password-123" }))
      .rejects.toMatchObject({ code: "join_failed" });
    const expired = await verifyJoin(code, joinPassword, "198.51.100.4");
    await databasePool().query("update public.join_tokens set expires_at=now()-interval '1 second' where consumed_at is null");
    await expect(registerWithJoinToken({ token: expired, ip: "198.51.100.4", email: "expired@example.test", password: "member-password-123" }))
      .rejects.toMatchObject({ code: "join_failed" });
  });
  it("enforces the signed seat count before registration", async () => {
    const second = await verifyJoin(code, joinPassword, "198.51.100.5");
    await registerWithJoinToken({ token: second, ip: "198.51.100.5", email: "member2@example.test", password: "member-password-123" });
    const third = await verifyJoin(code, joinPassword, "198.51.100.6");
    await expect(registerWithJoinToken({ token: third, ip: "198.51.100.6", email: "member3@example.test", password: "member-password-123" }))
      .rejects.toMatchObject({ code: "seat_limit" });
  });
  it("never demotes or removes the sole active administrator under concurrent requests", async () => {
    const [demotion, removal] = await Promise.allSettled([
      changeUserRole(adminId, adminId, "member"), disableUser(adminId, adminId),
    ]);
    expect(demotion.status).toBe("rejected");
    expect(removal.status).toBe("rejected");
    const row = await databasePool().query("select role,status from public.users where id=$1", [adminId]);
    expect(row.rows[0]).toMatchObject({ role: "admin", status: "active" });
  });
  it("revokes sessions on role change and removal", async () => {
    const member = await databasePool().query<{ id: string }>("select id from public.users where email='member2@example.test'");
    const id = member.rows[0].id;
    const sessionId = randomUUID();
    await databasePool().query(`insert into public.sessions(id,user_id,token_hash,csrf_token_hash,idle_expires_at,absolute_expires_at)
      values($1,$2,$3,$4,now()+interval '30 minutes',now()+interval '30 days')`,
      [sessionId, id, sessionTokenHash("role-session"), csrfTokenHash("role-csrf")]);
    await changeUserRole(adminId, id, "admin");
    const changed = await databasePool().query("select revoked_at from public.sessions where id=$1", [sessionId]);
    expect(changed.rows[0].revoked_at).not.toBeNull();
    const removalSession = randomUUID();
    await databasePool().query(`insert into public.sessions(id,user_id,token_hash,csrf_token_hash,idle_expires_at,absolute_expires_at)
      values($1,$2,$3,$4,now()+interval '30 minutes',now()+interval '30 days')`,
      [removalSession, id, sessionTokenHash("removal-session"), csrfTokenHash("removal-csrf")]);
    await disableUser(adminId, id);
    const removed = await databasePool().query("select revoked_at from public.sessions where id=$1", [removalSession]);
    expect(removed.rows[0].revoked_at).not.toBeNull();
  });
  it("forces a password change when an admin resets a member password", async () => {
    const member = await databasePool().query<{ id: string }>("select id from public.users where email='member@example.test'");
    const sessionId = randomUUID();
    await databasePool().query(`insert into public.sessions(id,user_id,token_hash,csrf_token_hash,idle_expires_at,absolute_expires_at)
      values($1,$2,$3,$4,now()+interval '30 minutes',now()+interval '30 days')`,
      [sessionId, member.rows[0].id, sessionTokenHash("test-session"), csrfTokenHash("test-csrf")]);
    const credential = await temporaryPassword(adminId, member.rows[0].id);
    expect(credential.length).toBeGreaterThanOrEqual(12);
    const row = await databasePool().query("select must_change_password from public.users where id=$1", [member.rows[0].id]);
    expect(row.rows[0].must_change_password).toBe(true);
    const session = await databasePool().query("select revoked_at from public.sessions where id=$1", [sessionId]);
    expect(session.rows[0].revoked_at).not.toBeNull();
  });
  it("audits ownership transfer only for a departed user's personal resource", async () => {
    const member = await databasePool().query<{ id: string }>("select id from public.users where email='member@example.test'");
    const privateWorkflow = await databasePool().query<{ id: string }>(
      "insert into public.workflows(user_id,title,type) values($1,'Departing work','custom') returning id", [member.rows[0].id]);
    await disableUser(adminId, member.rows[0].id);
    await transferOwnership(adminId, member.rows[0].id, adminId, "workflow", privateWorkflow.rows[0].id);
    const moved = await databasePool().query("select user_id from public.workflows where id=$1", [privateWorkflow.rows[0].id]);
    expect(moved.rows[0].user_id).toBe(adminId);
    const audit = await databasePool().query("select action from public.audit_events where action='resource.ownership_transferred' and user_id=$1", [adminId]);
    expect(audit.rowCount).toBe(1);
  });
  it("records anonymous failures with a one-way IP hash and exposes no request body", async () => {
    await writeSecurityEvent({ action: "join.verify", ip: "198.51.100.99", status: 400 });
    const rows = await databasePool().query("select actor_id,ip_hash,action,http_status from public.security_audit_events where action='join.verify'");
    expect(rows.rows[0]).toMatchObject({ actor_id: null, action: "join.verify", http_status: 400 });
    expect(rows.rows[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.rows)).not.toContain("198.51.100.99");
    const feed = await adminAudit();
    expect(feed.some((row: { action: string }) => row.action === "join.verify")).toBe(true);
  });
});
