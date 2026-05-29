import { type SupabaseClient } from '@supabase/supabase-js';
import { getDefaultClient } from './context.js';

// للكود الذي يستورد supabase مباشرة — يستخدم الـ default client
// الـ tenant client يُمرر عبر ctx.db في كل request
export const supabase: SupabaseClient = getDefaultClient();

export { getDefaultClient as getDb };