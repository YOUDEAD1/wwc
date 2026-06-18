import { refreshSettings } from './services/settings.js';
import { supabase } from './db/supabase.js';
import {
  generateApiKey,
  getApiSecretPath,
  listApiProducts,
  getApiProduct,
  getApiPrices,
  getApiStats,
  setApiPrice,
  setApiProduct,
} from './services/resellerApi.js';
import { addProduct, addCategory } from './db/queries.js';

async function runTest() {
  console.log('🔄 Starting reseller API verification...');
  await refreshSettings();

  const userId = 8004955979; // seeded admin ID

  // 1. Ensure user exists
  const { data: user } = await supabase
    .from('users')
    .select('telegram_id')
    .eq('telegram_id', userId)
    .maybeSingle();

  if (!user) {
    console.log('👤 Inserting test user...');
    await supabase.from('users').insert({
      telegram_id: userId,
      username: 'safwantiger',
      first_name: 'Safwan',
      balance: 100.0,
      language: 'ar',
    });
  }

  // 2. Test getApiSecretPath
  const gateway = await getApiSecretPath();
  console.log(`🔑 Gateway path: ${gateway}`);
  if (!gateway || gateway.length !== 32) {
    throw new Error('Invalid gateway path generated.');
  }

  // 3. Generate API Key
  const { key, status } = await generateApiKey(userId);
  console.log(`🔑 Generated API key: ${key}`);
  console.log(`📈 Initial balance: ${status.balance}`);

  const { data: activeKey } = await supabase
    .from('reseller_api_keys')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (!activeKey) {
    throw new Error('API key is not active in database.');
  }
  const apiKeyId = activeKey.id;

  // 4. Create a test product
  console.log('📦 Creating test category and product...');
  const { data: cat } = await supabase
    .from('categories')
    .select('id')
    .eq('name', 'Test Category')
    .maybeSingle();

  let catId = cat?.id;
  if (!catId) {
    const newCat = await addCategory('Test Category', '📦');
    catId = newCat.id;
  }

  const prod = await addProduct({
    category_id: catId,
    name: 'Test Reseller Product',
    price: 10.0,
    stock: 50,
    description: 'Original description',
    emoji: '⭐',
    unlimited_stock: false,
  });
  console.log(`📦 Created product: ID ${prod.id}, Price ${prod.price}`);

  // 5. Test setApiPrice
  console.log('💲 Testing setApiPrice...');
  const priceResult = await setApiPrice({
    apiKeyId,
    productId: prod.id,
    price: 15.0,
    userId,
  });
  console.log('💲 Price lock result:', priceResult);
  if (priceResult.your_price !== 15.0) {
    throw new Error('Failed to set reseller sell price.');
  }

  // 6. Test setApiProduct (customization)
  console.log('🎨 Testing setApiProduct...');
  const customResult = await setApiProduct({
    apiKeyId,
    productId: prod.id,
    userId,
    name_ar: 'منتج تجريبي معدل',
    desc_en: 'Customized description via API',
  });
  console.log('🎨 Customization result:', customResult);

  // 7. Test listApiProducts
  console.log('📋 Testing listApiProducts...');
  const productsList = await listApiProducts({
    userId,
    apiKeyId,
    limit: 10,
    offset: 0,
  });
  const matchedProduct = productsList.products.find((p) => Number(p.id) === prod.id);
  if (!matchedProduct) {
    throw new Error('Test product not found in API product list.');
  }
  console.log('📋 Mapped product from list:', matchedProduct);
  if (matchedProduct.your_price !== 15.0 || matchedProduct.name_ar !== 'منتج تجريبي معدل') {
    throw new Error('Product properties mapping failed.');
  }

  // 8. Test getApiProduct
  console.log('🔍 Testing getApiProduct...');
  const productDetail = await getApiProduct({
    productId: prod.id,
    userId,
    apiKeyId,
  });
  console.log('🔍 Product detail result:', productDetail);
  if (productDetail.desc_en !== 'Customized description via API') {
    throw new Error('Product detail customization mapping failed.');
  }

  // 9. Test getApiPrices
  console.log('💸 Testing getApiPrices...');
  const pricesList = await getApiPrices(apiKeyId);
  console.log('💸 Prices list:', pricesList);
  if (pricesList.length === 0 || pricesList[0].your_price !== 15.0) {
    throw new Error('Custom prices list mismatch.');
  }

  // 10. Test getApiStats
  console.log('📊 Testing getApiStats...');
  const stats = await getApiStats(userId);
  console.log('📊 Stats result:', stats);
  if (stats.balance !== 100.0) {
    throw new Error('Stats balance mismatch.');
  }

  // Cleanup test product and pricing
  console.log('🧹 Cleaning up database...');
  await supabase.from('reseller_api_pricing').delete().eq('api_key_id', apiKeyId);
  await supabase.from('products').delete().eq('id', prod.id);

  console.log('✅ All Reseller API service tests passed successfully!');
}

runTest().catch((err) => {
  console.error('❌ Reseller API test failed:', err);
  process.exit(1);
});
