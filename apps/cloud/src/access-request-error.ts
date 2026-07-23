export function accessRequestError(cause: unknown): string {
  if (cause instanceof TypeError) return "Lemy Cloud is unavailable. Try again shortly.";
  if (!(cause instanceof Error)) return "Could not send your request.";
  if (cause.message === "Rate limit exceeded") return "Too many requests. Try again in one minute.";
  if (cause.message === "Rate limiting unavailable") return "Request service is temporarily unavailable. Try again shortly.";
  return cause.message;
}
