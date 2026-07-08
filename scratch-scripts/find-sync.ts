import fs from 'fs';
import path from 'path';

function searchDir(dirPath) {
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      searchDir(filePath);
    } else if (file.endsWith('.ts') || file.endsWith('.js')) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.toLowerCase().includes('sync')) {
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('sync') || line.includes('Sync') || line.includes('supplierApi') || line.includes('apiShop')) {
            console.log(`${path.basename(filePath)} Line ${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
  });
}

const targetDir = 'C:\\\\Users\\\\PC\\\\Desktop\\\\SafwanTigerShopBot\\\\src';
searchDir(targetDir);
console.log('Search completed.');
