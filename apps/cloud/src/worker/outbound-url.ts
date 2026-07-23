function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.includes(":")
  ) return true;

  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4
    || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) return false;
  return (
    octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] >= 224
  );
}

export function publicHttpsUrl(value: string, allowLocal = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL must be public HTTPS");
  }
  if (url.username || url.password || url.hash) throw new Error("URL must be public HTTPS");

  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (allowLocal && localHost && ["http:", "https:"].includes(url.protocol)) return url;
  if (url.protocol !== "https:" || blockedHostname(url.hostname)) {
    throw new Error("URL must be public HTTPS");
  }
  return url;
}
