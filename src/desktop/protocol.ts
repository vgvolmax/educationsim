import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { protocol } from 'electron';
import { rendererAsset } from './policy';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
const policy = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'",
  "worker-src 'self'", "connect-src 'self'", "font-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

export function installAppProtocol(root: string): void {
  protocol.handle('app', async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const asset = rendererAsset(request.url);
    const type = asset && types[extname(asset)];
    if (!asset || !type) return new Response(null, { status: 404 });

    try {
      const bytes = await readFile(join(root, asset));
      return new Response(Uint8Array.from(bytes), {
        headers: {
          'Content-Type': type,
          'Content-Security-Policy': policy,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
