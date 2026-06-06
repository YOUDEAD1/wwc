-- =====================================================================
-- 0028_clear_catalog_prices_promos.sql
-- Remove all current product catalog, custom prices, and promo data.
--
-- Historical orders stay intact: orders.product_id is ON DELETE SET NULL
-- and each order already stores product_name, qty, unit_price, total, and
-- discount snapshots.
-- =====================================================================

begin;

-- Global promos are not tied to products, so delete promo rules first.
delete from public.promos;

-- Remove promo copy from price-list/profile surfaces.
update public.settings
   set value = 'null'::jsonb,
       updated_at = now()
 where key in ('price_list.promo_text', 'profile.pricelist.promo_footer_override');

-- Clear per-user price overrides before removing products.
delete from public.user_price_overrides;

-- Product-scoped data would cascade from products, but explicit deletes
-- make the intent clear and keep this migration readable.
delete from public.referral_redemptions;
delete from public.product_items;

-- Remove every product from the bot catalog.
delete from public.products;

commit;
