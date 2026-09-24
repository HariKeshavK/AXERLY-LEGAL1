// AXERLY modified 2026-09-24.
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { PUBLIC_ROUTE_ALLOWLIST, isPublicRoute } from "../middleware/routeSecurity";

describe("route authentication inventory", () => {
  it("mounts the default-deny boundary before every registered route", () => {
    const stack = (app as unknown as { router: { stack: Array<{ name: string; route?: unknown }> } }).router.stack;
    const boundary = stack.findIndex((layer) => layer.name === "authenticationBoundary");
    const firstRoute = stack.findIndex((layer) => layer.route);
    expect(boundary).toBeGreaterThanOrEqual(0);
    expect(firstRoute).toBeGreaterThan(boundary);
    for (let index = 0; index < stack.length; index += 1) {
      if (stack[index].route) expect(index).toBeGreaterThan(boundary);
    }
  });

  it("has a small explicit public allowlist and no production registration endpoint", () => {
    expect(PUBLIC_ROUTE_ALLOWLIST).toEqual([
      { method: "GET", path: "/health" },
      { method: "GET", path: "/manifest-signing-key" },
      { method: "POST", path: "/auth/login" },
    ]);
    expect(isPublicRoute("POST", "/auth/dev/bootstrap", { NODE_ENV: "production" })).toBe(false);
    expect(isPublicRoute("POST", "/auth/signup", { NODE_ENV: "development" })).toBe(false);
  });
});
