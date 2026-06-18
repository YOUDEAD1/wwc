import { supabase } from './db/supabase.js';
import { listActiveTenants } from './tenants/store.js';
import { runWithTenantContext, getDb } from './db/db_context.js';
import { env } from './env.js';

async function test() {
  console.log('--- STARTING MULTI-TENANT VERIFICATION ---');
  
  // 1. Verify master database URL
  const defaultUrl = (supabase as any).supabaseUrl;
  console.log('Default Supabase URL:', defaultUrl);
  if (defaultUrl !== env.SUPABASE_URL) {
    console.error('ERROR: Default URL does not match env.SUPABASE_URL');
    process.exit(1);
  }
  
  // 2. Fetch active tenants
  let tenants = [];
  try {
    tenants = await listActiveTenants();
    console.log(`Found ${tenants.length} active tenants in master DB`);
  } catch (err) {
    console.error('Failed to list tenants:', err);
    process.exit(1);
  }

  if (tenants.length === 0) {
    console.log('No active tenants found. Creating a mock test context...');
    const mockTenant = {
      supabase_url: 'https://mock-tenant-url.supabase.co',
      supabase_service_key: 'mock-tenant-key-mock-tenant-key-mock-tenant-key',
      owner_telegram_id: 999999
    };
    
    await runWithTenantContext(
      mockTenant.supabase_url,
      mockTenant.supabase_service_key,
      mockTenant.owner_telegram_id,
      async () => {
        const activeUrl = (supabase as any).supabaseUrl;
        console.log('Active Supabase URL inside context:', activeUrl);
        if (activeUrl !== mockTenant.supabase_url) {
          throw new Error(`Expected URL to be ${mockTenant.supabase_url} but got ${activeUrl}`);
        }
        console.log('SUCCESS: Context correctly routed to mock tenant URL!');
      }
    );
  } else {
    const tenant = tenants[0]!;
    console.log(`Testing with tenant: ${tenant.bot_username || tenant.id}`);
    console.log(`Tenant Supabase URL: ${tenant.supabase_url}`);
    
    await runWithTenantContext(
      tenant.supabase_url,
      tenant.supabase_service_key,
      tenant.owner_telegram_id,
      async () => {
        const activeUrl = (supabase as any).supabaseUrl;
        console.log('Active Supabase URL inside context:', activeUrl);
        if (activeUrl !== tenant.supabase_url) {
          throw new Error(`Expected URL to be ${tenant.supabase_url} but got ${activeUrl}`);
        }
        
        // Let's run a test query on the tenant's database settings table
        try {
          const { data, error } = await supabase
            .from('settings')
            .select('key,value')
            .limit(1);
          if (error) {
            console.log('Tenant query ran but returned error (expected if mock credentials or key mismatch):', error.message);
          } else {
            console.log('Successfully queried tenant database! Settings sample:', data);
          }
        } catch (err) {
          console.log('Query failed as expected under context:', err);
        }
        
        console.log('SUCCESS: Context correctly routed to active tenant URL!');
      }
    );
  }

  // Verify that after exiting the context, we are back to the default URL
  const postUrl = (supabase as any).supabaseUrl;
  console.log('Supabase URL after context exit:', postUrl);
  if (postUrl !== env.SUPABASE_URL) {
    console.error('ERROR: URL did not revert back to default after context exit');
    process.exit(1);
  }

  console.log('--- ALL VERIFICATIONS PASSED SUCCESSFULLY ---');
}

test().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
