import { describe, expect, it, vi } from "vitest";

import { sendAccessApprovalEmail } from "../src/worker/access-email";

describe("access approval email", () => {
  it("sends a sign-in link without failing grants when email is not configured", async () => {
    const request = vi.fn(async () => new Response(null, { status: 202 }));
    const configured = {
      ACCESS_APPROVAL_EMAIL_FROM: "Lemy <access@lemy.cloud>",
      PUBLIC_APP_URL: "https://cloud.lemy.dev",
      RESEND_API_KEY: "resend-secret",
    };

    expect(await sendAccessApprovalEmail(configured, "user@example.com", request))
      .toBe(true);
    expect(request).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer resend-secret" }),
      }),
    );
    expect(await sendAccessApprovalEmail(
      { ...configured, RESEND_API_KEY: undefined },
      "user@example.com",
      request,
    )).toBe(false);
  });
});
