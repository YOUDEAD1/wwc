import { type SupabaseClient } from '@supabase/supabase-js';
import { getDb } from './db_context.js';

// Proxy dynamically routes all queries to the tenant's Supabase client if run inside a tenant context.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(target, prop, receiver) {
    const db = getDb();
    const value = Reflect.get(db, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(db);
    }
    return value;
  },
});

export { getDb };