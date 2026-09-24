// AXERLY modified 2026-09-23.
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { QueryResult } from "pg";

const SESSION_DAYS = 30;

function deriveKey(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

export interface AuthUser {
  id: string;
  email: string;
  new_email?: string | null;
  app_metadata?: { provider?: string };
  factors?: Array<{ id: string; factor_type: string; status: string }>;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
}

export interface AuthError extends Error {
  status: number;
  code: string;
}

type Query = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<T>>;

export interface AuthTokenTransport {
  get(): string | null;
  set(token: string, expires: Date): void;
  clear(): void;
}

function authError(status: number, code: string, message: string): AuthError {
  return Object.assign(new Error(message), { status, code });
}

function sessionSecret(): string {
  const secret = process.env.AXERLY_SESSION_SECRET?.trim();
  if (!secret) throw new Error("AXERLY_SESSION_SECRET is not configured");
  return secret;
}

function tokenHash(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, 32, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  encoded: string,
  password: string,
): Promise<boolean> {
  const [algorithm, n, r, p, saltText, hashText] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltText || !hashText) {
    return false;
  }
  const expected = Buffer.from(hashText, "base64url");
  const actual = await deriveKey(password, Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function toUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    email: String(row.email),
    new_email: null,
    app_metadata: { provider: "email" },
    factors: [],
  };
}

export class LocalAuthApi {
  readonly mfa: any;
  readonly admin: any;

  constructor(
    private readonly query: Query,
    private readonly transport?: AuthTokenTransport,
  ) {
    this.mfa = {
      listFactors: async () => ({ data: { all: [], totp: [], phone: [] }, error: null }),
      getAuthenticatorAssuranceLevel: async (token?: string) => {
        const result = await this.getUser(token);
        return result.data.user
          ? { data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }
          : { data: { currentLevel: null, nextLevel: null }, error: result.error };
      },
      enroll: async () => this.unsupported("mfa_unavailable", "MFA is not available in this build."),
      challenge: async () => this.unsupported("mfa_unavailable", "MFA is not available in this build."),
      verify: async () => this.unsupported("mfa_unavailable", "MFA is not available in this build."),
      challengeAndVerify: async () => this.unsupported("mfa_unavailable", "MFA is not available in this build."),
      unenroll: async () => this.unsupported("mfa_unavailable", "MFA is not available in this build."),
    };
    this.admin = {
      getUserById: async (userId: string) => {
        const result = await this.query(
          "select id, email from public.users where id = $1",
          [userId],
        );
        return { data: { user: result.rows[0] ? toUser(result.rows[0]) : null }, error: null };
      },
      deleteUser: async (userId: string) => {
        await this.query("delete from public.users where id = $1", [userId]);
        return { data: {}, error: null };
      },
      signOut: async (token: string, scope: "global" | "local" = "local") => {
        const found = await this.getUser(token);
        if (scope === "global" && found.data.user) {
          await this.query("update public.auth_sessions set revoked_at = now() where user_id = $1", [found.data.user.id]);
        } else {
          await this.query("update public.auth_sessions set revoked_at = now() where token_hash = $1", [tokenHash(token)]);
        }
        return { data: {}, error: null };
      },
    };
  }

  private unsupported(code: string, message: string) {
    return { data: null, error: authError(400, code, message) };
  }

  private async createSession(user: AuthUser): Promise<AuthSession> {
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await this.query(
      `insert into public.auth_sessions(id, user_id, token_hash, expires_at)
       values ($1, $2, $3, $4)`,
      [randomUUID(), user.id, tokenHash(token), expires.toISOString()],
    );
    this.transport?.set(token, expires);
    return {
      access_token: token,
      refresh_token: token,
      expires_at: Math.floor(expires.getTime() / 1000),
      user,
    };
  }

  async signInWithPassword(credentials: { email: string; password: string }) {
    const email = credentials.email.trim().toLowerCase();
    const result = await this.query(
      `select id, email, password_hash, status from public.users where email = $1`,
      [email],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.status !== "active" ||
      !(await verifyPassword(String(row.password_hash), credentials.password))
    ) {
      return {
        data: { user: null, session: null },
        error: authError(400, "invalid_credentials", "Invalid email or password."),
      };
    }
    const user = toUser(row);
    return { data: { user, session: await this.createSession(user) }, error: null };
  }

  async signUp(input: { email: string; password: string; options?: unknown }): Promise<any> {
    const email = input.email.trim().toLowerCase();
    try {
      const result = await this.query(
        `insert into public.users(id, email, password_hash, role, status)
         values ($1, $2, $3, 'member', 'active')
         returning id, email`,
        [randomUUID(), email, await hashPassword(input.password)],
      );
      const user = toUser(result.rows[0]);
      return { data: { user, session: await this.createSession(user) }, error: null };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return {
          data: { user: null, session: null },
          error: authError(400, "user_already_exists", "An account already exists for this email."),
        };
      }
      throw error;
    }
  }

  signInWithOAuth(_options?: unknown): Promise<any> {
    return Promise.resolve(this.unsupported("oauth_unavailable", "OAuth is not available in this build."));
  }

  signInWithSSO(_options?: unknown): Promise<any> {
    return Promise.resolve(this.unsupported("sso_unavailable", "Single sign-on is not available in this build."));
  }

  exchangeCodeForSession(_code?: string): Promise<any> {
    return Promise.resolve(this.unsupported("oauth_unavailable", "OAuth is not available in this build."));
  }

  resetPasswordForEmail(_email?: string, _options?: unknown): Promise<any> {
    // Enumeration-safe no-op until the host-owned mail delivery flow is added.
    return Promise.resolve({ data: {}, error: null });
  }

  async getUser(explicitToken?: string) {
    const token = explicitToken || this.transport?.get() || "";
    if (!token) return { data: { user: null }, error: null };
    const result = await this.query(
      `select u.id, u.email
         from public.auth_sessions s
         join public.users u on u.id = s.user_id
        where s.token_hash = $1
          and s.revoked_at is null
          and s.expires_at > now()
          and u.status = 'active'`,
      [tokenHash(token)],
    );
    return { data: { user: result.rows[0] ? toUser(result.rows[0]) : null }, error: null };
  }

  async getSession() {
    const token = this.transport?.get() || "";
    const userResult = await this.getUser(token);
    if (!userResult.data.user || !token) {
      return { data: { session: null }, error: null };
    }
    return {
      data: {
        session: {
          access_token: token,
          refresh_token: token,
          expires_at: 0,
          user: userResult.data.user,
        },
      },
      error: null,
    };
  }

  async setSession(tokens: { access_token: string; refresh_token: string }) {
    const userResult = await this.getUser(tokens.access_token);
    const user = userResult.data.user;
    if (!user) {
      return { data: { user: null, session: null }, error: authError(400, "invalid_session", "Session is invalid.") };
    }
    this.transport?.set(tokens.access_token, new Date(Date.now() + SESSION_DAYS * 86_400_000));
    return {
      data: {
        user,
        session: { ...tokens, expires_at: 0, user },
      },
      error: null,
    };
  }

  async signOut(options?: { scope?: "global" | "local" }) {
    const token = this.transport?.get();
    if (token) {
      const userResult = await this.getUser(token);
      if (options?.scope === "global" && userResult.data.user) {
        await this.query("update public.auth_sessions set revoked_at = now() where user_id = $1", [userResult.data.user.id]);
      } else {
        await this.query("update public.auth_sessions set revoked_at = now() where token_hash = $1", [tokenHash(token)]);
      }
    }
    this.transport?.clear();
    return { error: null };
  }

  async updateUser(values: { email?: string; password?: string }, _options?: unknown): Promise<any> {
    const token = this.transport?.get() || "";
    const current = await this.getUser(token);
    if (!current.data.user) {
      return { data: { user: null }, error: authError(401, "invalid_session", "Session is invalid.") };
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (values.email) {
      params.push(values.email.trim().toLowerCase());
      sets.push(`email = $${params.length}`);
    }
    if (values.password) {
      params.push(await hashPassword(values.password));
      sets.push(`password_hash = $${params.length}`);
    }
    if (sets.length) {
      params.push(current.data.user.id);
      await this.query(`update public.users set ${sets.join(", ")} where id = $${params.length}`, params);
    }
    return this.getUser(token);
  }
}
