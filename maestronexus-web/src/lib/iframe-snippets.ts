/**
 * Framework-specific iframe embedding config snippets.
 *
 * Used by ArchitecturePanel's inline config view and split-view help section
 * to show users exactly what config to add for their framework.
 */

export interface FrameworkSnippet {
  fileName: string;
  code: string;
}

const SNIPPETS: Record<string, FrameworkSnippet> = {
  'Next.js': {
    fileName: 'next.config.js',
    code: `async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self' http://localhost:*" },
    ],
  }];
},`,
  },
  Vite: {
    fileName: 'vite.config.ts',
    code: `server: {
  headers: {
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self' http://localhost:*",
  },
},`,
  },
  SvelteKit: {
    fileName: 'vite.config.ts',
    code: `server: {
  headers: {
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self' http://localhost:*",
  },
},`,
  },
  Nuxt: {
    fileName: 'nuxt.config.ts',
    code: `routeRules: {
  '/**': {
    headers: {
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self' http://localhost:*",
    },
  },
},`,
  },
  Django: {
    fileName: 'settings.py',
    code: `X_FRAME_OPTIONS = 'SAMEORIGIN'
CSP_FRAME_ANCESTORS = ("'self'", "http://localhost:*")`,
  },
  Flask: {
    fileName: 'app.py',
    code: `from flask import Flask
app.config['X_FRAME_OPTIONS'] = 'SAMEORIGIN'`,
  },
  Express: {
    fileName: 'server.js',
    code: `app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});`,
  },
  Rails: {
    fileName: 'config/application.rb',
    code: `config.action_dispatch.default_headers = {
  'X-Frame-Options' => 'SAMEORIGIN'
}`,
  },
  'Spring Boot': {
    fileName: 'SecurityConfig.java',
    code: `http.headers(h -> h.frameOptions(f -> f.sameOrigin()));`,
  },
  Angular: {
    fileName: 'server config',
    code: `// In your dev server proxy config or middleware:
res.setHeader('X-Frame-Options', 'SAMEORIGIN');`,
  },
};

/**
 * Get the iframe config snippet for a detected framework.
 * Returns null if no specific snippet is available.
 */
export function getFrameworkSnippet(frameworkName: string): FrameworkSnippet | null {
  return SNIPPETS[frameworkName] || null;
}
