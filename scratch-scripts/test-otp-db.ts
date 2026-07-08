import { listActiveTenants } from './tenants/store.js';
import { runWithTenantContext } from './db/db_context.js';
import { supabase } from './db/supabase.js';

async function main() {
  const tenants = await listActiveTenants();
  const krownic = tenants.find((t) => t.id === 't_mqcgdznx_nq503j' || t.bot_username === 'KROWNIC_BOT');
  if (!krownic) {
    console.log('Krownic tenant not found.');
    return;
  }

  console.log(`Checking function in tenant db: ${krownic.id}`);
  await runWithTenantContext(
    krownic.supabase_url,
    krownic.supabase_service_key,
    krownic.owner_telegram_id,
    async () => {
      // Query adjust_balance function
      const { data, error } = await supabase.rpc('adjust_balance', {
        p_telegram_id: krownic.owner_telegram_id,
        p_delta: 0,
      });

      if (error) {
        console.error('adjust_balance RPC test returned error:', error);
      } else {
        console.log('adjust_balance RPC test returned success:', data);
      }

      // Check if wallet_ledger table exists and has rows
      const { data: ledger, error: ledgerErr } = await supabase
        .from('wallet_ledger')
        .select('*')
        .limit(3);
      if (ledgerErr) {
        console.error('Error querying wallet_ledger table:', ledgerErr);
      } else {
        console.log('wallet_ledger table works, sample:', ledger);
      }
    }
  );
}

main().catch(console.error);
