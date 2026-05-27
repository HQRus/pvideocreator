// In-memory cache for tool-generated images. Keeps the giant base64 payload
// on the server so we only stream a short fetch URL through the AI model's
// context (large data URLs blow past token limits and surface as a
// "Provider returned error" on the next model step).

type CachedAsset = { mime: string; bytes: Uint8Array; createdAt: number };
const store = new Map<string, CachedAsset>();
const TTL_MS = 1000 * 60 * 60; // 1h

function gc() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) if (v.createdAt < cutoff) store.delete(k);
}

export function putAsset(id: string, mime: string, bytes: Uint8Array) {
  gc();
  store.set(id, { mime, bytes, createdAt: Date.now() });
}

export function getAsset(id: string): CachedAsset | undefined {
  return store.get(id);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}