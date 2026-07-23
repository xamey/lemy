import { describe, expect, it } from "vitest";

import { accessRequestError } from "../src/access-request-error";

describe("accessRequestError", () => {
  it("explains request failures", () => {
    expect(accessRequestError(new TypeError("Failed to fetch")))
      .toBe("Lemy Cloud is unavailable. Try again shortly.");
    expect(accessRequestError(new Error("Rate limit exceeded")))
      .toBe("Too many requests. Try again in one minute.");
    expect(accessRequestError(new Error("A valid email is required")))
      .toBe("A valid email is required");
  });
});
