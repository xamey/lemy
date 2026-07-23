type EmailEnv = {
  ACCESS_APPROVAL_EMAIL_FROM?: string;
  PUBLIC_APP_URL: string;
  RESEND_API_KEY?: string;
};

export async function sendAccessApprovalEmail(
  env: EmailEnv,
  email: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.ACCESS_APPROVAL_EMAIL_FROM) return false;
  try {
    const response = await request("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.ACCESS_APPROVAL_EMAIL_FROM,
        to: [email],
        subject: "Your Lemy Cloud access is ready",
        text: `Your Lemy Cloud access has been approved. Sign in at ${env.PUBLIC_APP_URL}`,
        html: `<p>Your Lemy Cloud access has been approved.</p><p><a href="${env.PUBLIC_APP_URL}">Sign in to Lemy Cloud</a></p>`,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
