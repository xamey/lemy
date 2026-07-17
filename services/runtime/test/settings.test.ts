import { describe, expect, it } from "vitest";

import { readSettings } from "../src/settings.js";

const validEnv = {
  BEARER_VALIDATION_URL: "https://api.test/me",
  CORS_ORIGINS: "https://app.test",
  PORT: "4000",
};

describe("readSettings", () => {
  it("requires a bearer validation URL", () => {
    expect(() => readSettings({ ...validEnv, BEARER_VALIDATION_URL: "" })).toThrow(
      "BEARER_VALIDATION_URL is required",
    );
  });

  it("requires an HTTP bearer validation URL", () => {
    expect(() => readSettings({ ...validEnv, BEARER_VALIDATION_URL: "file:///me" })).toThrow(
      "BEARER_VALIDATION_URL must be an HTTP or HTTPS URL",
    );
  });

  it("reads the bearer validation URL", () => {
    expect(readSettings(validEnv).bearerValidationUrl).toBe("https://api.test/me");
  });
});
