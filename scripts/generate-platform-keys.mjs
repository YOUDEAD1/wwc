import { randomBytes } from 'node:crypto';
// Run on your own device. Keep the output private and back it up securely.
console.log('WWC_PLATFORM_SECRET=' + randomBytes(32).toString('hex'));
console.log('WWC_ENCRYPTION_KEY=' + randomBytes(32).toString('base64'));
console.log('WWC_DRAFT_ENCRYPTION_KEY=' + randomBytes(32).toString('base64').replaceAll('+','-').replaceAll('/','_'));
