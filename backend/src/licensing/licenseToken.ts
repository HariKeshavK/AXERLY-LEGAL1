// AXERLY modified 2026-09-24.
// Public-key verification only. License signing belongs exclusively to the
// separately deployed private licensing function.
import { createPublicKey, verify } from "node:crypto";

export interface LicensePublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid?: string;
}

export interface LicenseClaims {
  iss: "axerly-license";
  aud: "axerly-app";
  sub: string;
  jti: string;
  install_id: string;
  practice_name: string;
  plan: string;
  max_users: number;
  features: unknown;
  purchased_at: string;
  expires_at: string;
  expiry_grace_days: number;
  iat: number;
  exp: number;
  recheck_after_hours: number;
}

const PART = /^[A-Za-z0-9_-]+$/;

function jsonPart(value: string): Record<string, unknown> | null {
  if (!value || value.length > 16_384 || !PART.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/** Rejects malformed, wrongly signed, expired, or other-install tokens. */
export function verifyLicenseToken(
  token: string,
  publicJwk: LicensePublicJwk,
  installId: string,
  now = Date.now(),
): LicenseClaims | null {
  if (typeof token !== "string" || token.length > 24_576 ||
      publicJwk?.kty !== "EC" || publicJwk.crv !== "P-256" ||
      !publicJwk.x || !publicJwk.y || !installId) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => part && PART.test(part))) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = jsonPart(encodedHeader);
  const payload = jsonPart(encodedPayload);
  if (!header || !payload || header.alg !== "ES256" ||
      (header.typ !== undefined && header.typ !== "JWT") ||
      (publicJwk.kid && header.kid !== publicJwk.kid)) return null;
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.length !== 64) return null;
  try {
    const key = createPublicKey({ key: publicJwk, format: "jwk" });
    if (!verify("sha256", Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { key, dsaEncoding: "ieee-p1363" }, signature)) return null;
  } catch { return null; }
  if (payload.iss !== "axerly-license" || payload.aud !== "axerly-app" ||
      payload.install_id !== installId ||
      typeof payload.sub !== "string" || !payload.sub ||
      typeof payload.jti !== "string" || !payload.jti ||
      typeof payload.practice_name !== "string" || !payload.practice_name ||
      typeof payload.plan !== "string" || !payload.plan ||
      typeof payload.max_users !== "number" || !Number.isSafeInteger(payload.max_users) || payload.max_users < 1 ||
      typeof payload.iat !== "number" || !Number.isSafeInteger(payload.iat) ||
      typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) ||
      typeof payload.expires_at !== "string" || !Number.isFinite(Date.parse(payload.expires_at)) ||
      typeof payload.purchased_at !== "string" || !Number.isFinite(Date.parse(payload.purchased_at)) ||
      typeof payload.expiry_grace_days !== "number" || !Number.isSafeInteger(payload.expiry_grace_days) || payload.expiry_grace_days < 0 ||
      typeof payload.recheck_after_hours !== "number" || !Number.isFinite(payload.recheck_after_hours) || payload.recheck_after_hours <= 0 ||
      payload.features === undefined) return null;
  const nowSeconds = Math.floor(now / 1000);
  if (payload.iat > nowSeconds + 300 || payload.exp <= nowSeconds ||
      Date.parse(payload.expires_at) + payload.expiry_grace_days * 86_400_000 <= now) return null;
  return payload as unknown as LicenseClaims;
}
