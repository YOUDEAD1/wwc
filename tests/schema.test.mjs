import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('Complete installation schema and its rerun include the secure upgrade', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon;create role authenticated;create role service_role;');
    const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    await db.exec(schema);
    const columns = await db.query(
      `select column_name from information_schema.columns where table_name='orders'`,
    );
    assert.ok(columns.rows.some((r) => r.column_name === 'checkout_key'));
    assert.equal((await db.query('select count(*)::int n from admins')).rows[0].n, 0);
    await db.exec(
      `insert into users(telegram_id,balance,language,language_selected) values(333,12.34,'ar',true)`,
    );
    await db.exec(schema);
    const user = (
      await db.query('select balance,language,language_selected from users where telegram_id=333')
    ).rows[0];
    assert.equal(Number(user.balance), 12.34);
    assert.equal(user.language, 'ar');
    assert.equal(user.language_selected, true);
    const privileges = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')`,
    );
    assert.deepEqual(privileges.rows, []);
  } finally {
    await db.close();
  }
});
