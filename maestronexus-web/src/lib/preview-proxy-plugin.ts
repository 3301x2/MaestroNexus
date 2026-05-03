/**
 * Vite Plugin: Preview Proxy
 *
 * Proxies requests under /___preview___/ to the user's locally-running dev server
 * for initial document loads. Additionally, when a preview target is configured,
 * transparently proxies framework asset paths (/_next/*, /api/*, etc.) so that
 * sub-resource requests from the proxied HTML work without URL rewriting.
 *
 * This makes the iframe same-origin with MaestroNexus, solving:
 *  - Cross-Origin-Embedder-Policy: require-corp (KuzuDB WASM requirement)
 *  - Cookie/auth forwarding for authenticated apps
 *  - X-Frame-Options / CSP frame-ancestors restrictions
 *
 * The target URL is configurable at runtime via POST /___preview-config___/.
 */

import type { Plugin } from 'vite';
import http from 'node:http';
import https from 'node:https';
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

const PROXY_PREFIX = '/___preview___';
const CONFIG_ENDPOINT = '/___preview-config___';
const DEFAULT_TARGET = 'http://localhost:3000';

/**
 * Framework asset path prefixes that should be transparently proxied
 * to the preview target. These are paths that Vite itself will never serve,
 * so there's no collision risk.
 *
 * NOTE: /assets/* is intentionally excluded — Vite uses it for its own output.
 */
const FRAMEWORK_PROXY_PREFIXES = [
  '/_next/',        // Next.js static assets, chunks, HMR, data
  '/api/',          // Next.js / generic API routes
  '/__nextjs',      // Next.js dev overlay, error handling
  '/__next',        // Next.js internal endpoints
  '/static/',       // Django, Flask, generic static files
  '/public/',       // Various frameworks
  '/workbox-',      // Workbox service worker files
];

/** Exact-match paths that should be transparently proxied */
const FRAMEWORK_PROXY_EXACT = [
  '/favicon.ico',
  '/sw.js',
  '/manifest.json',
];

/** Pattern for root-level worker scripts: /anything.worker.js */
const ROOT_WORKER_RE = /^\/[^/]+\.worker\.js(\?.*)?$/;

/**
 * Script injected into proxied HTML documents to disable service workers.
 * Service workers inside an iframe preview cause scope/caching issues.
 */
const SW_DISABLE_SCRIPT = `<script data-preview-sw-disable>
if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(g){g.unregister()})});Object.defineProperty(navigator,'serviceWorker',{get:function(){return{register:function(){return Promise.resolve({scope:'/',unregister:function(){return Promise.resolve(true)}})},getRegistrations:function(){return Promise.resolve([])},ready:Promise.resolve({scope:'/'}),controller:null,addEventListener:function(){},removeEventListener:function(){}}}})}
</script>`;

export function previewProxyPlugin(): Plugin {
  let currentTarget = DEFAULT_TARGET;
  /** True once someone has POSTed a target via /___preview-config___/ */
  let targetConfigured = false;

  /** Check if a URL path should be transparently proxied to the preview target */
  function isFrameworkAssetPath(url: string): boolean {
    // Strip query string for matching
    const path = url.split('?')[0];
    if (FRAMEWORK_PROXY_EXACT.includes(path)) return true;
    if (ROOT_WORKER_RE.test(url)) return true;
    return FRAMEWORK_PROXY_PREFIXES.some(prefix => url.startsWith(prefix));
  }

  function stripSecurityHeaders(proxyRes: http.IncomingMessage) {
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    // Remove restrictive cross-origin headers and set permissive ones.
    // The parent page (MaestroNexus) sets COEP: require-corp, so every
    // sub-resource loaded in the iframe must declare CORP: cross-origin.
    delete proxyRes.headers['cross-origin-opener-policy'];
    delete proxyRes.headers['cross-origin-embedder-policy'];
    delete proxyRes.headers['cross-origin-resource-policy'];
    proxyRes.headers['cross-origin-resource-policy'] = 'cross-origin';
    proxyRes.headers['cross-origin-embedder-policy'] = 'unsafe-none';
  }

  function rewriteCookies(proxyRes: http.IncomingMessage) {
    const setCookies = proxyRes.headers['set-cookie'];
    if (setCookies) {
      proxyRes.headers['set-cookie'] = setCookies.map((cookie: string) =>
        cookie
          .replace(/;\s*Domain=[^;]*/gi, '')
          .replace(/;\s*SameSite=[^;]*/gi, '; SameSite=Lax')
          .replace(/;\s*Secure/gi, '')
      );
    }
  }

  /** Check if a response content-type is HTML */
  function isHtmlResponse(proxyRes: http.IncomingMessage): boolean {
    const ct = proxyRes.headers['content-type'] || '';
    return ct.includes('text/html');
  }

  /** Decompress a response stream if content-encoding is set */
  function decompressStream(proxyRes: http.IncomingMessage): Readable {
    const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();
    switch (encoding) {
      case 'gzip': return proxyRes.pipe(createGunzip());
      case 'br': return proxyRes.pipe(createBrotliDecompress());
      case 'deflate': return proxyRes.pipe(createInflate());
      default: return proxyRes;
    }
  }

  /** Collect a readable stream into a Buffer */
  function streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /** Inject the SW-disable script after <head> in an HTML string */
  function injectSwDisable(html: string): string {
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch && headMatch.index !== undefined) {
      const insertAt = headMatch.index + headMatch[0].length;
      return html.slice(0, insertAt) + SW_DISABLE_SCRIPT + html.slice(insertAt);
    }
    // No <head> tag — prepend to document
    return SW_DISABLE_SCRIPT + html;
  }

  function proxyRequest(
    req: IncomingMessage,
    res: ServerResponse,
    targetUrl: URL,
    /** When true, inject SW-disable script into HTML responses */
    injectIntoHtml = false,
  ) {
    const isHttps = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
    };

    // Remove headers that would confuse the target
    const proxyHeaders = options.headers as Record<string, string | string[] | undefined>;
    delete proxyHeaders['origin'];
    delete proxyHeaders['referer'];

    const proxyReq = transport.request(options, (proxyRes) => {
      // Rewrite any Location headers so redirects stay within the proxy
      const location = proxyRes.headers['location'];
      if (location) {
        try {
          const locUrl = new URL(location, `${targetUrl.protocol}//${targetUrl.host}`);
          if (locUrl.host === targetUrl.host) {
            // If the redirect target is a framework asset path, keep it at root
            // (the transparent proxy will catch it). Otherwise prefix it.
            if (isFrameworkAssetPath(locUrl.pathname)) {
              proxyRes.headers['location'] = `${locUrl.pathname}${locUrl.search}`;
            } else {
              proxyRes.headers['location'] = `${PROXY_PREFIX}${locUrl.pathname}${locUrl.search}`;
            }
          }
        } catch {
          // Leave location header as-is if we can't parse it
        }
      }

      stripSecurityHeaders(proxyRes);
      rewriteCookies(proxyRes);

      // For document requests: buffer HTML, inject SW-disable script, then send
      if (injectIntoHtml && isHtmlResponse(proxyRes)) {
        const decompressed = decompressStream(proxyRes);
        streamToBuffer(decompressed)
          .then((buf) => {
            const html = buf.toString('utf-8');
            const patched = injectSwDisable(html);
            const out = Buffer.from(patched, 'utf-8');

            // Remove content-encoding since we decompressed
            delete proxyRes.headers['content-encoding'];
            delete proxyRes.headers['transfer-encoding'];
            proxyRes.headers['content-length'] = String(out.length);

            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            res.end(out);
          })
          .catch(() => {
            // Fallback: send without injection
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            res.end('Preview proxy: Failed to process HTML');
          });
        return;
      }

      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[preview-proxy] Error connecting to ${currentTarget}:`, err.message);
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html><head><style>
          body { font-family: system-ui, sans-serif; background: #06060a; color: #e4e4ed; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
          .card { max-width: 420px; text-align: center; padding: 40px; }
          h2 { color: #f87171; margin-bottom: 8px; }
          p { color: #8888a0; font-size: 14px; line-height: 1.6; }
          code { color: #7c3aed; background: #16161f; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
        </style></head><body>
          <div class="card">
            <h2>Cannot connect to your app</h2>
            <p>Could not reach <code>${currentTarget}</code></p>
            <p>Make sure your dev server is running, then reload.</p>
          </div>
        </body></html>
      `);
    });

    req.pipe(proxyReq);
  }

  function proxyWebSocket(
    req: IncomingMessage,
    socket: import('node:net').Socket,
    _head: Buffer,
    targetUrl: URL,
  ) {
    const isHttps = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const proxyReq = transport.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        '\r\n\r\n'
      );
      if (proxyHead.length > 0) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on('error', () => {
      socket.destroy();
    });

    proxyReq.end();
  }

  return {
    name: 'preview-proxy',
    configureServer(server) {
      // ── Config endpoint: POST/GET /___preview-config___/ ──────────────
      server.middlewares.use((req, res, next) => {
        if (req.url === CONFIG_ENDPOINT || req.url === `${CONFIG_ENDPOINT}/`) {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                if (data.target && typeof data.target === 'string') {
                  currentTarget = data.target.replace(/\/$/, '');
                  targetConfigured = true;
                  console.log(`[preview-proxy] Target updated: ${currentTarget}`);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: true, target: currentTarget }));
                } else {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Missing "target" field' }));
                }
              } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
              }
            });
            return;
          }
          if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ target: currentTarget, configured: targetConfigured }));
            return;
          }
        }
        next();
      });

      // ── Prefixed proxy: /___preview___/* (document loads) ─────────────
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(PROXY_PREFIX)) {
          return next();
        }

        const targetPath = req.url.slice(PROXY_PREFIX.length) || '/';

        try {
          const base = currentTarget.replace(/\/$/, '');
          const targetUrl = new URL(targetPath, base);
          // Inject SW-disable script into HTML document responses
          proxyRequest(req, res, targetUrl, true);
        } catch (err) {
          console.error('[preview-proxy] Invalid URL:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Preview proxy: Invalid target URL');
        }
      });

      // ── Transparent proxy: framework asset paths ──────────────────────
      // Only active when a target has been configured via POST /___preview-config___/
      server.middlewares.use((req, res, next) => {
        if (!targetConfigured || !req.url) {
          return next();
        }

        if (!isFrameworkAssetPath(req.url)) {
          return next();
        }

        try {
          const base = currentTarget.replace(/\/$/, '');
          const targetUrl = new URL(req.url, base);
          proxyRequest(req, res, targetUrl);
        } catch (err) {
          console.error('[preview-proxy] Invalid URL for framework asset:', err);
          return next();
        }
      });

      // ── WebSocket upgrade ─────────────────────────────────────────────
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url) return;

        let targetPath: string | null = null;

        // Prefixed WebSocket: /___preview___/...
        if (req.url.startsWith(PROXY_PREFIX)) {
          targetPath = req.url.slice(PROXY_PREFIX.length) || '/';
        }
        // Transparent WebSocket: framework paths (e.g. /_next/webpack-hmr)
        else if (targetConfigured && isFrameworkAssetPath(req.url)) {
          targetPath = req.url;
        }

        if (!targetPath) return;

        const base = currentTarget.replace(/\/$/, '');
        try {
          const targetUrl = new URL(targetPath, base);
          proxyWebSocket(req, socket as import('node:net').Socket, head, targetUrl);
        } catch {
          socket.destroy();
        }
      });
    },
  };
}
