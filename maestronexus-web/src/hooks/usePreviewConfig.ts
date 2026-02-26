/**
 * Live Preview Configuration Hook
 *
 * Detects the framework from the loaded graph, suggests a default port,
 * and persists preview URL config per-repo in localStorage.
 *
 * Provides proxy-aware URL helpers so the iframe loads through the
 * Vite dev server proxy (same-origin), solving COEP/cookie/auth issues.
 */

import { useMemo, useCallback, useState, useEffect } from 'react';
import { useAppState } from './useAppState';

// ── Proxy constants (must match preview-proxy-plugin.ts) ──────────────
const PROXY_PREFIX = '/___preview___';
const CONFIG_ENDPOINT = '/___preview-config___';

// ── Types ────────────────────────────────────────────────────────────────

export interface PreviewConfig {
  baseUrl: string;
  framework: string;
  configuredAt: string;
}

interface FrameworkInfo {
  name: string;
  defaultPort: number;
}

// ── Framework detection from graph file nodes ────────────────────────────

const FRAMEWORK_SIGNATURES: Array<{ filePatterns: RegExp[]; info: FrameworkInfo }> = [
  { filePatterns: [/next\.config\.\w+$/i, /\/app\/.*\/page\.\w+$/], info: { name: 'Next.js', defaultPort: 3000 } },
  { filePatterns: [/remix\.config\.\w+$/i], info: { name: 'Remix', defaultPort: 3000 } },
  { filePatterns: [/gatsby-config\.\w+$/i], info: { name: 'Gatsby', defaultPort: 8000 } },
  { filePatterns: [/angular\.json$/i], info: { name: 'Angular', defaultPort: 4200 } },
  { filePatterns: [/vite\.config\.\w+$/i], info: { name: 'Vite', defaultPort: 5173 } },
  { filePatterns: [/svelte\.config\.\w+$/i], info: { name: 'SvelteKit', defaultPort: 5173 } },
  { filePatterns: [/nuxt\.config\.\w+$/i], info: { name: 'Nuxt', defaultPort: 3000 } },
  { filePatterns: [/manage\.py$/i, /settings\.py$/i], info: { name: 'Django', defaultPort: 8000 } },
  { filePatterns: [/app\.py$/i, /wsgi\.py$/i], info: { name: 'Flask', defaultPort: 5000 } },
  { filePatterns: [/Gemfile$/i, /config\/routes\.rb$/], info: { name: 'Rails', defaultPort: 3000 } },
  { filePatterns: [/artisan$/i, /composer\.json$/i], info: { name: 'Laravel', defaultPort: 8000 } },
  { filePatterns: [/pom\.xml$/i, /build\.gradle$/i], info: { name: 'Spring Boot', defaultPort: 8080 } },
  // Generic Express / Node catch-all — least specific, goes last
  { filePatterns: [/server\.\w+$/i, /express/i], info: { name: 'Express', defaultPort: 3000 } },
];

function detectFramework(filePaths: string[]): FrameworkInfo {
  for (const sig of FRAMEWORK_SIGNATURES) {
    for (const pattern of sig.filePatterns) {
      if (filePaths.some(fp => pattern.test(fp))) {
        return sig.info;
      }
    }
  }
  return { name: 'Unknown', defaultPort: 3000 };
}

// ── localStorage helpers ─────────────────────────────────────────────────

function storageKey(repoName: string): string {
  return `maestronexus:preview:${repoName}`;
}

function loadConfig(repoName: string): PreviewConfig | null {
  if (!repoName) return null;
  try {
    const raw = localStorage.getItem(storageKey(repoName));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveConfig(repoName: string, config: PreviewConfig): void {
  if (!repoName) return;
  localStorage.setItem(storageKey(repoName), JSON.stringify(config));
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function usePreviewConfig() {
  const { projectName, graph } = useAppState();

  // Detect framework from file nodes in the graph
  const detectedFramework = useMemo<FrameworkInfo>(() => {
    if (!graph) return { name: 'Unknown', defaultPort: 3000 };
    const filePaths = graph.nodes
      .filter(n => n.label === 'File' || n.label === 'Folder')
      .map(n => n.properties.filePath || n.properties.name || '');
    return detectFramework(filePaths);
  }, [graph]);

  // Use useState so config updates trigger re-renders
  const [config, setConfigState] = useState<PreviewConfig | null>(() => loadConfig(projectName));

  // Re-load config when project changes
  useEffect(() => {
    setConfigState(loadConfig(projectName));
  }, [projectName]);

  const isConfigured = !!config;

  const setConfig = useCallback((cfg: PreviewConfig) => {
    saveConfig(projectName, cfg);
    setConfigState(cfg); // Update state immediately so isConfigured flips

    // Notify the Vite proxy plugin of the new target
    fetch(CONFIG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: cfg.baseUrl }),
    }).catch(err => {
      console.warn('[usePreviewConfig] Failed to update proxy target:', err);
    });
  }, [projectName]);

  // On mount, sync existing config to the proxy plugin
  useEffect(() => {
    if (config?.baseUrl) {
      fetch(CONFIG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: config.baseUrl }),
      }).catch(() => { /* dev server may not be running */ });
    }
  }, [config?.baseUrl]);

  const suggestedPort = detectedFramework.defaultPort;

  // Check if a URL is a local dev server (should be proxied)
  const isLocalTarget = useCallback((url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '0.0.0.0';
    } catch {
      return false;
    }
  }, []);

  // Convert a path to the proxied URL (same-origin, goes through Vite proxy)
  const getProxiedUrl = useCallback((path: string): string => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${PROXY_PREFIX}${cleanPath}`;
  }, []);

  // Check if the current config target should use the proxy
  const shouldProxy = useMemo(() => {
    if (!config?.baseUrl) return true; // Default localhost should be proxied
    return isLocalTarget(config.baseUrl);
  }, [config?.baseUrl, isLocalTarget]);

  return {
    config,
    setConfig,
    isConfigured,
    detectedFramework,
    suggestedPort,
    projectName,
    getProxiedUrl,
    shouldProxy,
    isLocalTarget,
    PROXY_PREFIX,
  };
}
