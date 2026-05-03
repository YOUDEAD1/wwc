/**
 * CSV builders that mirror every PDF emailed to users so the admin
 * (or the user themselves) can open the same data in Excel /
 * Google Sheets for sorting, filtering, charting.
 *
 * One builder per ReportKind:
 *   buildOrdersCsv   ← My Orders   (mirrors buildOrdersPdf)
 *   buildDepositsCsv ← My Deposits (mirrors buildDepositsPdf, payments + ledger)
 *   buildStatsCsv    ← My Stats    (mirrors buildStatsPdf)
 *   buildSupportTranscriptCsv ← Live Support / Kiwi Ai chat transcript
 *
 * All values are RFC-4180 quoted (commas, quotes, and newlines
 * inside text get escaped properly so a multi-line message body
 * stays in a single CSV cell).
 */
import type {
  DBOrder,
  DBDeposit,
  DBWalletLedger,
} from '../types.js';
import type { ReportUser, StatsReport } from './pdfReport.js';
import type { SupportTranscriptEntry } from './pdfReport.js';

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRows(rows: Array<Array<string | number | null | undefined>>): Buffer {
  return Buffer.from(
    rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n',
    'utf8',
  );
}

/** Header rows that prefix every CSV so the recipient can see who
 *  the file is for + when it was generated, without having to open
 *  the matching PDF. Two-column key/value pairs, then a blank row,
 *  then the table header in the next builder. */
function preludeRows(
  user: ReportUser,
  title: string,
): Array<Array<string | number | null>> {
  return [
    ['Report', title],
    ['Generated at', new Date().toISOString()],
    ['Telegram ID', user.telegram_id],
    ['Username', user.username ?? ''],
    ['First name', user.first_name ?? ''],
    ['Email', user.email ?? ''],
    [],
  ];
}

// ---------------------------------------------------------------------------
//  My Orders
// ---------------------------------------------------------------------------
export function buildOrdersCsv(args: {
  user: ReportUser;
  orders: DBOrder[];
}): Buffer {
  const rows: Array<Array<string | number | null | undefined>> = [
    ...preludeRows(args.user, 'My Orders'),
    [
      'order_id',
      'product_id',
      'product_name',
      'quantity',
      'unit_price_usdt',
      'total_usdt',
      'status',
      'delivery',
      'created_at',
    ],
  ];
  for (const o of args.orders) {
    rows.push([
      o.id,
      o.product_id ?? '',
      o.product_name,
      o.qty,
      Number(o.unit_price).toFixed(2),
      Number(o.total).toFixed(2),
      o.status,
      o.delivery ?? '',
      o.created_at,
    ]);
  }
  return csvRows(rows);
}

// ---------------------------------------------------------------------------
//  My Deposits — emits both payment deposits AND the wallet ledger
//  in the same CSV, distinguished by the first `kind` column.
// ---------------------------------------------------------------------------
export function buildDepositsCsv(args: {
  user: ReportUser;
  deposits: DBDeposit[];
  ledger: DBWalletLedger[];
}): Buffer {
  const rows: Array<Array<string | number | null | undefined>> = [
    ...preludeRows(args.user, 'My Deposits'),
    [
      'kind',
      'id',
      'method_or_type',
      'amount_usdt',
      'status',
      'reference',
      'note',
      'created_at',
      'updated_at',
    ],
  ];
  for (const d of args.deposits) {
    rows.push([
      'payment_deposit',
      d.id,
      d.method,
      Number(d.amount).toFixed(2),
      d.status,
      d.reference ?? '',
      d.note ?? '',
      d.created_at,
      d.updated_at,
    ]);
  }
  for (const l of args.ledger) {
    rows.push([
      'wallet_ledger',
      l.id,
      l.type,
      Number(l.amount).toFixed(2),
      '',
      l.reference ?? '',
      '',
      l.created_at,
      '',
    ]);
  }
  return csvRows(rows);
}

// ---------------------------------------------------------------------------
//  My Stats — single-row aggregate.
// ---------------------------------------------------------------------------
export function buildStatsCsv(args: {
  user: ReportUser;
  stats: StatsReport;
}): Buffer {
  const rows: Array<Array<string | number | null | undefined>> = [
    ...preludeRows(args.user, 'My Stats'),
    [
      'total_orders',
      'total_items',
      'total_spent_usdt',
      'total_deposits_usdt',
      'last_order_at',
    ],
    [
      args.stats.orders,
      args.stats.items,
      args.stats.spent.toFixed(2),
      args.stats.deposits.toFixed(2),
      args.stats.lastOrderAt ?? '',
    ],
  ];
  return csvRows(rows);
}

// ---------------------------------------------------------------------------
//  Live Support / Kiwi Ai transcript — one row per message.
// ---------------------------------------------------------------------------
export function buildSupportTranscriptCsv(args: {
  sessionStartedAt: Date;
  sessionEndedAt: Date;
  user: { telegram_id: number; first_name: string; username: string | null };
  endedBy: 'user' | 'admin';
  entries: SupportTranscriptEntry[];
}): Buffer {
  const reportUser: ReportUser = {
    telegram_id: args.user.telegram_id,
    first_name: args.user.first_name,
    username: args.user.username,
    email: null,
  };
  const durationSec = Math.max(
    0,
    Math.floor(
      (args.sessionEndedAt.getTime() - args.sessionStartedAt.getTime()) / 1000,
    ),
  );
  const rows: Array<Array<string | number | null | undefined>> = [
    ...preludeRows(reportUser, 'Support Transcript'),
    ['Session started at', args.sessionStartedAt.toISOString()],
    ['Session ended at', args.sessionEndedAt.toISOString()],
    ['Duration (seconds)', durationSec],
    ['Messages', args.entries.length],
    ['Ended by', args.endedBy],
    [],
    ['index', 'at', 'side', 'author', 'text'],
  ];
  args.entries.forEach((e, i) => {
    rows.push([i + 1, e.at.toISOString(), e.side, e.author, e.text]);
  });
  return csvRows(rows);
}
