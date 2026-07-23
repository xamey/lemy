const MAX_VALIDATION_RESPONSE_LENGTH = 16_384;

export function isBearerAuthorization(value: string | null | undefined): value is string {
  return Boolean(value && /^Bearer\s+\S+$/i.test(value));
}

function unauthorized(message: string): Response {
  return Response.json({ error: message }, { status: 401 });
}

function identityPart(value: unknown, name: string, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") throw unauthorized("Bearer validation failed");
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw unauthorized(`Bearer validation returned an invalid ${name}`);
  }
  return normalized;
}

async function boundedText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_VALIDATION_RESPONSE_LENGTH) {
    throw unauthorized("Bearer validation failed");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_VALIDATION_RESPONSE_LENGTH) {
      await reader.cancel();
      throw unauthorized("Bearer validation failed");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function principalScope(sub: string, tenant?: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`v1\0${tenant ?? ""}\0${sub}`),
  ));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateBearer(
  authorization: string,
  validationUrl: string,
  fetchFn: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(validationUrl, {
      headers: { Authorization: authorization },
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw unauthorized("Bearer validation failed");
  }
  if (response.status === 401 || response.status === 403) throw unauthorized("Bearer token rejected");
  if (!response.ok) throw unauthorized("Bearer validation failed");

  let value: unknown;
  try {
    value = JSON.parse(await boundedText(response));
  } catch (error) {
    if (error instanceof Response) throw error;
    throw unauthorized("Bearer validation failed");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw unauthorized("Bearer validation failed");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.active === false) throw unauthorized("Bearer token rejected");
  if (
    candidate.exp !== undefined
    && (typeof candidate.exp !== "number" || !Number.isFinite(candidate.exp) || candidate.exp <= nowSeconds)
  ) throw unauthorized("Bearer token rejected");
  const sub = identityPart(candidate.sub, "subject", true)!;
  const tenant = identityPart(candidate.tenant, "tenant", false);
  return principalScope(sub, tenant);
}
