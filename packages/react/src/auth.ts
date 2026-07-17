export function toAuthorizationHeader(bearerToken: string): string {
  const token = bearerToken.trim();
  if (!token) throw new Error("bearerToken is required");
  if (/^Bearer\b/i.test(token)) {
    if (!/^Bearer\s+\S+$/i.test(token)) throw new Error("bearerToken is invalid");
    return token;
  }
  if (/\s/.test(token)) throw new Error("bearerToken is invalid");
  return `Bearer ${token}`;
}
