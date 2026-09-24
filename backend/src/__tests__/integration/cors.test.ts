// AXERLY modified 2026-09-23.
import { describe, it, expect } from "vitest";
import request from "supertest";

import { app, configuredAllowedOrigins } from "../../app";

const ALLOWED_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:3000";

describe("CORS allowlist", () => {
    it("includes deployed Word and explicitly configured client origins", () => {
        const origins = configuredAllowedOrigins({
            FRONTEND_URL: "https://app.example.com",
            WORD_ADDIN_URL: "https://word.example.com",
            ALLOWED_ORIGINS:
                "https://review.example.com, https://admin.example.com ",
        });

        expect([...origins]).toEqual([
            "https://app.example.com",
            "https://word.example.com",
            "https://review.example.com",
            "https://admin.example.com",
        ]);
    });
    it("exposes the request id to cross-origin scripts", async () => {
        const res = await request(app)
            .get("/health")
            .set("Origin", ALLOWED_ORIGIN);
        expect(res.headers["access-control-expose-headers"]).toBe("X-Request-ID");
        expect(res.headers["x-request-id"]).toBeTruthy();
    });

    it("reflects an allowlisted origin with credentials", async () => {
        const res = await request(app)
            .options("/chat")
            .set("Origin", ALLOWED_ORIGIN)
            .set("Access-Control-Request-Method", "POST");
        expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
        expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("omits Access-Control-Allow-Origin for a non-allowlisted origin", async () => {
        const res = await request(app)
            .options("/chat")
            .set("Origin", "https://evil.example")
            .set("Access-Control-Request-Method", "POST");
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("does not turn a disallowed origin into a 5xx", async () => {
        const res = await request(app)
            .options("/chat")
            .set("Origin", "https://evil.example")
            .set("Access-Control-Request-Method", "POST");
        expect(res.status).toBeLessThan(500);
    });

    it("limits preflight-approved request headers to Authorization and Content-Type", async () => {
        const res = await request(app)
            .options("/chat")
            .set("Origin", ALLOWED_ORIGIN)
            .set("Access-Control-Request-Method", "POST")
            .set("Access-Control-Request-Headers", "Authorization");
        expect(res.headers["access-control-allow-headers"]).toBe(
            "Authorization,Content-Type",
        );
    });
});
