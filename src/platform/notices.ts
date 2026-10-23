import { registerCopy, validCopy } from '../services/copyCatalog.js';
import type { Lang } from '../../config/index.js';
const messages = {
  en: {
    activated: '✅ Store activated. Use /start, then /admin. Open NSS below to view your store.',
    dashboard: 'NSS · My store',
    subscribe: '💎 Subscribe',
    warning:
      'No customer activity. Your store will pause in 24 hours. Open NSS to view your dashboard.',
    paused:
      'Store paused after {hours} hours without customer activity. Inactivity pauses: {strikes}/3. Open NSS to resume. After the third pause, the platform owner must unlock it.',
  },
  ar: {
    activated: '✅ تم تفعيل المتجر. أرسل /start ثم /admin، وافتح NSS من الزر لمتابعة متجرك.',
    dashboard: 'NSS · متجري',
    subscribe: '💎 اشتراك',
    warning: 'لا يوجد نشاط عملاء. سيتوقف متجرك بعد 24 ساعة. افتح NSS لمتابعة المتجر.',
    paused:
      'توقف المتجر بعد {hours} ساعة دون نشاط عملاء. إيقافات الخمول: {strikes}/3. افتح NSS للتشغيل. الإيقاف الثالث يحتاج فتحًا من مالك المنصة.',
  },
  vi: {
    activated: '✅ Đã kích hoạt cửa hàng. Gửi /start rồi /admin. Mở NSS bên dưới để theo dõi.',
    dashboard: 'NSS · Cửa hàng của tôi',
    subscribe: '💎 Đăng ký',
    warning: 'Không có khách hoạt động. Cửa hàng sẽ tạm dừng sau 24 giờ. Mở NSS để theo dõi.',
    paused:
      'Cửa hàng tạm dừng sau {hours} giờ không hoạt động. Số lần: {strikes}/3. Mở NSS để chạy lại. Sau lần thứ ba, chủ nền tảng phải mở khóa.',
  },
  zh: {
    activated: '✅ 商店已激活。发送 /start 和 /admin，并在下方打开 NSS 查看商店。',
    dashboard: 'NSS · 我的商店',
    subscribe: '💎 订阅',
    warning: '暂无客户活动，商店将在 24 小时后暂停。打开 NSS 查看控制面板。',
    paused:
      '商店因 {hours} 小时无客户活动而暂停，暂停次数：{strikes}/3。打开 NSS 恢复；第三次后需平台所有者解锁。',
  },
};
for (const key of Object.keys(messages.en) as Array<keyof typeof messages.en>) {
  registerCopy({key:'notice.'+key,folder:11,button:['dashboard','subscribe'].includes(key),
    defaults:Object.fromEntries((['en','ar','vi','zh'] as const).map(lang=>[lang,messages[lang][key]])) as Record<Lang,string>});
}
export function notices(lang: string, lookup?: (key:string,lang:Lang)=>string|undefined) {
  const selected=(lang in messages?lang:'en') as Lang,base=messages[selected];
  return Object.fromEntries(Object.entries(base).map(([key,value])=>{
    const override=lookup?.('notice.'+key,selected);
    return [key,override!==undefined&&validCopy(override,value)?override:value];
  })) as typeof messages.en;
}
