// AXERLY modified 2026-09-24.
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLicenseToken, type LicensePublicJwk } from "../licenseToken";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "license-test-key" } as LicensePublicJwk;
const installId = "8f6c8754-3c67-4f57-b495-53bf76f15c22";
const now = Date.UTC(2026, 8, 24);
const claims = {
  iss: "axerly-license", aud: "axerly-app", sub: "license-id", jti: "token-id",
  install_id: installId, practice_name: "Test Practice", plan: "trial", max_users: 5,
  features: [], purchased_at: new Date(now - 86_400_000).toISOString(),
  expires_at: new Date(now + 86_400_000).toISOString(), expiry_grace_days: 7,
  iat: Math.floor(now / 1000), exp: Math.floor((now + 86_400_000) / 1000),
  recheck_after_hours: 24,
};

function token(payload: Record<string, unknown> = claims, header: Record<string, unknown> = { alg: "ES256", typ: "JWT", kid: publicJwk.kid }): string {
  const body = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const signature = sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${body}.${signature.toString("base64url")}`;
}

describe("ES256 license token verification", () => {
  it("accepts a correctly signed token for this install", () => {
    expect(verifyLicenseToken(token(), publicJwk, installId, now)?.practice_name).toBe("Test Practice");
  });
  it("rejects a changed payload or signature", () => {
    const valid = token();
    const parts = valid.split(".");
    parts[1] = Buffer.from(JSON.stringify({ ...claims, max_users: 500 })).toString("base64url");
    expect(verifyLicenseToken(parts.join("."), publicJwk, installId, now)).toBeNull();
    expect(verifyLicenseToken(`${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`, publicJwk, installId, now)).toBeNull();
  });
  it("rejects EdDSA and mismatched key identifiers", () => {
    expect(verifyLicenseToken(token(claims, { alg: "EdDSA", kid: publicJwk.kid }), publicJwk, installId, now)).toBeNull();
    expect(verifyLicenseToken(token(claims, { alg: "ES256", kid: "supabase-auth-key" }), publicJwk, installId, now)).toBeNull();
  });
  it("rejects other installs, expired tokens and wrong issuer", () => {
    expect(verifyLicenseToken(token(), publicJwk, "different-install", now)).toBeNull();
    expect(verifyLicenseToken(token(), publicJwk, installId, now + 2 * 86_400_000)).toBeNull();
    expect(verifyLicenseToken(token({ ...claims, iss: "supabase" }), publicJwk, installId, now)).toBeNull();
  });
});
