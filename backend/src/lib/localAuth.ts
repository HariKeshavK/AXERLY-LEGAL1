// AXERLY modified 2026-09-24.
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { QueryResult } from "pg";

export const MIN_PASSWORD_LENGTH = 12;
const IDLE_MINUTES = 30;
const ABSOLUTE_DAYS = 30;
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function derive(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, length, options, (error, key) => error ? reject(error) : resolve(key)));
}

export interface AuthUser { id: string; email: string; role: "admin" | "member"; status: "active" | "disabled"; }
export interface AuthSession { access_token: string; refresh_token: string; expires_at: number; csrf_token: string; user: AuthUser; }
export interface AuthError extends Error { status: number; code: string; }
type Query = <T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
export interface AuthTokenTransport { get(): string | null; getCsrf(): string | null; set(token: string, csrf: string, expires: Date): void; clear(): void; }

function failure(status: number, code: string, message: string): AuthError { return Object.assign(new Error(message), { status, code }); }
function signingSecret(): string { const value = process.env.AXERLY_SESSION_SECRET?.trim(); if (!value) throw new Error("AXERLY_SESSION_SECRET is not configured"); return value; }
function digest(kind: string, value: string): string { return createHmac("sha256", signingSecret()).update(`${kind}:${value}`).digest("hex"); }
export const sessionTokenHash = (token: string) => digest("session", token);
export const csrfTokenHash = (token: string) => digest("csrf", token);

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw failure(400, "invalid_request", "The authentication request is invalid.");
  const salt = randomBytes(16);
  const key = await derive(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    const [algorithm, n, r, p, salt, hash] = encoded.split("$");
    if (algorithm !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
    const expected = Buffer.from(hash, "base64url");
    const actual = await derive(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

function asUser(row: Record<string, unknown>): AuthUser {
  return { id: String(row.id), email: String(row.email), role: row.role === "admin" ? "admin" : "member", status: row.status === "disabled" ? "disabled" : "active" };
}
let dummyPasswordHash: Promise<string> | undefined;
function dummyHash(): Promise<string> { return dummyPasswordHash ??= hashPassword("not-a-real-password-value"); }

export class LocalAuthApi {
  constructor(private readonly query: Query, private readonly transport?: AuthTokenTransport) {}

  private async createSession(user: AuthUser): Promise<AuthSession> {
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const idle = new Date(Date.now() + IDLE_MINUTES * 60_000);
    const absolute = new Date(Date.now() + ABSOLUTE_DAYS * 86_400_000);
    await this.query("insert into public.sessions(id,user_id,token_hash,csrf_token_hash,idle_expires_at,absolute_expires_at,last_seen_at) values ($1,$2,$3,$4,$5,$6,now())", [randomUUID(), user.id, sessionTokenHash(token), csrfTokenHash(csrf), idle.toISOString(), absolute.toISOString()]);
    this.transport?.set(token, csrf, absolute);
    return { access_token: token, refresh_token: token, csrf_token: csrf, expires_at: Math.floor(absolute.getTime() / 1000), user };
  }

  async register(input: { email: string; password: string; role?: "admin" | "member" }) {
    try {
      const result = await this.query("insert into public.users(id,email,password_hash,role,status) values ($1,$2,$3,$4,'active') returning id,email,role,status", [randomUUID(), input.email.trim().toLowerCase(), await hashPassword(input.password), input.role ?? "member"]);
      const user = asUser(result.rows[0]);
      return { data: { user, session: await this.createSession(user) }, error: null };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return { data: { user: null, session: null }, error: failure(400, "registration_failed", "Registration could not be completed.") };
      throw error;
    }
  }

  async bootstrap(input: { email: string; password: string }) {
    const result = await this.query(`with claim as (insert into public.auth_bootstrap_guard(singleton) values (true) on conflict do nothing returning singleton) insert into public.users(id,email,password_hash,role,status) select $1,$2,$3,'admin','active' from claim returning id,email,role,status`, [randomUUID(), input.email.trim().toLowerCase(), await hashPassword(input.password)]);
    if (!result.rows[0]) return { data: { user: null, session: null }, error: failure(404, "not_found", "Not found.") };
    const user = asUser(result.rows[0]);
    return { data: { user, session: await this.createSession(user) }, error: null };
  }

  async signInWithPassword(credentials: { email: string; password: string }) {
    const result = await this.query("select id,email,password_hash,role,status,locked_until from public.users where email=$1", [credentials.email.trim().toLowerCase()]);
    const row = result.rows[0];
    const valid = await verifyPassword(row ? String(row.password_hash) : await dummyHash(), credentials.password);
    const locked = !!row?.locked_until && new Date(String(row.locked_until)).getTime() > Date.now();
    if (!row || !valid || row.status !== "active" || locked) {
      if (row && !locked) await this.query("update public.users set failed_login_attempts=failed_login_attempts+1, locked_until=case when failed_login_attempts+1 >= $2 then now()+($3::text || ' minutes')::interval else locked_until end where id=$1", [row.id, LOCKOUT_ATTEMPTS, LOCKOUT_MINUTES]);
      return { data: { user: null, session: null }, error: failure(400, "invalid_credentials", "Invalid email or password.") };
    }
    await this.query("update public.users set failed_login_attempts=0,locked_until=null where id=$1", [row.id]);
    const user = asUser(row);
    return { data: { user, session: await this.createSession(user) }, error: null };
  }

  async getUser(explicitToken?: string) {
    const token = explicitToken || this.transport?.get() || "";
    if (!token) return { data: { user: null, sessionRow: null }, error: null };
    const result = await this.query("update public.sessions s set last_seen_at=now(),idle_expires_at=least(now()+($2::text || ' minutes')::interval,absolute_expires_at) from public.users u where s.user_id=u.id and s.token_hash=$1 and s.revoked_at is null and s.idle_expires_at>now() and s.absolute_expires_at>now() and u.status='active' returning u.id,u.email,u.role,u.status,s.absolute_expires_at,s.csrf_token_hash", [sessionTokenHash(token), IDLE_MINUTES]);
    return { data: { user: result.rows[0] ? asUser(result.rows[0]) : null, sessionRow: result.rows[0] ?? null }, error: null };
  }

  async getSession() {
    const token = this.transport?.get() || "";
    const result = await this.getUser(token);
    if (!result.data.user || !token || !result.data.sessionRow) return { data: { session: null }, error: null };
    return { data: { session: { access_token: token, refresh_token: token, expires_at: Math.floor(new Date(String(result.data.sessionRow.absolute_expires_at)).getTime()/1000), user: result.data.user } }, error: null };
  }

  async verifyCsrf(headerToken: string): Promise<boolean> {
    const session = this.transport?.get();
    const cookieToken = this.transport?.getCsrf() ?? "";
    if (!session || !headerToken || !cookieToken) return false;
    const headerDigest = Buffer.from(csrfTokenHash(headerToken), "hex");
    const cookieDigest = Buffer.from(csrfTokenHash(cookieToken), "hex");
    if (headerDigest.length !== cookieDigest.length || !timingSafeEqual(headerDigest, cookieDigest)) return false;
    const result = await this.query("select 1 from public.sessions where token_hash=$1 and csrf_token_hash=$2 and revoked_at is null and idle_expires_at>now() and absolute_expires_at>now()", [sessionTokenHash(session), headerDigest.toString("hex")]);
    return result.rowCount === 1;
  }

  async signOut(options?: { scope?: "global" | "local" }) {
    const token = this.transport?.get();
    if (token && options?.scope === "global") { const current = await this.getUser(token); if (current.data.user) await this.query("update public.sessions set revoked_at=now() where user_id=$1", [current.data.user.id]); }
    else if (token) await this.query("update public.sessions set revoked_at=now() where token_hash=$1", [sessionTokenHash(token)]);
    this.transport?.clear();
    return { error: null };
  }

  async updateUser(values: { email?: string; password?: string }) {
    const current = await this.getUser();
    if (!current.data.user) return { data: { user: null }, error: failure(401, "invalid_session", "Invalid or expired session.") };
    if (values.password) await this.query("update public.users set password_hash=$1 where id=$2", [await hashPassword(values.password), current.data.user.id]);
    if (values.email) await this.query("update public.users set email=$1 where id=$2", [values.email.trim().toLowerCase(), current.data.user.id]);
    return { data: { user: current.data.user }, error: null };
  }

  readonly admin = {
    deleteUser: async (userId: string) => { await this.query("delete from public.users where id=$1", [userId]); return { data: {}, error: null }; },
    getUserById: async (userId: string) => { const result = await this.query("select id,email,role,status from public.users where id=$1", [userId]); return { data: { user: result.rows[0] ? asUser(result.rows[0]) : null }, error: null }; },
    signOut: async (token: string) => { await this.query("update public.sessions set revoked_at=now() where token_hash=$1", [sessionTokenHash(token)]); return { data: {}, error: null }; },
  };
}
