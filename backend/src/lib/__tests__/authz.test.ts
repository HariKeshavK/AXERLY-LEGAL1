// AXERLY modified 2026-09-24.
import { describe, expect, it } from "vitest";
import { can } from "../authz";

describe("central authorization", () => {
  const member = { id: "u1", role: "member" as const, status: "active" as const };

  it("denies missing and disabled principals", () => {
    expect(can(null, "session:use", { kind: "system" })).toBe(false);
    expect(can({ ...member, status: "disabled" }, "read", { kind: "project", accessRole: "owner" })).toBe(false);
  });

  it("allows only capabilities granted by the resource role", () => {
    expect(can(member, "read", { kind: "project", accessRole: "viewer" })).toBe(true);
    expect(can(member, "update", { kind: "project", accessRole: "viewer" })).toBe(false);
    expect(can(member, "share", { kind: "project", accessRole: "editor" })).toBe(false);
    expect(can(member, "share", { kind: "project", accessRole: "owner" })).toBe(true);
  });

  it("treats team membership as a permission principal, not content access", () => {
    expect(can(member, "read", { kind: "team", accessRole: "viewer" })).toBe(true);
    expect(can(member, "update", { kind: "team", accessRole: "viewer" })).toBe(false);
    expect(can(member, "update", { kind: "team", accessRole: "owner" })).toBe(true);
    expect(can({ ...member, role: "admin" }, "read", { kind: "team" })).toBe(false);
    expect(can(member, "share", { kind: "team", accessRole: "owner" })).toBe(false);
  });

  it("keeps legacy project capability checks behind the same entry point", () => {
    expect(can("editor", "content.edit")).toBe(true);
    expect(can("viewer", "content.edit")).toBe(false);
  });
});
