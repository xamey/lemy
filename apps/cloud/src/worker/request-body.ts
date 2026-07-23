export class RequestTooLargeError extends Error {}

interface ReadableBody {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export async function readLimitedText(request: ReadableBody, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestTooLargeError("Request body is too large");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RequestTooLargeError("Request body is too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function parseLimitedJson(request: ReadableBody, maxBytes: number): Promise<unknown> {
  try {
    return JSON.parse(await readLimitedText(request, maxBytes));
  } catch (error) {
    if (error instanceof RequestTooLargeError) throw error;
    throw new Error("Request body must be valid JSON");
  }
}

export async function assertLimitedBody(
  request: ReadableBody & { clone(): ReadableBody },
  maxBytes: number,
): Promise<void> {
  await readLimitedText(request.clone(), maxBytes);
}

export async function limitResponse(response: Response, maxBytes: number): Promise<Response> {
  const request = new Request("https://response.invalid", {
    method: "POST",
    headers: response.headers,
    body: response.body,
  });
  const text = await readLimitedText(request, maxBytes);
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
