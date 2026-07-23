import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
} from "../src/worker/secrets";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("project secrets", () => {
  it("round-trips a key while keeping plaintext out of storage", async () => {
    const encrypted = await encryptSecret("sk-customer-secret", key, "user-1:project-1");

    expect(encrypted.ciphertext).not.toContain("sk-customer-secret");
    expect(await decryptSecret(encrypted, key, "user-1:project-1")).toBe(
      "sk-customer-secret",
    );
  });

  it("cannot decrypt a project key under another tenant", async () => {
    const encrypted = await encryptSecret("sk-customer-secret", key, "user-1:project-1");

    await expect(decryptSecret(encrypted, key, "user-2:project-1")).rejects.toThrow();
  });
});
