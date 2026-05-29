/**
 * mailer.ts — نظام الإيميل محذوف.
 * stub فارغ يمنع أخطاء الـ import في بقية الملفات.
 */

export const WHY_EMAIL_PDF_PATH = '';
export const EMAIL_LOGO_PATH = '';

export type ReportKind = 'orders' | 'deposits' | 'stats' | 'support';

export function logMailerStatus(): void {}

export function describeMailerStatus(): string {
  return 'Email system disabled.';
}

export async function sendWelcomeEmail(_args: {
  email: string;
  previousEmail?: string | null;
  firstName?: string | null;
  username?: string | null;
  mode?: 'set' | 'change' | 'delete';
  [key: string]: unknown;
}): Promise<boolean> {
  return false;
}

export async function sendReportEmail(_args: {
  email: string;
  kind?: ReportKind;
  pdf?: Buffer;
  csv?: Buffer;
  firstName?: string | null;
  username?: string | null;
  [key: string]: unknown;
}): Promise<boolean> {
  return false;
}

export async function sendPriceListEmail(_args: {
  email: string;
  firstName?: string | null;
  username?: string | null;
  pdf?: Buffer;
  [key: string]: unknown;
}): Promise<boolean> {
  return false;
}

export async function sendInvoiceEmail(_args: {
  email: string;
  firstName?: string | null;
  username?: string | null;
  [key: string]: unknown;
}): Promise<boolean> {
  return false;
}