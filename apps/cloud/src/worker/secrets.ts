export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new Uint8Array(bytes.buffer);
}

function toBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return btoa(String.fromCharCode(...bytes));
}

function rawKey(encodedKey: string): Uint8Array<ArrayBuffer> {
  const rawKey = fromBase64(encodedKey);
  if (rawKey.byteLength !== 32) {
    throw new Error("PROJECT_SECRETS_KEY must be a base64-encoded 32-byte key");
  }
  return rawKey;
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawKey(encodedKey),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(
  plaintext: string,
  encodedKey: string,
  scope: string,
): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(scope) },
    await importEncryptionKey(encodedKey),
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv) };
}

export async function decryptSecret(
  encrypted: EncryptedSecret,
  encodedKey: string,
  scope: string,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(encrypted.iv),
      additionalData: new TextEncoder().encode(scope),
    },
    await importEncryptionKey(encodedKey),
    fromBase64(encrypted.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
