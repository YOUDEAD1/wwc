import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
export class PlatformError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function signature(
  secret: string,
  method: string,
  path: string,
  time: string,
  nonce: string,
  body: Buffer,
) {
  return createHmac('sha256', secret)
    .update([method, path, time, nonce, createHash('sha256').update(body).digest('hex')].join('\n'))
    .digest('hex');
}
export function verifySignature(
  secret: string,
  method: string,
  path: string,
  time: string,
  nonce: string,
  body: Buffer,
  actual: string,
  now = Date.now(),
) {
  if (
    !/^\d{10}$/.test(time) ||
    Math.abs(now / 1000 - Number(time)) > 300 ||
    !/^[A-Za-z0-9_-]{20,80}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(actual)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature(secret, method, path, time, nonce, body)),
    Buffer.from(actual),
  );
}
export function encryptionKey(value: string) {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32)
    throw Error('WWC_ENCRYPTION_KEY must contain 32 random bytes encoded as base64');
  return key;
}
export function seal(value: unknown, key: Buffer, id: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id));
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}
export function unseal<T>(value: string, key: Buffer, id: string): T {
  const [v, iv, tag, body] = value.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw Error('Invalid encrypted credentials');
  const c = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  c.setAAD(Buffer.from(id));
  c.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([c.update(Buffer.from(body, 'base64url')), c.final()]).toString(),
  ) as T;
}
export const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
export function safeSupabaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PlatformError(400, 'INVALID_SUPABASE_URL');
  }
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new PlatformError(400, 'INVALID_SUPABASE_URL');
  return url.origin;
}
