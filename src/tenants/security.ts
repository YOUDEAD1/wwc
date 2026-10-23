import { createHmac, timingSafeEqual } from 'node:crypto';
export function tenantWebhookSecret(token: string) {
  return createHmac('sha256', token).update('tenant-webhook').digest('hex');
}
export function validWebhookSecret(actual: string | undefined, token: string) {
  if (!actual) return false;
  const expected = tenantWebhookSecret(token);
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function inheritedTenantEnvironment(source: NodeJS.ProcessEnv) {
  const result: Record<string, string> = {};
  for (const key of [
    'PATH',
    'NODE_ENV',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'TZ',
    'LANG',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SYSTEMROOT',
    'WINDIR',
    'PUBLIC_BASE_URL',
    'LOG_LEVEL',
    'SUPPLIER_SYNC_INTERVAL_MS',
  ])
    if (source[key] !== undefined) result[key] = source[key]!;
  return result;
}
