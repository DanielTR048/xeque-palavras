import { handleApi, type SyncEnvironment } from '../src/server/api';
import assets from '../.sites-runtime/assets.json';

const files = assets as Record<string, { type: string; data: string }>;
export default {
  async fetch(request: Request, env: SyncEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    // Pages contain only the public application shell. All player records require API authorization.
    const path = url.pathname === '/' || url.pathname === '/connect' || url.pathname === '/connect/' ? '/index.html' : url.pathname;
    const asset = Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined;
    if (!asset) return new Response('Not found', { status: 404 });
    const bytes = Uint8Array.from(atob(asset.data), char => char.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
      'Content-Type': asset.type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    } });
  },
};
