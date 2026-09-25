// AXERLY modified 2026-09-25.
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool } from "../../lib/database";
import { hashPassword, verifyPassword } from "../../lib/localAuth";
import { loadOrCreateSecrets } from "../../config/secrets";
import { freshlyActivatedLicense, verifiedLicense } from "../../licensing/licenseClient";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export class OnboardingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function tokenString(length: number): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
export function newJoinCredentials(): { code: string; password: string } {
  const code = tokenString(8);
  return { code: `AXR-${code.slice(0, 4)}-${code.slice(4)}`, password: `${tokenString(5)}-${tokenString(5)}-${tokenString(5)}-${tokenString(5)}` };
}
function normalCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").replaceAll("O", "0").replace(/[IL]/g, "1");
}
function sameCode(a: string, b: string): boolean {
  const left = createHmac("sha256", "AXERLY-join-code").update(normalCode(a)).digest();
  const right = createHmac("sha256", "AXERLY-join-code").update(normalCode(b)).digest();
  return timingSafeEqual(left, right);
}
async function secretDigest(kind: string, value: string): Promise<string> {
  const secrets = await loadOrCreateSecrets();
  return createHmac("sha256", secrets.sessionSecret).update(`${kind}:${value}`).digest("hex");
}
const genericJoinFailure = () => new OnboardingError(400, "join_failed", "Invalid organization code or password.");
let dummyHash: Promise<string> | undefined;
function dummyPasswordHash(): Promise<string> { return dummyHash ??= hashPassword("not-a-real-join-password"); }

export async function setupStatus(): Promise<{ created: boolean }> {
  const result = await databasePool().query("select 1 from public.organizations limit 1");
  return { created: result.rowCount === 1 };
}

export async function createFirstFirm(input: { name: string; email: string; password: string }): Promise<{ orgId: string; credentials: { code: string; password: string } }> {
  const claims = await freshlyActivatedLicense();
  if (!claims) throw new OnboardingError(403, "license_inactive", "Activate a valid license before creating an organization.");
  const credentials = newJoinCredentials();
  const [adminHash, joinHash] = await Promise.all([hashPassword(input.password), hashPassword(credentials.password)]);
  const client = await databasePool().connect();
  const userId = randomUUID();
  const orgId = randomUUID();
  try {
    await client.query("begin");
    const guard = await client.query("insert into public.auth_bootstrap_guard(singleton) values(true) on conflict do nothing returning singleton");
    if (guard.rowCount !== 1) throw new OnboardingError(409, "already_created", "Organization setup has already completed.");
    await client.query("insert into public.users(id,email,password_hash,role,status) values($1,$2,$3,'admin','active')", [userId, input.email.toLowerCase(), adminHash]);
    await client.query("insert into public.organizations(id,name,created_by) values($1,$2,$3)", [orgId, input.name, userId]);
    await client.query("insert into public.org_members(org_id,user_id,role) values($1,$2,'admin')", [orgId, userId]);
    await client.query("update public.firm_settings set org_code=$2,org_password_hash=$3,updated_at=now() where org_id=$1", [orgId, credentials.code, joinHash]);
    await client.query("insert into public.audit_events(user_id,user_email,action,surface,detail) values($1,$2,'firm.created','setup',$3)", [userId, input.email.toLowerCase(), JSON.stringify({ org_id: orgId })]);
    await client.query("commit");
    return { orgId, credentials };
  } catch (error) {
    await client.query("rollback");
    if ((error as { code?: string }).code === "23505") throw new OnboardingError(409, "already_created", "Organization setup could not be completed.");
    throw error;
  } finally { client.release(); }
}

async function joinFailure(client: PoolClient, ipHash: string): Promise<void> {
  await client.query("insert into public.join_attempts(ip_hash,succeeded) values($1,false)", [ipHash]);
  await client.query(`update public.onboarding_guard set failed_join_count=failed_join_count+1,
    join_blocked_until=case when failed_join_count+1 >= 50 then now()+interval '1 minute' else join_blocked_until end
    where singleton=true`);
}

export async function verifyJoin(code: string, password: string, ip: string): Promise<string> {
  if (!await verifiedLicense()) throw new OnboardingError(403, "license_inactive", "Joining is unavailable while the license is inactive.");
  const ipHash = await secretDigest("join-ip", ip);
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    const guard = await client.query<{ join_blocked_until: Date | null }>("select join_blocked_until from public.onboarding_guard where singleton=true for update");
    const failed = await client.query<{ count: string }>("select count(*)::text as count from public.join_attempts where ip_hash=$1 and not succeeded and created_at>now()-interval '15 minutes'", [ipHash]);
    if (Number(failed.rows[0]?.count ?? 0) >= 5 || (guard.rows[0]?.join_blocked_until && guard.rows[0].join_blocked_until.getTime() > Date.now()))
      throw new OnboardingError(429, "rate_limited", "Too many attempts. Please try again later.");
    const firm = await client.query<{ org_id: string; org_code: string; org_password_hash: string }>("select org_id,org_code,org_password_hash from public.firm_settings limit 1");
    const row = firm.rows[0];
    const passwordMatches = await verifyPassword(row?.org_password_hash || await dummyPasswordHash(), password);
    const codeMatches = sameCode(code, row?.org_code ?? "");
    if (!passwordMatches || !codeMatches) {
      await joinFailure(client, ipHash);
      await client.query("commit");
      throw genericJoinFailure();
    }
    const token = randomBytes(32).toString("base64url");
    await client.query("insert into public.join_tokens(org_id,token_hash,ip_hash,expires_at) values($1,$2,$3,now()+interval '10 minutes')",
      [row.org_id, await secretDigest("join-token", token), ipHash]);
    await client.query("insert into public.join_attempts(ip_hash,succeeded) values($1,true)", [ipHash]);
    await client.query("update public.onboarding_guard set failed_join_count=0,join_blocked_until=null where singleton=true");
    await client.query("commit");
    return token;
  } catch (error) {
    if (!(error instanceof OnboardingError && error.code === "join_failed")) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function registerWithJoinToken(input: { token: string; email: string; password: string; ip: string }): Promise<void> {
  const claims = await verifiedLicense();
  if (!claims) throw new OnboardingError(403, "license_inactive", "Registration is unavailable while the license is inactive.");
  const [tokenHash, ipHash, passwordHash] = await Promise.all([
    secretDigest("join-token", input.token), secretDigest("join-ip", input.ip), hashPassword(input.password),
  ]);
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    await client.query("select singleton from public.onboarding_guard where singleton=true for update");
    const consumed = await client.query<{ org_id: string }>(`update public.join_tokens set consumed_at=now()
      where token_hash=$1 and ip_hash=$2 and consumed_at is null and expires_at>now() returning org_id`, [tokenHash, ipHash]);
    const orgId = consumed.rows[0]?.org_id;
    if (!orgId) throw new OnboardingError(400, "join_failed", "Invalid or expired join token.");
    const seats = await client.query<{ count: string }>("select count(*)::text as count from public.org_members m join public.users u on u.id=m.user_id where m.org_id=$1 and u.status='active'", [orgId]);
    if (Number(seats.rows[0]?.count ?? 0) >= claims.max_users) throw new OnboardingError(409, "seat_limit", "The organization's license has no available seats.");
    const userId = randomUUID();
    await client.query("insert into public.users(id,email,password_hash,role,status) values($1,$2,$3,'member','active')", [userId, input.email.toLowerCase(), passwordHash]);
    await client.query("insert into public.org_members(org_id,user_id,role) values($1,$2,'member')", [orgId, userId]);
    await client.query("insert into public.audit_events(user_id,user_email,action,surface) values($1,$2,'user.joined','onboarding')", [userId, input.email.toLowerCase()]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") throw new OnboardingError(400, "registration_failed", "Registration could not be completed.");
    throw error;
  } finally { client.release(); }
}
