/**
 * Live Preview Configuration Modal
 *
 * First-time setup wizard that appears when "Open as Page" is clicked
 * for a repo that hasn't been configured yet. Detects framework, lets
 * user configure the preview URL, and persists it per-repo.
 */

import { useState, useCallback, useRef } from 'react';
import {
  X, Globe, Wifi, WifiOff, ChevronDown, ChevronRight,
  Settings2, Zap, ExternalLink, AlertTriangle, Copy, Check, Code,
} from 'lucide-react';
import { usePreviewConfig, type PreviewConfig } from '../hooks/usePreviewConfig';
import { getFrameworkSnippet } from '../lib/iframe-snippets';

interface LivePreviewConfigProps {
  onClose: () => void;
  onConfigured: (config: PreviewConfig) => void;
}

type HostMode = 'local' | 'deployed';

export const LivePreviewConfig = ({ onClose, onConfigured }: LivePreviewConfigProps) => {
  const { detectedFramework, suggestedPort, projectName } = usePreviewConfig();

  const [hostMode, setHostMode] = useState<HostMode>('local');
  const [protocol, setProtocol] = useState('http');
  const [port, setPort] = useState(String(suggestedPort));
  const [deployedUrl, setDeployedUrl] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [showHelp, setShowHelp] = useState(false);
  const [showIframeSetup, setShowIframeSetup] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get framework-specific iframe snippet
  const frameworkSnippet = getFrameworkSnippet(detectedFramework.name);

  const handleCopySnippet = useCallback(() => {
    if (!frameworkSnippet) return;
    navigator.clipboard.writeText(frameworkSnippet.code);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  }, [frameworkSnippet]);

  // Build the full URL from current config
  const buildUrl = useCallback(() => {
    if (hostMode === 'deployed') {
      return deployedUrl.replace(/\/$/, '');
    }
    return `${protocol}://localhost:${port}`;
  }, [hostMode, protocol, port, deployedUrl]);

  // Test connection — use Image ping (reliable for cross-origin)
  const handleTest = useCallback(() => {
    const url = buildUrl();
    if (!url) return;
    setTestStatus('testing');
    const img = new Image();
    let settled = false;
    const settle = (status: 'success' | 'error') => {
      if (settled) return;
      settled = true;
      setTestStatus(status);
    };
    // Both onload and onerror mean the server responded
    // (HTML pages trigger onerror since they aren't images, but the server is reachable)
    img.onload = () => settle('success');
    img.onerror = () => settle('success');
    // Timeout — if truly unreachable, neither callback fires within 5s
    setTimeout(() => settle('error'), 5000);
    img.src = `${url}/favicon.ico?t=${Date.now()}`;
  }, [buildUrl]);

  // Save config
  const handleSave = useCallback(() => {
    const baseUrl = buildUrl();
    if (!baseUrl) return;
    const config: PreviewConfig = {
      baseUrl,
      framework: detectedFramework.name,
      configuredAt: new Date().toISOString(),
    };
    onConfigured(config);
  }, [buildUrl, detectedFramework, onConfigured]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) onClose();
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg bg-[#0d1424] border border-white/10 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
              <Settings2 className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Configure Live Preview</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Tell MaestroNexus where your app is running
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Auto-detected framework */}
          <div className="flex items-center gap-3 px-4 py-3 bg-violet-500/8 border border-violet-500/15 rounded-xl">
            <Zap className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-slate-400">Detected: </span>
              <span className="text-sm font-semibold text-violet-300">{detectedFramework.name}</span>
              {detectedFramework.name !== 'Unknown' && (
                <span className="text-xs text-slate-500 ml-2">
                  (default port: {detectedFramework.defaultPort})
                </span>
              )}
            </div>
            {projectName && (
              <span className="text-[10px] text-slate-600 font-mono truncate max-w-[120px]">
                {projectName}
              </span>
            )}
          </div>

          {/* Host mode toggle */}
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2.5 block">
              Where is your app running?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setHostMode('local')}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                  hostMode === 'local'
                    ? 'border-cyan-500/50 bg-cyan-500/8 text-white'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                }`}
              >
                <Globe className="w-4 h-4 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium">Running locally</div>
                  <div className="text-[11px] text-slate-500">localhost:{suggestedPort}</div>
                </div>
              </button>
              <button
                onClick={() => setHostMode('deployed')}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                  hostMode === 'deployed'
                    ? 'border-cyan-500/50 bg-cyan-500/8 text-white'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                }`}
              >
                <ExternalLink className="w-4 h-4 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium">Deployed</div>
                  <div className="text-[11px] text-slate-500">Custom URL</div>
                </div>
              </button>
            </div>
          </div>

          {/* Config form */}
          {hostMode === 'local' ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="w-28">
                  <label className="text-[11px] text-slate-500 mb-1 block">Protocol</label>
                  <select
                    value={protocol}
                    onChange={(e) => setProtocol(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white outline-none focus:border-cyan-500/40 transition-all appearance-none cursor-pointer"
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[11px] text-slate-500 mb-1 block">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder={String(suggestedPort)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white font-mono placeholder:text-slate-600 outline-none focus:border-cyan-500/40 transition-all"
                  />
                </div>
              </div>
              <div className="px-3 py-2 bg-white/[0.02] border border-white/5 rounded-lg">
                <span className="text-xs text-slate-500">Preview URL: </span>
                <span className="text-xs text-cyan-400 font-mono">{protocol}://localhost:{port}</span>
              </div>
              {port === String(window.location.port || (window.location.protocol === 'https:' ? '443' : '80')) && (
                <div className="px-3 py-2 bg-amber-500/8 border border-amber-500/15 rounded-lg text-[11px] text-amber-400">
                  Note: Port {port} is where MaestroNexus is running. Your app is likely on a different port.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">App URL</label>
                <input
                  type="url"
                  value={deployedUrl}
                  onChange={(e) => setDeployedUrl(e.target.value)}
                  placeholder="https://myapp.vercel.app"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white font-mono placeholder:text-slate-600 outline-none focus:border-cyan-500/40 transition-all"
                />
              </div>
            </div>
          )}

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all disabled:opacity-50"
            >
              {testStatus === 'testing' ? (
                <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : testStatus === 'success' ? (
                <Wifi className="w-3.5 h-3.5 text-green-400" />
              ) : testStatus === 'error' ? (
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              Test Connection
            </button>
            {testStatus === 'success' && (
              <span className="text-xs text-green-400">Server reachable</span>
            )}
            {testStatus === 'error' && (
              <span className="text-xs text-red-400">Could not reach server — is it running?</span>
            )}
          </div>

          {/* Enable iframe preview — framework-specific setup */}
          {frameworkSnippet && (
            <div className="border border-cyan-500/15 rounded-xl overflow-hidden bg-cyan-500/[0.03]">
              <button
                onClick={() => setShowIframeSetup(!showIframeSetup)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                {showIframeSetup ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <Code className="w-3.5 h-3.5" />
                Enable iframe preview
              </button>
              {showIframeSetup && (
                <div className="px-4 pb-3 border-t border-cyan-500/10 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] text-slate-400">
                      Add to <span className="text-cyan-400 font-mono">{frameworkSnippet.fileName}</span>:
                    </p>
                    <button
                      onClick={handleCopySnippet}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-md transition-all"
                    >
                      {copiedSnippet ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      {copiedSnippet ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="text-[11px] text-slate-300 font-mono bg-black/30 rounded-lg p-3 overflow-x-auto whitespace-pre">{frameworkSnippet.code}</pre>
                  <p className="text-[10px] text-slate-600 mt-2">
                    Add this to your app config and restart your dev server.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Help section */}
          <div className="border border-white/5 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showHelp ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <AlertTriangle className="w-3.5 h-3.5" />
              Can't see your app? Common fixes
            </button>
            {showHelp && (
              <div className="px-4 pb-3 space-y-2 text-[11px] text-slate-500 border-t border-white/5 pt-3">
                <p>If the iframe preview shows a blank page or error:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Make sure your dev server is running (<code className="text-cyan-400/70">npm run dev</code>)</li>
                  <li>Check that the port number matches your dev server</li>
                  <li>If your app sets <code className="text-cyan-400/70">X-Frame-Options</code> or CSP headers, they may block iframe embedding</li>
                  <li>For auth-protected apps, you may need to log in via the browser tab first</li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-[#0a0f1a]/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-all shadow-lg shadow-cyan-500/20"
          >
            Save & Preview
          </button>
        </div>
      </div>
    </div>
  );
};
