import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Bot, InputFile } from 'grammy';
import { managerFetch } from '../src/services/telegramFetch.ts';
import { measuredFetch } from '../src/services/networkMeter.ts';
test(
  'Native WWC transport sends SQL as a streamed Telegram document and supports cancellation',
  { timeout: 10000 },
  async () => {
    const received = [];
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push({
        path: req.url,
        type: req.headers['content-type'],
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url?.endsWith('/getMe')) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          result: { message_id: 1, date: 1, chat: { id: 1001, type: 'private' } },
        }),
      );
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const bot = new Bot('123456789:OFFLINE_NOT_REAL_TOKEN_123456789', {
      botInfo: {
        id: 123456789,
        is_bot: true,
        first_name: 'Fixture',
        username: 'fixture_manager_bot',
      },
      client: {
        apiRoot: 'http://127.0.0.1:' + server.address().port,
        fetch: managerFetch,
        timeoutSeconds: 2,
      },
    });
    try {
      await bot.api.sendMessage(1001, 'Fixture');
      await bot.api.sendDocument(
        1001,
        new InputFile(Buffer.from('-- STORE SQL fixture\nselect 1;'), 'WWC-STORE-SETUP.sql'),
      );
      assert.match(received[0].type, /application\/json/);
      assert.match(received[1].type, /multipart\/form-data/);
      assert.match(received[1].body, /WWC-STORE-SETUP.sql/);
      assert.match(received[1].body, /-- STORE SQL fixture/);
      const worker = new Bot('123456789:OFFLINE_WORKER_TOKEN_123456789', {
        botInfo: {
          id: 123456789,
          is_bot: true,
          first_name: 'Fixture',
          username: 'fixture_worker_bot',
        },
        client: {
          apiRoot: 'http://127.0.0.1:' + server.address().port,
          fetch: measuredFetch,
          timeoutSeconds: 2,
        },
      });
      await worker.api.sendDocument(
        1001,
        new InputFile(Buffer.from('WORKER SQL UPLOAD'), 'worker.sql'),
      );
      assert.match(received[2].body, /WORKER SQL UPLOAD/);

      const began = performance.now();
      const abort = new AbortController();
      const pending = bot.api.getMe(abort.signal);
      setTimeout(() => abort.abort(), 25);
      await assert.rejects(pending);
      assert.ok(
        performance.now() - began < 500,
        'Cancellation must abort the request before its timeout',
      );
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  },
);
