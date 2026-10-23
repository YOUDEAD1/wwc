import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Api } from 'grammy';
import { handleResellerApiRequest } from '../services/resellerApiHttp.js';
export async function workerHttp(api: Api, msg: any) {
  const req = Object.assign(Readable.from([Buffer.from(String(msg.body ?? ''), 'base64')]), {
    method: String(msg.method),
    url: String(msg.path),
    headers: msg.headers ?? {},
    socket: { remoteAddress: String(msg.remote ?? '') },
  }) as unknown as IncomingMessage;
  let status = 200,
    headers: Record<string, string> = {},
    body = '';
  const res = {
    writeHead(code: number, h: Record<string, string>) {
      status = code;
      headers = h;
    },
    end(value = '') {
      body = String(value);
    },
  } as unknown as ServerResponse;
  if (!(await handleResellerApiRequest(req, res, api))) {
    status = 404;
    headers = { 'content-type': 'application/json' };
    body = '{"error":"not_found"}';
  }
  return { type: 'api_result', id: msg.id, status, headers, body };
}
