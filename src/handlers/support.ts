import type { Composer } from 'grammy';
import { env } from '../env.js';
import { backToMenuKeyboard } from '../keyboards/mainMenu.js';
import type { AppCtx } from '../middleware/user.js';

const aiArmed = new Set<number>();

export function registerSupport(bot: Composer<AppCtx>): void {
  bot.callbackQuery('support:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`${ctx.t('support.title')}\n\n${ctx.t('support.body')}`, {
      parse_mode: 'Markdown',
      reply_markup: backToMenuKeyboard(ctx.lang),
    });
  });

  bot.callbackQuery('support:ai', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`${ctx.t('support.ai.title')}\n\n${ctx.t('support.ai.prompt')}`, {
      parse_mode: 'Markdown',
      reply_markup: backToMenuKeyboard(ctx.lang),
    });
    if (ctx.from) aiArmed.add(ctx.from.id);
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from || !aiArmed.has(ctx.from.id)) return next();
    aiArmed.delete(ctx.from.id);
    const answer = await answerAI(ctx.message.text);
    await ctx.reply(answer, { reply_markup: backToMenuKeyboard(ctx.lang) });
  });
}

async function answerAI(question: string): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    return `🤖 (stub) I received: "${question.slice(0, 200)}"\n\nA human will follow up shortly.`;
  }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              "You are SafwanTiger Shop's helpful customer support assistant. Be concise.",
          },
          { role: 'user', content: question },
        ],
        temperature: 0.3,
      }),
    });
    if (!res.ok) return `🤖 ${await res.text()}`;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? '🤖 (no answer)';
  } catch (err) {
    return `🤖 ${(err as Error).message}`;
  }
}
