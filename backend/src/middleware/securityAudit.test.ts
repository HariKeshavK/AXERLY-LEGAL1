// AXERLY modified 2026-09-25.
import { describe, expect, it } from "vitest";
import { classifySecurityEvent } from "./securityAudit";

describe("security event classification", () => {
  it("captures anonymous authentication and joining outcomes without request data", () => {
    expect(classifySecurityEvent("POST", "/auth/login", 400)).toEqual({ action: "auth.login" });
    expect(classifySecurityEvent("POST", "/join/verify", 429)).toEqual({ action: "join.verify" });
    expect(classifySecurityEvent("POST", "/register", 201)).toEqual({ action: "join.register" });
    expect(classifySecurityEvent("POST", "/setup/activate", 200)).toEqual({ action: "license.activate" });
  });
  it("captures shares, key changes, downloads, and blocked model requests", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(classifySecurityEvent("POST", `/projects/${id}/access`, 201)).toEqual({ action: "share.changed", targetKind: "projects", targetId: id });
    expect(classifySecurityEvent("PUT", "/user/api-keys/openai", 200)).toEqual({ action: "provider_key.changed", targetKind: "provider", targetId: "openai" });
    expect(classifySecurityEvent("GET", `/files/${id}`, 404)).toEqual({ action: "file.download", targetKind: "file", targetId: id });
    expect(classifySecurityEvent("POST", "/chat", 403)).toEqual({ action: "model.request_blocked" });
    expect(classifySecurityEvent("POST", "/chat", 200)).toBeNull();
  });
  it("ignores unrelated routes", () => {
    expect(classifySecurityEvent("GET", "/health", 200)).toBeNull();
    expect(classifySecurityEvent("GET", "/projects", 200)).toBeNull();
  });
});
