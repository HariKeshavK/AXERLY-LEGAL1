// AXERLY modified 2026-09-25.
import { describe, expect, it } from "vitest";
import { newJoinCredentials } from "./onboarding.service";
import { isReadOnlyAllowed } from "../../middleware/licenseGate";
import { normalizeLicenseKey } from "../../licensing/licenseClient";
import { can } from "../../lib/authz";

describe("P6 boundaries", () => {
  it("generates non-default joining credentials with adequate entropy", () => {
    const values = Array.from({ length: 100 }, newJoinCredentials);
    expect(new Set(values.map((value) => value.code)).size).toBe(100);
    expect(new Set(values.map((value) => value.password)).size).toBe(100);
    for (const value of values) {
      expect(value.code).toMatch(/^AXR-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
      expect(value.password).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}(?:-[A-HJ-KM-NP-Z2-9]{5}){3}$/);
    }
  });
  it("normalizes license keys before activation", () => {
    expect(normalizeLicenseKey("axr-oiL-23!")).toBe("AXR01123");
  });
  it("keeps read-only data access while denying mutations", () => {
    expect(isReadOnlyAllowed("GET", "/files/123")).toBe(true);
    expect(isReadOnlyAllowed("POST", "/auth/login")).toBe(true);
    expect(isReadOnlyAllowed("POST", "/user/exports")).toBe(true);
    expect(isReadOnlyAllowed("POST", "/chat")).toBe(false);
    expect(isReadOnlyAllowed("PATCH", "/projects/123")).toBe(false);
  });
  it("does not let administrators read private content by virtue of role", () => {
    const admin = { id: "admin", role: "admin" as const, status: "active" as const };
    expect(can(admin, "admin", { kind: "system" })).toBe(true);
    expect(can(admin, "read", { kind: "document" })).toBe(false);
    expect(can(admin, "read", { kind: "user", ownerId: "someone-else" })).toBe(false);
    expect(can(admin, "read", { kind: "project", accessRole: "viewer" })).toBe(true);
  });
});
