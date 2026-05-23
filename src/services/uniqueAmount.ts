/**
 * نظام المبلغ الفريد — يمنع replay الهاش
 *
 * الفكرة: كل مستخدم يفتح شاشة الدفع يحصل على مبلغ فريد مختلف
 * مثلاً: بدل 10.00 USDT يصير 10.037 USDT
 *
 * لو شخص حاول يسرق الهاش ويستخدمه لحسابه:
 * - هاشه يحمل مبلغ 10.037 USDT
 * - حسابه يحتاج مثلاً 10.052 USDT (مختلف تماماً)
 * - الـ verifier يرفضه تلقائياً
 *
 * الزيادة: بين 0.001 و 0.099 USDT عشوائية لكل جلسة
 */

/**
 * يولد مبلغاً فريداً بإضافة كسر عشوائي صغير
 */
export function generateUniqueAmount(
    baseAmount: number,
    userId: number,
    methodId: number,
  ): { uniqueAmount: number; tag: string } {
    const random = Math.floor(Math.random() * 99) + 1; // 1-99
    const micro = random / 1000; // 0.001 - 0.099
    const uniqueAmount = Math.round((baseAmount + micro) * 1000) / 1000;
    const tag = `${userId}:${methodId}:${Date.now()}:${random}`;
    return { uniqueAmount, tag };
  }
  
  /**
   * يتحقق أن المبلغ على البلوكشين يطابق المبلغ الفريد
   * نسمح بفارق ±0.001 للتقريب
   */
  export function amountMatchesUnique(
    onChainAmount: number,
    uniqueAmount: number,
  ): boolean {
    return Math.abs(onChainAmount - uniqueAmount) <= 0.001;
  }