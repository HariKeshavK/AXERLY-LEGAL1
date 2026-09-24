// AXERLY modified 2026-09-24.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EmbeddedPostgresManager } from "../../../db/embedded";
import { runMigrations } from "../../../db/migrations";
import { LocalAuthApi, type AuthTokenTransport } from "../../../lib/localAuth";

const windowsOnly = process.platform === "win32" && process.arch === "x64" ? describe : describe.skip;

windowsOnly("local authentication sessions", () => {
  let root = "";
  let manager: EmbeddedPostgresManager;
  let client: Client;
  let token: string | null = null;
  let csrf: string | null = null;
  const transport: AuthTokenTransport = {
    get: () => token,
    getCsrf: () => csrf,
    set: (nextToken, nextCsrf) => { token = nextToken; csrf = nextCsrf; },
    clear: () => { token = null; csrf = null; },
  };
  let auth: LocalAuthApi;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "axerly-auth-test-"));
    process.env.AXERLY_DATA_DIR = root;
    manager = new EmbeddedPostgresManager(root);
    const info = await manager.start();
    process.env.AXERLY_SESSION_SECRET = info.secrets.sessionSecret;
    await runMigrations({ adminUrl: info.adminUrl, appPassword: info.secrets.postgresPassword });
    client = new Client({ connectionString: info.adminUrl });
    await client.connect();
    auth = new LocalAuthApi((text, values) => client.query(text, values), transport);
  }, 60_000);

  beforeEach(async () => {
    token = null; csrf = null;
    await client.query("delete from public.users");
    await client.query("delete from public.auth_bootstrap_guard");
  });

  afterAll(async () => {
    await client?.end();
    await manager?.stop();
    if (root.startsWith(os.tmpdir())) await rm(root, { recursive: true, force: true });
    delete process.env.AXERLY_DATA_DIR;
  }, 60_000);

  async function register(email = "lawyer@example.test") {
    const result = await auth.register({ email, password: "a-secure-password", role: "admin" });
    expect(result.error).toBeNull();
    return result.data.user!;
  }

  it("allows development bootstrap exactly once", async () => {
    const first = await auth.bootstrap({ email: "owner@example.test", password: "a-secure-password" });
    expect(first.data.user?.role).toBe("admin");
    const second = await auth.bootstrap({ email: "other@example.test", password: "another-secure-password" });
    expect(second.error?.code).toBe("not_found");
  });

  it("registers and logs in with a lowercased email", async () => {
    await register("Lawyer@Example.Test");
    await auth.signOut();
    const login = await auth.signInWithPassword({ email: "LAWYER@example.test", password: "a-secure-password" });
    expect(login.error).toBeNull();
    expect(login.data.user?.email).toBe("lawyer@example.test");
    expect(token).toBeTruthy();
    expect(csrf).toBeTruthy();
  });

  it("revokes the current session on logout", async () => {
    await register();
    const raw = token;
    await auth.signOut();
    expect((await auth.getUser(raw!)).data.user).toBeNull();
  });

  it("requires the session-bound CSRF token", async () => {
    await register();
    expect(await auth.verifyCsrf(csrf!)).toBe(true);
    expect(await auth.verifyCsrf("a-different-random-token")).toBe(false);
  });

  it("rejects idle and absolute session expiry", async () => {
    await register();
    await client.query("update public.sessions set idle_expires_at=now()-interval '1 second'");
    expect((await auth.getUser()).data.user).toBeNull();
    await client.query("update public.sessions set idle_expires_at=now()+interval '1 hour',absolute_expires_at=now()-interval '1 second'");
    expect((await auth.getUser()).data.user).toBeNull();
  });

  it("revokes sessions after a password change, demotion, or removal", async () => {
    const user = await register();
    await auth.updateUser({ password: "a-new-secure-password" });
    expect((await auth.getUser()).data.user).toBeNull();
    await auth.signInWithPassword({ email: user.email, password: "a-new-secure-password" });
    await client.query("update public.users set role='member' where id=$1", [user.id]);
    expect((await auth.getUser()).data.user).toBeNull();
    await auth.signInWithPassword({ email: user.email, password: "a-new-secure-password" });
    await client.query("delete from public.users where id=$1", [user.id]);
    expect((await auth.getUser()).data.user).toBeNull();
  });

  it("locks an account after repeated failures and keeps errors generic", async () => {
    await register();
    await auth.signOut();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await auth.signInWithPassword({ email: "lawyer@example.test", password: "wrong-password-value" });
      expect(result.error?.message).toBe("Invalid email or password.");
    }
    const valid = await auth.signInWithPassword({ email: "lawyer@example.test", password: "a-secure-password" });
    expect(valid.error?.message).toBe("Invalid email or password.");
    const row = await client.query("select locked_until from public.users where email='lawyer@example.test'");
    expect(new Date(row.rows[0].locked_until).getTime()).toBeGreaterThan(Date.now());
  });
});
