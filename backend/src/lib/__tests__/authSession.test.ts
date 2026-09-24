// AXERLY modified 2026-09-24.
import { describe, expect, it } from "vitest";
import { authCookieHeaders } from "../authSession";

describe("authentication cookies", () => {
  it("uses host-only secure lax cookies and keeps the session token HttpOnly", () => {
    const [session, csrf] = authCookieHeaders("session-token", "csrf-token", new Date("2030-01-01T00:00:00Z"));
    expect(session).toContain("__Host-axerly-session=session-token");
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Secure");
    expect(session).toContain("SameSite=Lax");
    expect(csrf).toContain("__Host-axerly-csrf=csrf-token");
    expect(csrf).not.toContain("HttpOnly");
    expect(csrf).toContain("Secure");
    expect(csrf).toContain("SameSite=Lax");
  });
});
