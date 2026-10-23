import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
test(
  'Twenty real compiled store workers handle browsing and a burst with one memory slot',
  { timeout: 90000 },
  async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('fixtures/capacity-runner.mjs', import.meta.url))],
      {
        timeout: 88000,
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      },
    );
    const report = JSON.parse(stdout.trim().split('\n').at(-1));
    assert.equal(report.shops, 20);
    assert.equal(report.peak_live_workers, 1);
    assert.equal(report.twenty_simultaneous_updates.successes, 20);
    assert.equal(report.twenty_simultaneous_updates.capacity_retries, 0);
    assert.ok(report.worker_peak_heap_bytes < 128 * 1024 * 1024);
    assert.ok(report.controller_plus_worker_peak_rss_bytes < 512 * 1024 * 1024);
    assert.ok(report.peak_queued_requests <= 32);
  },
);
