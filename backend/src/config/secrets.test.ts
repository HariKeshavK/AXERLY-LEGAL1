// AXERLY modified 2026-09-23.
import { describe, expect, it } from "vitest";
import {
  generateSecrets,
  loadOrCreateSecrets,
  type AxerlySecrets,
  type SecretsStore,
} from "./secrets";

class MemorySecretsStore implements SecretsStore {
  value: AxerlySecrets | null = null;
  saves = 0;

  async load() {
    return this.value;
  }

  async save(value: AxerlySecrets) {
    this.saves += 1;
    this.value = value;
  }
}

describe("secrets", () => {
  it("generates independent high-entropy values", () => {
    const first = generateSecrets();
    const second = generateSecrets();
    expect(first.postgresPassword).not.toBe(second.postgresPassword);
    expect(first.sessionSecret).not.toBe(second.sessionSecret);
    expect(first.postgresPassword.length).toBeGreaterThanOrEqual(32);
    expect(first.sessionSecret.length).toBeGreaterThanOrEqual(43);
  });

  it("creates once and reuses the stored values", async () => {
    const store = new MemorySecretsStore();
    const first = await loadOrCreateSecrets(store);
    const second = await loadOrCreateSecrets(store);
    expect(second).toEqual(first);
    expect(store.saves).toBe(1);
  });
});
