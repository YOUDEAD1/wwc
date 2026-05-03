/**
 * PDF report generator for the user-facing "Send PDF to email"
 * buttons in My Orders / My Deposits / Stats.
 *
 * One module, three reports:
 *   - buildOrdersPdf({ user, orders })
 *   - buildDepositsPdf({ user, deposits, ledger })
 *   - buildStatsPdf({ user, stats })
 *
 * Each function returns a `Buffer` so the caller can attach it
 * directly to a Resend / SMTP send. The generated PDF uses the same
 * ink + champagne-gold palette as the welcome email so the brand
 * stays consistent. Layout is intentionally letter-sized portrait
 * with generous margins — Telegram users will most often open the
 * PDF on mobile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { DBOrder, DBDeposit, DBWalletLedger } from '../types.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** Path to the SafwanTiger Shop logo (same asset used in the email). */
const LOGO_PATH = path.resolve(__dirname, '../../../assets/email-logo.png');

// ---------------------------------------------------------------------------
//  Theme
// ---------------------------------------------------------------------------
const COLOR = {
  page: '#070707',
  card: '#0f0f10',
  inner: '#16151a',
  border: '#2a2722',
  borderGold: '#3a322a',
  gold: '#d4a574',
  goldHi: '#e6c08c',
  cream: '#f5f1e8',
  body: '#d8d3c8',
  muted: '#8a8378',
  mutedDim: '#5a5550',
} as const;

const PAGE_W = 612; // letter width in PDF points
const PAGE_H = 792;
const MARGIN_X = 48;

export type ReportUser = {
  telegram_id: number;
  first_name: string | null;
  username: string | null;
  email: string | null;
};

export type StatsReport = {
  orders: number;
  items: number;
  spent: number;
  lastOrderAt: string | null;
  deposits: number;
};

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------
export async function buildOrdersPdf(args: {
  user: ReportUser;
  orders: DBOrder[];
}): Promise<Buffer> {
  return renderPdf('My Orders', args.user, (doc) => {
    if (args.orders.length === 0) {
      drawEmpty(doc, 'No orders yet.');
      return;
    }
    drawSummary(doc, [
      ['Total orders', String(args.orders.length)],
      [
        'Total spent',
        `${args.orders
          .reduce((s, o) => s + Number(o.total), 0)
          .toFixed(2)} USDT`,
      ],
    ]);
    for (const o of args.orders) {
      drawOrderCard(doc, o);
    }
  });
}

export async function buildDepositsPdf(args: {
  user: ReportUser;
  deposits: DBDeposit[];
  ledger: DBWalletLedger[];
}): Promise<Buffer> {
  return renderPdf('My Deposits', args.user, (doc) => {
    if (args.deposits.length === 0 && args.ledger.length === 0) {
      drawEmpty(doc, 'No deposits or wallet activity yet.');
      return;
    }
    const approved = args.deposits.filter((d) => d.status === 'approved');
    drawSummary(doc, [
      ['Approved deposits', String(approved.length)],
      [
        'Approved total',
        `${approved.reduce((s, d) => s + Number(d.amount), 0).toFixed(2)} USDT`,
      ],
      ['Wallet ledger entries', String(args.ledger.length)],
    ]);
    if (args.deposits.length > 0) {
      drawSectionHeader(doc, 'Payment deposits');
      for (const d of args.deposits) drawDepositCard(doc, d);
    }
    if (args.ledger.length > 0) {
      drawSectionHeader(doc, 'Wallet balance history');
      for (const row of args.ledger) drawLedgerCard(doc, row);
    }
  });
}

export async function buildStatsPdf(args: {
  user: ReportUser;
  stats: StatsReport;
}): Promise<Buffer> {
  return renderPdf('My Stats', args.user, (doc) => {
    const s = args.stats;
    drawSummary(doc, [
      ['Total orders', String(s.orders)],
      ['Total items', String(s.items)],
      ['Total spent', `${s.spent.toFixed(2)} USDT`],
      ['Total deposits', `${s.deposits.toFixed(2)} USDT`],
      [
        'Last order',
        s.lastOrderAt ? formatTimestamp(s.lastOrderAt) : '—',
      ],
    ]);
    drawSectionHeader(doc, 'Account snapshot');
    drawInfoBlock(doc, [
      `These figures cover every paid order and approved deposit linked to your`,
      `Telegram account at the time this report was generated.`,
      ``,
      `For a per-order breakdown send the My Orders PDF; for a per-deposit`,
      `breakdown send the My Deposits PDF — both include the same brand header`,
      `and timestamp footer as this report.`,
    ]);
  });
}

/**
 * Live Support transcript PDF — chat-bubble style. The customer's
 * messages render as right-aligned green bubbles, admin's as
 * left-aligned card-coloured bubbles, mirroring how a regular
 * one-on-one chat looks. Sent to admin when a session ends so they
 * have a permanent record of the full conversation.
 */
export type SupportTranscriptEntry = {
  at: Date;
  side: 'user' | 'admin';
  author: string;
  text: string;
};

export async function buildSupportTranscriptPdf(args: {
  sessionStartedAt: Date;
  sessionEndedAt: Date;
  user: { telegram_id: number; first_name: string; username: string | null };
  endedBy: 'user' | 'admin';
  entries: SupportTranscriptEntry[];
}): Promise<Buffer> {
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
  return renderPdf('Live Support — Transcript', reportUser, (doc) => {
    drawSummary(doc, [
      ['Customer', `${args.user.first_name} (#${args.user.telegram_id})`],
      ['Username', args.user.username ? `@${args.user.username}` : '—'],
      ['Started', formatTimestamp(args.sessionStartedAt.toISOString())],
      ['Ended', formatTimestamp(args.sessionEndedAt.toISOString())],
      [
        'Duration',
        `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`,
      ],
      ['Ended by', args.endedBy],
      ['Total messages', String(args.entries.length)],
    ]);
    drawSectionHeader(doc, 'Conversation');
    if (args.entries.length === 0) {
      drawInfoBlock(doc, [
        'No messages were exchanged during this Live Support session.',
      ]);
      return;
    }
    for (const entry of args.entries) {
      drawChatBubble(doc, entry);
    }
  });
}

function drawChatBubble(
  doc: PDFKit.PDFDocument,
  entry: SupportTranscriptEntry,
): void {
  const isUser = entry.side === 'user';
  const maxBubbleW = (PAGE_W - MARGIN_X * 2) * 0.72;
  const padX = 14;
  const padY = 10;

  doc.font('Helvetica').fontSize(11);
  const textW = Math.min(
    maxBubbleW - padX * 2,
    Math.max(60, doc.widthOfString(entry.text)),
  );
  // Estimate height by re-running through pdfkit's measurement.
  const measuredH = doc.heightOfString(entry.text, { width: textW });
  const metaH = 14;
  const bubbleH = measuredH + padY * 2 + metaH;

  ensureRoom(doc, bubbleH + 14);

  const y = doc.y;
  const bubbleW = textW + padX * 2;
  const bubbleX = isUser
    ? PAGE_W - MARGIN_X - bubbleW
    : MARGIN_X;
  const fill = isUser ? COLOR.gold : COLOR.card;
  const textColor = isUser ? '#1a1814' : COLOR.cream;

  doc.save();
  doc.roundedRect(bubbleX, y, bubbleW, bubbleH, 12).fill(fill);
  doc.restore();

  // Author + time line
  const time = `${String(entry.at.getUTCHours()).padStart(2, '0')}:${String(
    entry.at.getUTCMinutes(),
  ).padStart(2, '0')} UTC`;
  doc
    .fillColor(isUser ? '#3a3a3a' : COLOR.muted)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(`${entry.author} · ${time}`, bubbleX + padX, y + padY - 2, {
      width: textW,
      align: isUser ? 'right' : 'left',
    });

  // Body
  doc
    .fillColor(textColor)
    .font('Helvetica')
    .fontSize(11)
    .text(entry.text, bubbleX + padX, y + padY + metaH, {
      width: textW,
    });

  doc.y = y + bubbleH + 8;
}

// ---------------------------------------------------------------------------
//  Internals
// ---------------------------------------------------------------------------

function renderPdf(
  title: string,
  user: ReportUser,
  drawBody: (doc: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Bottom margin must be small enough that the footer text
      // (drawn at PAGE_H - 36 inside the chrome painter) doesn't
      // trigger pdfkit's auto-pagination — when text() lands past
      // the bottom margin pdfkit calls addPage() for us, which then
      // re-fires pageAdded → infinite chrome painting.
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 96, bottom: 0, left: MARGIN_X, right: MARGIN_X },
        info: {
          Title: `SafwanTiger Shop — ${title}`,
          Author: 'SafwanTiger Shop',
          Subject: `${title} report`,
          Creator: 'SafwanTiger Shop Bot',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Re-entrancy guard: pdfkit's `text()` can auto-paginate when
      // a string is too long for the current line, which fires the
      // `pageAdded` event and would re-enter paintPageChrome — that
      // recursion blows the stack. We never paginate from inside
      // chrome painting because the chrome is fixed-position only.
      let paintingChrome = false;
      doc.on('pageAdded', () => {
        if (paintingChrome) return;
        paintingChrome = true;
        try {
          paintPageChrome(doc, title, user);
        } finally {
          paintingChrome = false;
        }
      });
      paintingChrome = true;
      try {
        paintPageChrome(doc, title, user);
      } finally {
        paintingChrome = false;
      }

      // Reset cursor under the header band
      doc.y = 168;
      drawBody(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function paintPageChrome(
  doc: PDFKit.PDFDocument,
  title: string,
  user: ReportUser,
): void {
  // Full-page ink background
  doc.save();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(COLOR.page);
  doc.restore();

  // Header band
  const bandH = 132;
  doc.save();
  doc.rect(0, 0, PAGE_W, bandH).fill(COLOR.card);
  doc.restore();

  // Hairline gold accent at the very top
  doc.save();
  doc.rect(0, 0, PAGE_W, 1.5).fill(COLOR.gold);
  doc.restore();

  // Hairline divider under the band
  doc.save();
  doc.rect(0, bandH, PAGE_W, 0.5).fill(COLOR.borderGold);
  doc.restore();

  // Logo (circular crop)
  if (fs.existsSync(LOGO_PATH)) {
    const size = 56;
    const cx = MARGIN_X + size / 2;
    const cy = bandH / 2;
    doc.save();
    doc.circle(cx, cy, size / 2).clip();
    doc.image(LOGO_PATH, MARGIN_X, cy - size / 2, {
      width: size,
      height: size,
    });
    doc.restore();
    // Champagne ring
    doc.save();
    doc
      .lineWidth(1.5)
      .strokeColor(COLOR.gold)
      .circle(cx, cy, size / 2)
      .stroke();
    doc.restore();
  }

  // Brand block — `lineBreak: false` is critical: pdfkit's text() will
  // otherwise trigger auto-pagination if it ever overflows, which
  // calls pageAdded, which calls us again → stack overflow.
  const textX = MARGIN_X + 56 + 18;
  doc
    .fillColor(COLOR.gold)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('SAFWANTIGER  SHOP', textX, 38, {
      characterSpacing: 1.6,
      lineBreak: false,
    });
  doc
    .fillColor(COLOR.cream)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(title, textX, 54, { characterSpacing: 0.2, lineBreak: false });
  doc
    .fillColor(COLOR.muted)
    .font('Helvetica')
    .fontSize(9)
    .text(
      `Generated ${formatTimestamp(new Date().toISOString())}`,
      textX,
      82,
      { characterSpacing: 0.4, lineBreak: false },
    );

  // User identity (right side)
  const idLines = [
    user.first_name ? user.first_name : 'SafwanTiger Shop user',
    user.username ? `@${user.username}` : null,
    `ID: ${user.telegram_id}`,
    user.email ? user.email : null,
  ].filter(Boolean) as string[];
  const rightX = PAGE_W - MARGIN_X - 200;
  doc.font('Helvetica').fontSize(9).fillColor(COLOR.muted);
  for (let i = 0; i < idLines.length; i++) {
    doc.fillColor(i === 0 ? COLOR.cream : COLOR.muted).text(
      idLines[i] ?? '',
      rightX,
      38 + i * 14,
      { width: 200, align: 'right', lineBreak: false },
    );
  }

  // Footer (bottom of page, every page)
  doc
    .fillColor(COLOR.mutedDim)
    .font('Helvetica')
    .fontSize(8)
    .text(
      'SafwanTiger Shop · @safwantigershopbot · shopbot@safwantiger.com',
      MARGIN_X,
      PAGE_H - 36,
      {
        width: PAGE_W - MARGIN_X * 2,
        align: 'center',
        characterSpacing: 0.4,
        lineBreak: false,
      },
    );
}

function drawSummary(doc: PDFKit.PDFDocument, rows: Array<[string, string]>): void {
  const cardX = MARGIN_X;
  const cardW = PAGE_W - MARGIN_X * 2;
  const padX = 22;
  const rowH = 28;
  const titleH = 32;
  const cardH = titleH + rowH * rows.length + 20;

  doc.save();
  doc
    .roundedRect(cardX, doc.y, cardW, cardH, 12)
    .fillAndStroke(COLOR.inner, COLOR.borderGold);
  doc.restore();

  const top = doc.y;
  doc
    .fillColor(COLOR.gold)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('SUMMARY', cardX + padX, top + 14, { characterSpacing: 1.8 });

  let cursor = top + titleH + 8;
  for (const [label, value] of rows) {
    doc
      .fillColor(COLOR.muted)
      .font('Helvetica')
      .fontSize(10)
      .text(label, cardX + padX, cursor + 8, {
        width: cardW - padX * 2 - 200,
      });
    doc
      .fillColor(COLOR.cream)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(value, cardX + cardW - padX - 200, cursor + 7, {
        width: 200,
        align: 'right',
      });
    cursor += rowH;
    // hairline separator
    doc.save();
    doc
      .rect(cardX + padX, cursor - 4, cardW - padX * 2, 0.4)
      .fill(COLOR.border);
    doc.restore();
  }

  doc.y = top + cardH + 18;
}

function drawSectionHeader(doc: PDFKit.PDFDocument, label: string): void {
  ensureRoom(doc, 32);
  doc
    .fillColor(COLOR.gold)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(label.toUpperCase(), MARGIN_X, doc.y + 4, { characterSpacing: 1.6 });
  doc.y += 22;
}

function drawOrderCard(doc: PDFKit.PDFDocument, o: DBOrder): void {
  const cardW = PAGE_W - MARGIN_X * 2;
  const lines: Array<[string, string]> = [
    ['Order ID', `#${o.id}`],
    ['Product', o.product_name],
    ['Qty', String(o.qty)],
    ['Unit price', `${Number(o.unit_price).toFixed(2)} USDT`],
    ['Total', `${Number(o.total).toFixed(2)} USDT`],
    [
      'Status',
      o.status === 'paid'
        ? 'Active'
        : o.status === 'refunded'
          ? 'Refunded'
          : 'Cancelled',
    ],
    ['Placed', formatTimestamp(o.created_at)],
  ];
  if (o.delivery) {
    lines.push(['Delivery', truncate(o.delivery.replace(/\s+/g, ' '), 240)]);
  }
  drawKvCard(doc, cardW, lines, o.product_name);
}

function drawDepositCard(doc: PDFKit.PDFDocument, d: DBDeposit): void {
  const cardW = PAGE_W - MARGIN_X * 2;
  const lines: Array<[string, string]> = [
    ['Deposit ID', `#${d.id}`],
    ['Amount', `${Number(d.amount).toFixed(2)} USDT`],
    ['Method', d.method],
    [
      'Status',
      d.status === 'approved'
        ? 'Approved'
        : d.status === 'pending'
          ? 'Pending'
          : 'Rejected',
    ],
  ];
  if (d.reference) lines.push(['Reference', d.reference]);
  lines.push(['Created', formatTimestamp(d.created_at)]);
  drawKvCard(doc, cardW, lines, `Deposit #${d.id}`);
}

function drawLedgerCard(doc: PDFKit.PDFDocument, row: DBWalletLedger): void {
  const cardW = PAGE_W - MARGIN_X * 2;
  const sign = Number(row.amount) >= 0 ? '+' : '−';
  const amount = `${sign}${Math.abs(Number(row.amount)).toFixed(2)} USDT`;
  const lines: Array<[string, string]> = [
    ['Entry ID', `#${row.id}`],
    ['Type', row.type],
    ['Amount', amount],
  ];
  if (row.reference) lines.push(['Reference', row.reference]);
  lines.push(['When', formatTimestamp(row.created_at)]);
  drawKvCard(doc, cardW, lines, row.type);
}

function drawKvCard(
  doc: PDFKit.PDFDocument,
  width: number,
  lines: Array<[string, string]>,
  title: string,
): void {
  const padX = 22;
  const titleH = 28;
  const lineH = 18;
  const cardH = titleH + lines.length * lineH + 18;
  ensureRoom(doc, cardH + 12);

  const top = doc.y;
  doc.save();
  doc
    .roundedRect(MARGIN_X, top, width, cardH, 10)
    .fillAndStroke(COLOR.inner, COLOR.border);
  doc.restore();

  doc
    .fillColor(COLOR.cream)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(truncate(title, 80), MARGIN_X + padX, top + 10, {
      width: width - padX * 2,
    });

  let cursor = top + titleH + 6;
  for (const [k, v] of lines) {
    doc
      .fillColor(COLOR.muted)
      .font('Helvetica')
      .fontSize(9)
      .text(k, MARGIN_X + padX, cursor, { width: 130 });
    doc
      .fillColor(COLOR.body)
      .font('Helvetica')
      .fontSize(9.5)
      .text(v, MARGIN_X + padX + 130, cursor, {
        width: width - padX * 2 - 130,
      });
    cursor += lineH;
  }

  doc.y = top + cardH + 12;
}

function drawEmpty(doc: PDFKit.PDFDocument, message: string): void {
  ensureRoom(doc, 80);
  doc
    .fillColor(COLOR.muted)
    .font('Helvetica')
    .fontSize(13)
    .text(message, MARGIN_X, doc.y + 24, {
      width: PAGE_W - MARGIN_X * 2,
      align: 'center',
    });
}

function drawInfoBlock(doc: PDFKit.PDFDocument, lines: string[]): void {
  ensureRoom(doc, 24 + lines.length * 14);
  doc
    .fillColor(COLOR.body)
    .font('Helvetica')
    .fontSize(10);
  for (const line of lines) {
    doc.text(line || ' ', MARGIN_X, doc.y, {
      width: PAGE_W - MARGIN_X * 2,
    });
  }
  doc.y += 8;
}

function ensureRoom(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE_H - 80) {
    doc.addPage();
    doc.y = 168;
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const m = months[d.getUTCMonth()];
  const y = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${m} ${y}, ${hh}:${mm} UTC`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Touch logger so it counts as used in non-debug builds.
void logger;
