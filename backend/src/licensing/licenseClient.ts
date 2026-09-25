// AXERLY modified 2026-09-25.
// The app contains only the license endpoint and its public verification key.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { FileSecretsStore, loadOrCreateSecrets, type SecretsStore } from "../config/secrets";
import { verifyLicenseToken, type LicenseClaims, type LicensePublicJwk } from "./licenseToken";

export const LICENSE_API_URL = "https://zipajtwdklniroezuaua.supabase.co/functions/v1/license";
export const LICENSE_PUBLIC_KEY: LicensePublicJwk = {
  kty: "EC", crv: "P-256",
  x: "uQ6GXxRjq7T2kUlcJLU8xjtZE0_ONro9J7L1KjEHDC4",
  y: "-73P9yIQUl1ZCdce-HacZ7-JNQ9cW0epVCiOOuFMDas",
  kid: "7e632d67-2adc-4b77-bcc8-d47b42c3ed6f",
};

const CODES = new Set(["invalid_license", "license_expired", "license_suspended", "license_revoked", "activation_limit", "rate_limited"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type LicenseErrorCode = "invalid_license" | "license_expired" | "license_suspended" | "license_revoked" | "activation_limit" | "rate_limited" | "license_unreachable" | "license_invalid_response";
export class LicenseError extends Error {
  constructor(readonly code: LicenseErrorCode) { super(code); }
}

function endpoint(): string {
  if (process.env.NODE_ENV !== "production" && process.env.AXERLY_PACKAGED !== "true")
    return process.env.LICENSE_API_URL?.trim() || LICENSE_API_URL;
  return LICENSE_API_URL;
}
function publicKey(): LicensePublicJwk {
  if (process.env.NODE_ENV !== "production" && process.env.AXERLY_PACKAGED !== "true" && process.env.LICENSE_PUBLIC_KEY) {
    const parsed: unknown = JSON.parse(process.env.LICENSE_PUBLIC_KEY);
    if (parsed && typeof parsed === "object") return parsed as LicensePublicJwk;
  }
  return LICENSE_PUBLIC_KEY;
}
export function normalizeLicenseKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").replaceAll("O", "0").replace(/[IL]/g, "1");
}
export function machineHash(machineGuid: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${machineGuid.trim().toLowerCase()}`).digest("hex");
}
function windowsMachineGuid(): string {
  if (process.platform !== "win32") throw new LicenseError("license_unreachable");
  try {
    const output = execFileSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", windowsHide: true, timeout: 3000 });
    const guid = output.match(/MachineGuid\s+REG_SZ\s+([^\s]+)/i)?.[1];
    if (!guid || !uuid.test(guid)) throw Error("Missing MachineGuid");
    return guid;
  } catch { throw new LicenseError("license_unreachable"); }
}

async function request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new LicenseError("license_unreachable"); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new LicenseError("license_invalid_response"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new LicenseError("license_invalid_response");
  const result = data as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof result.error === "string" && CODES.has(result.error) ? result.error as LicenseErrorCode : "license_invalid_response";
    throw new LicenseError(code);
  }
  return result;
}

export async function activateLicense(licenseKey: string, store: SecretsStore = new FileSecretsStore()): Promise<LicenseClaims> {
  const canonical = normalizeLicenseKey(licenseKey);
  if (!/^AXR[0-9A-HJKMNP-TV-Z]{20}$/.test(canonical)) throw new LicenseError("invalid_license");
  const secrets = await loadOrCreateSecrets(store);
  if (!secrets.licenseInstallId || !secrets.licenseMachineSalt) throw new LicenseError("license_invalid_response");
  const result = await request({
    action: "activate", license_key: canonical, install_id: secrets.licenseInstallId,
    machine_hash: machineHash(windowsMachineGuid(), secrets.licenseMachineSalt),
    machine_label: os.hostname().slice(0, 128), app_version: process.env.npm_package_version ?? "0.1.0",
    os_version: os.release().slice(0, 128),
  });
  const token = result.token;
  const claims = typeof token === "string" ? verifyLicenseToken(token, publicKey(), secrets.licenseInstallId) : null;
  if (!claims) throw new LicenseError("license_invalid_response");
  await store.save({ ...secrets, licenseToken: token as string, licenseActivatedAt: new Date().toISOString(), licenseLastValidatedAt: new Date().toISOString(), licenseBlockedCode: undefined });
  return claims;
}

export async function verifiedLicense(store: SecretsStore = new FileSecretsStore()): Promise<LicenseClaims | null> {
  const secrets = await loadOrCreateSecrets(store);
  if (secrets.licenseBlockedCode) return null;
  return secrets.licenseToken && secrets.licenseInstallId
    ? verifyLicenseToken(secrets.licenseToken, publicKey(), secrets.licenseInstallId) : null;
}

export async function freshlyActivatedLicense(store: SecretsStore = new FileSecretsStore()): Promise<LicenseClaims | null> {
  const secrets = await loadOrCreateSecrets(store);
  if (!secrets.licenseActivatedAt || Date.now() - Date.parse(secrets.licenseActivatedAt) > 10 * 60_000) return null;
  return verifiedLicense(store);
}

export async function validateLicense(orgId: string, activeUserCount: number, store: SecretsStore = new FileSecretsStore()): Promise<LicenseClaims> {
  const secrets = await loadOrCreateSecrets(store);
  if (!secrets.licenseToken || !secrets.licenseInstallId) throw new LicenseError("license_invalid_response");
  let result: Record<string, unknown>;
  try {
    result = await request({ action: "validate", token: secrets.licenseToken, install_id: secrets.licenseInstallId,
      org_id: orgId, reported_user_count: activeUserCount, app_version: process.env.npm_package_version ?? "0.1.0" });
  } catch (error) {
    if (error instanceof LicenseError && ["license_expired", "license_suspended", "license_revoked", "invalid_license"].includes(error.code))
      await store.save({ ...secrets, licenseBlockedCode: error.code });
    throw error;
  }
  const token = result.token;
  const claims = typeof token === "string" ? verifyLicenseToken(token, publicKey(), secrets.licenseInstallId) : null;
  if (!claims) throw new LicenseError("license_invalid_response");
  await store.save({ ...secrets, licenseToken: token as string, licenseLastValidatedAt: new Date().toISOString(), licenseBlockedCode: undefined });
  return claims;
}
