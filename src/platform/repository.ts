import { createClient } from '@supabase/supabase-js';
import type { PlatformConfig } from './config.js';
import { PlatformError, unseal } from './security.js';
export type Shop = {
  id: string;
  owner_id: number;
  owner_lang: string;
  bot_id: number;
  bot_username: string;
  status: 'setup' | 'active' | 'idle' | 'locked' | 'suspended';
  plan: 'free' | 'paid';
  paid_until: string | null;
  idle_strikes: number;
  last_customer_at: string | null;
  last_purchase_at: string | null;
  last_active_at: string;
  created_at: string;
  secret_box: string;
  warned_at: string | null;
  activation_requested_at: string | null;
};
export type Credentials = {
  botToken: string;
  databaseUrl: string;
  databaseKey: string;
  sourceUrl: string;
  sourceKey: string;
};
export function database(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: 'error',
          signal: init?.signal ?? AbortSignal.timeout(12000),
        }),
    },
  });
}
export function effectivePlan(shop: Pick<Shop, 'plan' | 'paid_until'>) {
  return shop.plan === 'paid' && shop.paid_until && Date.parse(shop.paid_until) > Date.now()
    ? 'paid'
    : 'free';
}
export class Registry {
  readonly db;
  constructor(readonly config: PlatformConfig) {
    this.db = database(config.databaseUrl, config.databaseKey);
  }
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) {
      const code = error.message.match(
        /\b(FORBIDDEN|OWNER_SHOP_LIMIT|HOST_CAPACITY|SHOP_NOT_FOUND|ADMIN_SUSPENDED|OWNER_UNLOCK_REQUIRED|RECEIPT_CONFLICT|INVALID_DAYS|INVALID_ACTION)\b/,
      )?.[1];
      throw new PlatformError(
        code === 'FORBIDDEN' ? 403 : code || error.code === '23505' ? 409 : 503,
        code ?? (error.code === '23505' ? 'BOT_OR_DATABASE_ALREADY_USED' : 'REGISTRY_UNAVAILABLE'),
      );
    }
    return data as T;
  }
  async get(id: string): Promise<Shop> {
    const { data, error } = await this.db
      .from('wwc_platform_shops')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new PlatformError(503, 'REGISTRY_UNAVAILABLE');
    if (!data) throw new PlatformError(404, 'SHOP_NOT_FOUND');
    return data as Shop;
  }
  async list(owner?: number, offset = 0) {
    let query = this.db
      .from('wwc_platform_shops')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + 49);
    if (owner) query = query.eq('owner_id', owner);
    const { data, error } = await query;
    if (error) throw new PlatformError(503, 'REGISTRY_UNAVAILABLE');
    return (data ?? []) as Shop[];
  }
  async active() {
    const { data, error } = await this.db
      .from('wwc_platform_shops')
      .select('*')
      .eq('status', 'active')
      .limit(this.config.maxShops + 1);
    if (error) throw new PlatformError(503, 'REGISTRY_UNAVAILABLE');
    return (data ?? []) as Shop[];
  }
  secrets(shop: Shop) {
    return unseal<Credentials>(shop.secret_box, this.config.encryptionKey, shop.id);
  }
  view(shop: Shop) {
    return {
      id: shop.id,
      owner_id: shop.owner_id,
      owner_lang: shop.owner_lang,
      bot_id: shop.bot_id,
      bot_username: shop.bot_username,
      status: shop.status,
      plan: effectivePlan(shop),
      paid_until: shop.paid_until,
      idle_strikes: shop.idle_strikes,
      last_customer_at: shop.last_customer_at,
      last_purchase_at: shop.last_purchase_at,
      last_active_at: shop.last_active_at,
      created_at: shop.created_at,
      queued: Boolean(shop.activation_requested_at),
      bot_url: `https://t.me/${shop.bot_username}`,
      dashboard_url: `https://t.me/${this.config.managerUsername || this.config.nssUsername}?start=wwc_${shop.id}`,
      subscribe_url: `https://t.me/${this.config.managerUsername || this.config.nssUsername}?start=wwcsub_${shop.id}`,
    };
  }
  mutate(action: string, id: string, actor: number, payload: Record<string, unknown> = {}) {
    return this.rpc<Shop>('wwc_platform_mutate', {
      p_action: action,
      p_id: id,
      p_actor: actor,
      p_payload: payload,
    });
  }
}
