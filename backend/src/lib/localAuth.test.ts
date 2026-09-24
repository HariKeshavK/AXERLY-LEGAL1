// AXERLY modified 2026-09-23.
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./localAuth";

describe("local password hashing", () => {
  it("uses salted scrypt hashes and rejects a different password", async () => {
    const first = await hashPassword("a sufficiently long test password");
    const second = await hashPassword("a sufficiently long test password");
    expect(first).not.toBe(second);
    expect(first.startsWith("scrypt$32768$8$1$")).toBe(true);
    await expect(verifyPassword(first, "a sufficiently long test password")).resolves.toBe(true);
    await expect(verifyPassword(first, "incorrect password")).resolves.toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    await expect(verifyPassword("plaintext", "plaintext")).resolves.toBe(false);
  });
});
