// AXERLY modified 2026-09-24.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthSession, login, logout, updateAuthPassword } from "./authApi";

describe("local auth API", () => {
    beforeEach(() => {
        Object.defineProperty(document, "cookie", { configurable: true, value: "__Host-axerly-csrf=test-csrf" });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: { id: "u1", email: "user@example.test", role: "member", status: "active" } }) }));
    });

    it("loads the current user from /me", async () => {
        await getAuthSession();
        expect(fetch).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({ credentials: "include" }));
    });

    it("logs in without relying on a public registration flow", async () => {
        await login("user@example.test", "a-secure-password");
        expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
    });

    it("adds the CSRF token to authenticated mutations", async () => {
        await logout();
        await updateAuthPassword("another-secure-password");
        for (const [, init] of vi.mocked(fetch).mock.calls) expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("test-csrf");
    });
});
