import fs from 'fs';
import path from 'path';

const filePath = 'C:\\\\Users\\\\PC\\\\Desktop\\\\SafwanTigerShopBot\\\\src\\\\handlers\\\\shop.ts';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log(`Total lines: ${lines.length}`);
lines.forEach((line, index) => {
  if (line.includes('purchaseProduct') || line.includes('api_shop') || line.includes('API_PRODUCT_ID')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
