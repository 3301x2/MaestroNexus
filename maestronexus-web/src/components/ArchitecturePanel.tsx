/**
 * Architecture Panel — Full-Canvas Overlay
 *
 * Four canvas states:
 *  1. Columns view  — cluster cards grouped by layer
 *  2. Diagram view  — inline mermaid diagram with zoom/pan (no modal)
 *  3. Config view   — inline first-time preview setup (no modal)
 *  4. Split view    — mermaid diagram left + iframe preview right
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  LayoutDashboard, X, Layers, Loader2,
  ZoomIn, ZoomOut, Maximize2, ArrowRight, ArrowLeft, Search,
  RefreshCw, Settings2, ChevronDown, ChevronRight, AlertTriangle,
  Copy, Check, Globe, ExternalLink, Wifi, WifiOff, Zap,
  Focus, GitBranch,
} from 'lucide-react';
import { useAppState } from '../hooks/useAppState';
import { usePreviewConfig, type PreviewConfig } from '../hooks/usePreviewConfig';
import type { ProcessStep } from '../lib/mermaid-generator';
import {
  generateClusterDetailMermaid,
  type ArchitectureCluster,
} from '../lib/architecture-generator';

// ── Column color themes (use node-type colors from the design system) ──────
const COLUMN_THEMES = [
  { header: 'var(--color-node-method)',    headerBg: 'rgba(20,184,166,0.10)',  cardBorder: 'rgba(20,184,166,0.25)',  cardBg: 'rgba(20,184,166,0.05)' },
  { header: 'var(--color-accent)',         headerBg: 'rgba(124,58,237,0.10)',  cardBorder: 'rgba(124,58,237,0.25)',  cardBg: 'rgba(124,58,237,0.05)' },
  { header: 'var(--color-node-function)',  headerBg: 'rgba(16,185,129,0.10)',  cardBorder: 'rgba(16,185,129,0.25)',  cardBg: 'rgba(16,185,129,0.05)' },
  { header: 'var(--color-node-class)',     headerBg: 'rgba(245,158,11,0.10)',  cardBorder: 'rgba(245,158,11,0.25)',  cardBg: 'rgba(245,158,11,0.05)' },
  { header: 'var(--color-node-interface)', headerBg: 'rgba(236,72,153,0.10)',  cardBorder: 'rgba(236,72,153,0.25)',  cardBg: 'rgba(236,72,153,0.05)' },
  { header: 'var(--color-node-file)',      headerBg: 'rgba(59,130,246,0.10)',  cardBorder: 'rgba(59,130,246,0.25)',  cardBg: 'rgba(59,130,246,0.05)' },
  { header: 'var(--color-node-folder)',    headerBg: 'rgba(99,102,241,0.10)',  cardBorder: 'rgba(99,102,241,0.25)',  cardBg: 'rgba(99,102,241,0.05)' },
  { header: 'var(--color-node-method)',    headerBg: 'rgba(20,184,166,0.10)',  cardBorder: 'rgba(20,184,166,0.25)',  cardBg: 'rgba(20,184,166,0.05)' },
];

interface ClusterRelData { from: string; to: string; relType: string; weight: number }
interface ClusterInfo { id: string; label: string; symbolCount: number; cohesion: number; keywords: string[] }

const DEFAULT_PREVIEW_URL = 'http://localhost:3000';

type CanvasView = 'columns' | 'diagram' | 'config' | 'split';

// ── Classify clusters into architectural layers ────────────────────────────
function classifyIntoLayers(
  clusters: ClusterInfo[],
  relationships: ClusterRelData[],
): { name: string; clusters: ClusterInfo[] }[] {
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const rel of relationships) {
    outgoing.set(rel.from, (outgoing.get(rel.from) || 0) + rel.weight);
    incoming.set(rel.to, (incoming.get(rel.to) || 0) + rel.weight);
  }
  const scored = clusters.map(c => {
    const out = outgoing.get(c.label) || 0;
    const inc = incoming.get(c.label) || 0;
    return { cluster: c, ratio: (out + 1) / (inc + 1) };
  });
  scored.sort((a, b) => b.ratio - a.ratio);
  const total = scored.length;
  if (total <= 3) return [{ name: 'Architecture', clusters: scored.map(s => s.cluster) }];
  const layerSize = Math.max(2, Math.ceil(total / Math.min(total, 5)));
  const layers: { name: string; clusters: ClusterInfo[] }[] = [];
  const layerNames = ['Core / Foundation', 'Services', 'Logic', 'Integration', 'Interface'];
  for (let i = 0; i < total; i += layerSize) {
    const slice = scored.slice(i, i + layerSize);
    const idx = Math.floor(i / layerSize);
    layers.push({ name: layerNames[idx] || `Layer ${idx + 1}`, clusters: slice.map(s => s.cluster) });
  }
  return layers;
}

export const ArchitecturePanel = () => {
  const { graph, runQuery, setHighlightedNodeIds, highlightedNodeIds, setArchitectureOpen } = useAppState();
  const previewConfig = usePreviewConfig();

  const [searchQuery, setSearchQuery] = useState('');
  const [loadingCluster, setLoadingCluster] = useState<string | null>(null);
  const [focusedClusterId, setFocusedClusterId] = useState<string | null>(null);
  const [clusterMembersCache, setClusterMembersCache] = useState<Map<string, string[]>>(new Map());
  const [relationships, setRelationships] = useState<ClusterRelData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Canvas view state
  const [canvasView, setCanvasView] = useState<CanvasView>('columns');
  const [expandedCluster, setExpandedCluster] = useState<{ label: string; steps: ProcessStep[]; mermaidCode: string; derivedRoute: string } | null>(null);
  const [pendingExpand, setPendingExpand] = useState<{ label: string; steps: ProcessStep[]; mermaidCode: string; derivedRoute: string } | null>(null);

  // Inline diagram view state (replaces ProcessFlowModal)
  const [diagramData, setDiagramData] = useState<{ id: string; label: string; steps: ProcessStep[]; mermaidCode: string } | null>(null);
  const [copiedMermaid, setCopiedMermaid] = useState(false);

  // Columns zoom/pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Inline diagram view refs
  const diagramViewRef = useRef<HTMLDivElement>(null);
  const diagramScrollRef = useRef<HTMLDivElement>(null);
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [diagramPan, setDiagramPan] = useState({ x: 0, y: 0 });
  const [diagramIsPanning, setDiagramIsPanning] = useState(false);
  const [diagramPanStart, setDiagramPanStart] = useState({ x: 0, y: 0 });

  // Split view state
  const splitDiagramRef = useRef<HTMLDivElement>(null);
  const splitScrollRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [splitZoom, setSplitZoom] = useState(1);
  const [splitPan, setSplitPan] = useState({ x: 0, y: 0 });
  const [splitIsPanning, setSplitIsPanning] = useState(false);
  const [splitPanStart, setSplitPanStart] = useState({ x: 0, y: 0 });
  const [urlPath, setUrlPath] = useState('/');
  const [urlInput, setUrlInput] = useState('');
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const [showIframeHelp, setShowIframeHelp] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline config state (replaces modal)
  const [cfgHostMode, setCfgHostMode] = useState<'local' | 'deployed'>('local');
  const [cfgProtocol, setCfgProtocol] = useState('http');
  const [cfgPort, setCfgPort] = useState(String(previewConfig.suggestedPort));
  const [cfgDeployedUrl, setCfgDeployedUrl] = useState('');
  const [cfgTestStatus, setCfgTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  // ── Data loading ─────────────────────────────────────────────────────
  const clusters = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter(n => n.label === 'Community')
      .map(node => ({
        id: node.id,
        label: node.properties.heuristicLabel || node.properties.name || node.id,
        symbolCount: node.properties.symbolCount || 0,
        cohesion: node.properties.cohesion || 0,
        keywords: (node.properties.keywords || []) as string[],
      }))
      .sort((a, b) => b.symbolCount - a.symbolCount);
  }, [graph]);

  useEffect(() => {
    if (clusters.length === 0) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const relQuery = `
          MATCH (s1)-[:CodeRelation {type: 'MEMBER_OF'}]->(c1:Community),
                (s2)-[:CodeRelation {type: 'MEMBER_OF'}]->(c2:Community),
                (s1)-[r:CodeRelation]->(s2)
          WHERE c1.id <> c2.id AND r.type <> 'MEMBER_OF'
          RETURN c1.heuristicLabel AS fromCluster, c2.heuristicLabel AS toCluster, r.type AS relType, count(*) AS weight
          ORDER BY weight DESC LIMIT 100
        `;
        const result = await runQuery(relQuery);
        setRelationships(result.map((row: any) => ({
          from: row.fromCluster || row[0],
          to: row.toCluster || row[1],
          relType: row.relType || row[2] || 'RELATED',
          weight: row.weight || row[3] || 1,
        })));
      } catch (err) {
        console.warn('[Architecture] Failed to load relationships:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [clusters, runQuery]);

  const layers = useMemo(() => {
    let filtered = clusters;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = clusters.filter(c => c.label.toLowerCase().includes(q) || c.keywords.some(k => k.toLowerCase().includes(q)));
    }
    return classifyIntoLayers(filtered, relationships);
  }, [clusters, relationships, searchQuery]);

  // ── Columns zoom/pan ─────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading || canvasView !== 'columns' || layers.length === 0 || !canvasRef.current || !contentRef.current) return;
    const t = setTimeout(() => {
      if (!canvasRef.current || !contentRef.current) return;
      const cw = canvasRef.current.clientWidth;
      const ch = canvasRef.current.clientHeight;
      const sw = contentRef.current.scrollWidth;
      const sh = contentRef.current.scrollHeight;
      const scaleX = (cw - 60) / sw;
      const scaleY = (ch - 60) / sh;
      const fitZoom = Math.min(scaleX, scaleY, 1.15);
      setZoom(fitZoom);
      setPan({ x: (cw - sw * fitZoom) / 2, y: (ch - sh * fitZoom) / 2 });
    }, 50);
    return () => clearTimeout(t);
  }, [isLoading, layers, canvasView]);

  useEffect(() => {
    if (canvasView !== 'columns') return;
    const handleWheel = (e: WheelEvent) => { e.preventDefault(); setZoom(prev => Math.min(Math.max(0.15, prev + e.deltaY * -0.001 * prev), 4)); };
    const el = canvasRef.current;
    if (el) { el.addEventListener('wheel', handleWheel, { passive: false }); return () => el.removeEventListener('wheel', handleWheel); }
  }, [canvasView]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-clickable]')) return;
    setIsPanning(true); setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);
  const handleMouseMove = useCallback((e: React.MouseEvent) => { if (!isPanning) return; setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y }); }, [isPanning, panStart]);
  const handleMouseUp = useCallback(() => setIsPanning(false), []);
  const handleZoomIn = useCallback(() => setZoom(prev => Math.min(prev * 1.3, 4)), []);
  const handleZoomOut = useCallback(() => setZoom(prev => Math.max(prev * 0.7, 0.15)), []);
  const handleResetView = useCallback(() => {
    if (!canvasRef.current || !contentRef.current) return;
    const cw = canvasRef.current.clientWidth; const ch = canvasRef.current.clientHeight;
    const sw = contentRef.current.scrollWidth; const sh = contentRef.current.scrollHeight;
    const scaleX = (cw - 60) / sw; const scaleY = (ch - 60) / sh;
    const fitZoom = Math.min(scaleX, scaleY, 1.15);
    setZoom(fitZoom); setPan({ x: (cw - sw * fitZoom) / 2, y: (ch - sh * fitZoom) / 2 });
  }, []);

  // ── Inline diagram view pan/zoom ────────────────────────────────────
  const handleDiagramMouseDown = useCallback((e: React.MouseEvent) => { setDiagramIsPanning(true); setDiagramPanStart({ x: e.clientX - diagramPan.x, y: e.clientY - diagramPan.y }); }, [diagramPan]);
  const handleDiagramMouseMove = useCallback((e: React.MouseEvent) => { if (!diagramIsPanning) return; setDiagramPan({ x: e.clientX - diagramPanStart.x, y: e.clientY - diagramPanStart.y }); }, [diagramIsPanning, diagramPanStart]);
  const handleDiagramMouseUp = useCallback(() => setDiagramIsPanning(false), []);

  useEffect(() => {
    if (canvasView !== 'diagram') return;
    const handleWheel = (e: WheelEvent) => { e.preventDefault(); setDiagramZoom(prev => Math.min(Math.max(0.1, prev + e.deltaY * -0.001 * prev), 10)); };
    const el = diagramScrollRef.current;
    if (el) { el.addEventListener('wheel', handleWheel, { passive: false }); return () => el.removeEventListener('wheel', handleWheel); }
  }, [canvasView]);

  // Render mermaid for inline diagram view
  useEffect(() => {
    if (canvasView !== 'diagram' || !diagramData?.mermaidCode || !diagramViewRef.current) return;
    console.log('[Architecture] Rendering mermaid for inline diagram view:', diagramData.label);
    const render = async () => {
      try {
        const { default: mermaidLib } = await import('mermaid');
        mermaidLib.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          maxTextSize: 900000,
          theme: 'base',
          themeVariables: {
            primaryColor: '#1e293b', primaryTextColor: '#f1f5f9', primaryBorderColor: '#22d3ee',
            lineColor: '#94a3b8', secondaryColor: '#1e293b', tertiaryColor: '#0f172a',
            mainBkg: '#1e293b', nodeBorder: '#22d3ee', clusterBkg: '#1e293b',
            clusterBorder: '#475569', titleColor: '#f1f5f9', edgeLabelBackground: '#0f172a',
          },
          flowchart: { curve: 'basis', padding: 50, nodeSpacing: 120, rankSpacing: 140, htmlLabels: true },
        });
        const id = `diagram-inline-${Date.now()}`;
        diagramViewRef.current!.innerHTML = '';
        const { svg } = await mermaidLib.render(id, diagramData.mermaidCode);
        diagramViewRef.current!.innerHTML = svg;
        console.log('[Architecture] Inline diagram rendered successfully');
      } catch (err) {
        console.error('[Architecture] Inline diagram render error:', err);
        if (diagramViewRef.current) diagramViewRef.current.innerHTML = '<div class="text-red-400 text-sm p-8 text-center">Failed to render diagram</div>';
      }
    };
    render();
  }, [canvasView, diagramData?.mermaidCode, diagramData?.label]);

  // ── Split view diagram pan ───────────────────────────────────────────
  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => { setSplitIsPanning(true); setSplitPanStart({ x: e.clientX - splitPan.x, y: e.clientY - splitPan.y }); }, [splitPan]);
  const handleSplitMouseMove = useCallback((e: React.MouseEvent) => { if (!splitIsPanning) return; setSplitPan({ x: e.clientX - splitPanStart.x, y: e.clientY - splitPanStart.y }); }, [splitIsPanning, splitPanStart]);
  const handleSplitMouseUp = useCallback(() => setSplitIsPanning(false), []);

  useEffect(() => {
    if (canvasView !== 'split') return;
    const handleWheel = (e: WheelEvent) => { e.preventDefault(); setSplitZoom(prev => Math.min(Math.max(0.1, prev + e.deltaY * -0.001 * prev), 10)); };
    const el = splitScrollRef.current;
    if (el) { el.addEventListener('wheel', handleWheel, { passive: false }); return () => el.removeEventListener('wheel', handleWheel); }
  }, [canvasView]);

  // ── Split view iframe ────────────────────────────────────────────────
  const previewBaseUrl = previewConfig.config?.baseUrl || DEFAULT_PREVIEW_URL;

  // The actual URL displayed in the URL bar (human-readable)
  const displayUrl = useMemo(() => {
    const base = previewBaseUrl.replace(/\/$/, '');
    const path = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
    return `${base}${path}`;
  }, [previewBaseUrl, urlPath]);

  // The URL loaded in the iframe (proxied for local targets, direct for remote)
  const iframeFullUrl = useMemo(() => {
    if (previewConfig.shouldProxy) {
      return previewConfig.getProxiedUrl(urlPath);
    }
    return displayUrl;
  }, [previewConfig.shouldProxy, previewConfig.getProxiedUrl, urlPath, displayUrl]);

  useEffect(() => { setUrlInput(displayUrl); }, [displayUrl]);

  useEffect(() => {
    if (canvasView !== 'split') return;
    console.log('[Architecture] Split view iframe loading:', iframeFullUrl, '(display:', displayUrl, ')');
    setIframeLoading(true); setIframeError(false);
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      setIframeLoading(prev => { if (prev) { console.warn('[Architecture] Iframe load timed out after 10s:', displayUrl); setIframeError(true); return false; } return prev; });
    }, 10000);
    return () => { if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current); };
  }, [iframeFullUrl, canvasView, displayUrl]);

  const handleIframeLoad = useCallback(() => {
    console.log('[Architecture] Iframe loaded successfully');
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    setIframeLoading(false); setIframeError(false);
  }, []);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsed = new URL(urlInput);
      setUrlPath(parsed.pathname + parsed.search);
    } catch {
      setUrlPath(urlInput.startsWith('/') ? urlInput : `/${urlInput}`);
    }
  }, [urlInput]);

  const handleReloadIframe = useCallback(() => {
    if (!iframeRef.current) return;
    console.log('[Architecture] Reloading iframe:', iframeFullUrl);
    setIframeLoading(true); setIframeError(false);
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => { setIframeLoading(prev => { if (prev) { setIframeError(true); return false; } return prev; }); }, 10000);
    iframeRef.current.src = iframeFullUrl;
  }, [iframeFullUrl]);

  // Render mermaid for split view
  useEffect(() => {
    if (canvasView !== 'split' || !expandedCluster?.mermaidCode || !splitDiagramRef.current) return;
    console.log('[Architecture] Rendering mermaid for split view');
    const render = async () => {
      try {
        const { default: mermaidLib } = await import('mermaid');
        const id = `split-mermaid-${Date.now()}`;
        splitDiagramRef.current!.innerHTML = '';
        const { svg } = await mermaidLib.render(id, expandedCluster.mermaidCode);
        splitDiagramRef.current!.innerHTML = svg;
        console.log('[Architecture] Mermaid rendered successfully');
      } catch (err) {
        console.error('[Architecture] Mermaid render error:', err);
        if (splitDiagramRef.current) splitDiagramRef.current.innerHTML = '<div class="text-red-400 text-sm p-8 text-center">Failed to render diagram</div>';
      }
    };
    render();
  }, [canvasView, expandedCluster?.mermaidCode]);

  // ── Inline config helpers ────────────────────────────────────────────
  const cfgBuildUrl = useCallback(() => {
    if (cfgHostMode === 'deployed') return cfgDeployedUrl.replace(/\/$/, '');
    return `${cfgProtocol}://localhost:${cfgPort}`;
  }, [cfgHostMode, cfgProtocol, cfgPort, cfgDeployedUrl]);

  const cfgHandleTest = useCallback(() => {
    const url = cfgBuildUrl();
    if (!url) return;
    setCfgTestStatus('testing');
    const img = new Image();
    let settled = false;
    const settle = (status: 'success' | 'error') => { if (settled) return; settled = true; setCfgTestStatus(status); };
    img.onload = () => settle('success');
    img.onerror = () => settle('success');
    setTimeout(() => settle('error'), 5000);
    img.src = `${url}/favicon.ico?t=${Date.now()}`;
  }, [cfgBuildUrl]);

  const cfgHandleSave = useCallback(() => {
    const baseUrl = cfgBuildUrl();
    if (!baseUrl) return;
    const config: PreviewConfig = { baseUrl, framework: previewConfig.detectedFramework.name, configuredAt: new Date().toISOString() };
    console.log('[Architecture] Saving preview config:', config);
    previewConfig.setConfig(config);
    if (pendingExpand) {
      console.log('[Architecture] Config saved, opening split view for:', pendingExpand.label);
      setUrlPath(pendingExpand.derivedRoute);
      setSplitZoom(1); setSplitPan({ x: 0, y: 0 });
      setExpandedCluster(pendingExpand);
      setPendingExpand(null);
      setCanvasView('split');
    } else {
      setCanvasView('columns');
    }
  }, [cfgBuildUrl, previewConfig, pendingExpand]);

  // ── Route derivation ─────────────────────────────────────────────────
  const deriveRoute = useCallback((steps: ProcessStep[]): string => {
    for (const step of steps) {
      if (!step.filePath) continue;
      const match = step.filePath.match(/(?:^|\/)(app\/.+?)\/page\.\w+$/);
      if (match) return '/' + match[1].replace(/^app\//, '');
    }
    return '/';
  }, []);

  // ── "Open as Page" — from diagram view, go to split or config ───────
  const handleExpand = useCallback(() => {
    if (!diagramData) return;
    const steps = diagramData.steps || [];
    const derivedRoute = deriveRoute(steps);
    const expandData = { label: diagramData.label, steps, mermaidCode: diagramData.mermaidCode, derivedRoute };

    console.log('[Architecture] Open as Page clicked. isConfigured:', previewConfig.isConfigured, 'cluster:', expandData.label);

    if (!previewConfig.isConfigured) {
      console.log('[Architecture] Not configured — showing inline config');
      setPendingExpand(expandData);
      setCfgPort(String(previewConfig.suggestedPort));
      setCanvasView('config');
    } else {
      console.log('[Architecture] Already configured — opening split view');
      setUrlPath(derivedRoute);
      setSplitZoom(1); setSplitPan({ x: 0, y: 0 });
      setExpandedCluster(expandData);
      setCanvasView('split');
    }
  }, [diagramData, previewConfig.isConfigured, previewConfig.suggestedPort, deriveRoute]);

  // ── Cluster detail loading ───────────────────────────────────────────
  const handleViewCluster = useCallback(async (clusterId: string, clusterLabel: string) => {
    setLoadingCluster(clusterId);
    try {
      const membersQuery = `
        MATCH (s)-[r:CodeRelation {type: 'MEMBER_OF'}]->(c:Community {id: '${clusterId.replace(/'/g, "''")}'})
        RETURN s.id AS id, s.name AS name, s.label AS type, s.filePath AS filePath
        ORDER BY s.label, s.name LIMIT 50
      `;
      const membersResult = await runQuery(membersQuery);
      const members = membersResult.map((row: any) => ({
        id: row.id || row[0], name: row.name || row[1] || 'Unknown',
        type: row.type || row[2] || 'CodeElement', filePath: row.filePath || row[3],
      }));
      const cluster = clusters.find(c => c.id === clusterId);
      const archCluster: ArchitectureCluster = { id: clusterId, label: clusterLabel, symbolCount: cluster?.symbolCount || members.length, cohesion: cluster?.cohesion || 0, members };
      const mermaidCode = generateClusterDetailMermaid(archCluster);
      const steps: ProcessStep[] = members.map((m, i) => ({ id: m.id, name: m.name, filePath: m.filePath, stepNumber: i, type: m.type } as ProcessStep & { type: string }));

      console.log('[Architecture] Cluster loaded, opening inline diagram view:', clusterLabel);
      setDiagramData({ id: clusterId, label: `Cluster: ${clusterLabel}`, steps, mermaidCode });
      setDiagramZoom(1);
      setDiagramPan({ x: 0, y: 0 });
      setCanvasView('diagram');
    } catch (error) {
      console.error('[Architecture] Failed to load cluster detail:', error);
    } finally {
      setLoadingCluster(null);
    }
  }, [clusters, runQuery]);

  const handleFocusInGraph = useCallback((nodeIds: string[], processId: string) => {
    if (focusedClusterId === processId) { setHighlightedNodeIds(new Set()); setFocusedClusterId(null); }
    else { setHighlightedNodeIds(new Set(nodeIds)); setFocusedClusterId(processId); setClusterMembersCache(prev => new Map(prev).set(processId, nodeIds)); }
  }, [focusedClusterId, setHighlightedNodeIds]);

  useEffect(() => { if (highlightedNodeIds.size === 0 && focusedClusterId !== null) setFocusedClusterId(null); }, [highlightedNodeIds, focusedClusterId]);

  // ── Copy mermaid code ────────────────────────────────────────────────
  const handleCopyMermaid = useCallback(() => {
    if (!diagramData?.mermaidCode) return;
    navigator.clipboard.writeText(diagramData.mermaidCode);
    setCopiedMermaid(true);
    setTimeout(() => setCopiedMermaid(false), 2000);
  }, [diagramData?.mermaidCode]);

  // ── Escape key ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (canvasView === 'split') { setCanvasView('diagram'); setExpandedCluster(null); }
        else if (canvasView === 'config') { setCanvasView('columns'); setPendingExpand(null); }
        else if (canvasView === 'diagram') { setCanvasView('columns'); setDiagramData(null); }
        else { setArchitectureOpen(false); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setArchitectureOpen, canvasView]);

  const totalSymbols = useMemo(() => clusters.reduce((s, c) => s + c.symbolCount, 0), [clusters]);

  // ── Empty state ──────────────────────────────────────────────────────
  if (clusters.length === 0) {
    return (
      <div className="absolute inset-0 z-20 bg-void flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-accent" />
            <h2 className="text-sm font-medium text-text-primary">Architecture</h2>
          </div>
          <button onClick={() => setArchitectureOpen(false)} className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 mb-4 flex items-center justify-center bg-surface rounded-2xl border border-border-subtle">
            <LayoutDashboard className="w-8 h-8 text-text-muted" />
          </div>
          <h3 className="text-lg font-medium text-text-primary mb-2">No Architecture Detected</h3>
          <p className="text-sm text-text-secondary max-w-sm">
            Architecture clusters are detected via community analysis. Load a codebase to see the high-level architecture.
          </p>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 z-20 bg-void flex flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-deep flex-shrink-0">
        <div className="flex items-center gap-4">
          {canvasView !== 'columns' ? (
            <>
              <button
                onClick={() => {
                  if (canvasView === 'split') { setCanvasView('diagram'); setExpandedCluster(null); }
                  else { setCanvasView('columns'); setDiagramData(null); setPendingExpand(null); }
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary bg-surface hover:bg-elevated border border-border-subtle rounded-lg transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div>
                <h2 className="text-[15px] font-bold text-text-primary leading-tight">
                  {canvasView === 'config' ? 'Configure Live Preview' : canvasView === 'diagram' ? (diagramData?.label || 'Cluster Detail') : (expandedCluster?.label || 'Split View')}
                </h2>
                <p className="text-[11px] text-text-muted">
                  {canvasView === 'config' ? 'Tell MaestroNexus where your app is running'
                    : canvasView === 'diagram' ? `${diagramData?.steps.length || 0} symbols — Architecture Diagram`
                    : `${expandedCluster?.steps.length || 0} symbols — Diagram + Live Preview`}
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-accent/15 rounded-lg border border-accent/20">
                <Layers className="w-4.5 h-4.5 text-accent" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-text-primary leading-tight">Project Architecture</h2>
                <p className="text-[11px] text-text-muted">
                  {clusters.length} clusters · {totalSymbols} symbols · {relationships.length} connections
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canvasView === 'diagram' && (
            <>
              {/* Zoom controls */}
              <div className="flex items-center gap-1 bg-surface border border-border-subtle rounded-lg p-1">
                <button onClick={() => setDiagramZoom(prev => Math.max(prev * 0.7, 0.1))} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-hover rounded-md transition-all">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 text-[11px] text-text-secondary font-mono min-w-[3rem] text-center">{Math.round(diagramZoom * 100)}%</span>
                <button onClick={() => setDiagramZoom(prev => Math.min(prev * 1.3, 10))} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-hover rounded-md transition-all">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
              <button onClick={() => { setDiagramZoom(1); setDiagramPan({ x: 0, y: 0 }); }} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary bg-surface hover:bg-elevated border border-border-subtle rounded-lg transition-all">
                Reset
              </button>
              <div className="w-px h-5 bg-border-subtle" />
              {/* Focus in graph */}
              {diagramData && diagramData.steps.length > 0 && (
                <button
                  onClick={() => handleFocusInGraph(diagramData.steps.map(s => s.id), diagramData.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${focusedClusterId === diagramData.id ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary bg-surface hover:bg-elevated border border-border-subtle'}`}
                >
                  <Focus className="w-3.5 h-3.5" />
                  {focusedClusterId === diagramData.id ? 'Focused' : 'Focus'}
                </button>
              )}
              {/* Copy mermaid */}
              <button onClick={handleCopyMermaid} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary bg-surface hover:bg-elevated border border-border-subtle rounded-lg transition-all">
                {copiedMermaid ? <Check className="w-3.5 h-3.5 text-node-function" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedMermaid ? 'Copied' : 'Copy Mermaid'}
              </button>
              {/* Open as Page */}
              <button onClick={handleExpand} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-dim rounded-lg transition-all shadow-sm shadow-accent/20">
                <Maximize2 className="w-3.5 h-3.5" />
                Open as Page
              </button>
            </>
          )}
          {canvasView === 'split' && (
            <>
              <span className="text-[10px] text-text-muted mr-1">Diagram:</span>
              <div className="flex items-center gap-1 bg-surface border border-border-subtle rounded-lg p-1">
                <button onClick={() => setSplitZoom(prev => Math.max(prev * 0.7, 0.1))} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-hover rounded-md transition-all">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 text-[11px] text-text-secondary font-mono min-w-[3rem] text-center">{Math.round(splitZoom * 100)}%</span>
                <button onClick={() => setSplitZoom(prev => Math.min(prev * 1.3, 10))} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-hover rounded-md transition-all">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
              <button onClick={() => { setSplitZoom(1); setSplitPan({ x: 0, y: 0 }); }} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary bg-surface hover:bg-elevated border border-border-subtle rounded-lg transition-all">
                Reset
              </button>
            </>
          )}
          {canvasView === 'columns' && (
            <>
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-surface border border-border-subtle rounded-lg focus-within:border-accent transition-all">
                <Search className="w-3.5 h-3.5 text-text-muted" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Filter..." className="bg-transparent border-none outline-none text-xs text-text-primary placeholder:text-text-muted w-28" />
              </div>
              <button onClick={() => setArchitectureOpen(false)} className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors" title="Close (Esc)">
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Canvas area ────────────────────────────────────────── */}
      {canvasView === 'diagram' && diagramData ? (
        /* ── INLINE DIAGRAM VIEW (replaces ProcessFlowModal) ── */
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={diagramScrollRef}
            className="w-full h-full overflow-hidden"
            style={{ cursor: diagramIsPanning ? 'grabbing' : 'grab' }}
            onMouseDown={handleDiagramMouseDown}
            onMouseMove={handleDiagramMouseMove}
            onMouseUp={handleDiagramMouseUp}
            onMouseLeave={handleDiagramMouseUp}
          >
            <div
              className="flex items-center justify-center min-w-full min-h-full"
              style={{ transform: `translate(${diagramPan.x}px, ${diagramPan.y}px) scale(${diagramZoom})`, transformOrigin: 'center center' }}
            >
              <div
                ref={diagramViewRef}
                className="[&_.edgePath_.path]:stroke-slate-400 [&_.edgePath_.path]:stroke-2 [&_.marker]:fill-slate-400 p-8"
              />
            </div>
          </div>
        </div>

      ) : canvasView === 'split' && expandedCluster ? (
        /* ── SPLIT VIEW ──────────────────────────────────────── */
        <div className="flex-1 flex min-h-0">
          {/* Left: Mermaid */}
          <div className="w-1/2 border-r border-border-subtle relative overflow-hidden">
            <div className="absolute top-3 left-3 z-10 px-2.5 py-1 bg-deep/90 backdrop-blur-sm border border-border-subtle rounded-lg text-[11px] text-text-secondary font-medium">
              Architecture Diagram
            </div>
            <div ref={splitScrollRef} className="w-full h-full overflow-hidden" style={{ cursor: splitIsPanning ? 'grabbing' : 'grab' }}
              onMouseDown={handleSplitMouseDown} onMouseMove={handleSplitMouseMove} onMouseUp={handleSplitMouseUp} onMouseLeave={handleSplitMouseUp}>
              <div className="flex items-center justify-center min-w-full min-h-full"
                style={{ transform: `translate(${splitPan.x}px, ${splitPan.y}px) scale(${splitZoom})`, transformOrigin: 'center center' }}>
                <div ref={splitDiagramRef} className="[&_.edgePath_.path]:stroke-slate-400 [&_.edgePath_.path]:stroke-2 [&_.marker]:fill-slate-400 p-8" />
              </div>
            </div>
          </div>

          {/* Right: Iframe */}
          <div className="w-1/2 flex flex-col bg-deep">
            {/* URL bar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-surface border-b border-border-subtle flex-shrink-0">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${iframeError ? 'bg-red-500' : iframeLoading ? 'bg-amber-500 animate-pulse' : 'bg-node-function'}`} />
              <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center gap-2">
                <input type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onFocus={(e) => e.target.select()}
                  className="flex-1 px-3 py-1.5 bg-elevated border border-border-subtle rounded-lg text-xs text-text-primary font-mono placeholder:text-text-muted focus:border-accent outline-none transition-all"
                  placeholder={`${previewBaseUrl}/...`} />
                <button type="submit" className="px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:text-text-primary bg-elevated hover:bg-hover border border-border-subtle rounded-lg transition-all">Go</button>
              </form>
              <button onClick={handleReloadIframe} className="p-1.5 text-text-muted hover:text-text-primary hover:bg-hover rounded-lg transition-all" title="Reload">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setPendingExpand(expandedCluster); setCfgPort(String(previewConfig.suggestedPort)); setCanvasView('config'); }}
                className="p-1.5 text-text-muted hover:text-text-primary hover:bg-hover rounded-lg transition-all" title="Reconfigure">
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Iframe container */}
            <div className="flex-1 relative">
              {iframeLoading && !iframeError && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-void">
                  <Loader2 className="w-8 h-8 text-accent animate-spin mb-3" />
                  <span className="text-sm text-text-secondary">Loading preview...</span>
                  <span className="text-[11px] text-text-muted mt-1 font-mono">{displayUrl}</span>
                </div>
              )}
              {iframeError && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-void px-8 overflow-y-auto">
                  <div className="w-full max-w-md text-center py-8">
                    <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center bg-red-500/10 border border-red-500/20 rounded-2xl">
                      <AlertTriangle className="w-7 h-7 text-red-400" />
                    </div>
                    <h3 className="text-base font-bold text-text-primary mb-2">Could not connect to your app</h3>
                    <p className="text-sm text-text-secondary mb-5">
                      Couldn't reach <span className="text-accent font-mono text-xs">{displayUrl}</span> within 10 seconds.
                    </p>
                    <div className="text-left bg-surface border border-border-subtle rounded-xl p-4 mb-5">
                      <p className="text-xs text-text-secondary">Preview runs through a local proxy — no app config changes needed. Just make sure:</p>
                      <ul className="list-disc pl-4 mt-2 space-y-1 text-xs text-text-muted">
                        <li>Your dev server is running (<code className="text-accent">npm run dev</code>)</li>
                        <li>The port matches your dev server</li>
                      </ul>
                    </div>
                    <button onClick={handleReloadIframe} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-dim rounded-xl transition-all shadow-lg shadow-accent/20">
                      <RefreshCw className="w-3.5 h-3.5" /> Try Again
                    </button>
                  </div>
                </div>
              )}
              <iframe ref={iframeRef} src={iframeFullUrl} onLoad={handleIframeLoad} className="w-full h-full border-0" style={{ background: 'white' }} title="Live Preview" />
            </div>

            {/* Help section */}
            <div className="border-t border-border-subtle flex-shrink-0">
              <button onClick={() => setShowIframeHelp(!showIframeHelp)} className="w-full flex items-center gap-2 px-4 py-2 text-[11px] text-text-muted hover:text-text-secondary transition-colors">
                {showIframeHelp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <AlertTriangle className="w-3 h-3" /> Can't see your app?
              </button>
              {showIframeHelp && (
                <div className="px-4 pb-3 space-y-2 text-[11px] text-text-muted border-t border-border-subtle pt-2">
                  <p>Preview runs through a local proxy — no app config changes needed.</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Make sure your dev server is running (<code className="text-accent">npm run dev</code>)</li>
                    <li>Check the port matches your dev server</li>
                    <li>Click <Settings2 className="w-3 h-3 inline-block" /> to reconfigure the preview URL</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

      ) : canvasView === 'config' ? (
        /* ── INLINE CONFIG VIEW ──────────────────────────────── */
        <div className="flex-1 flex items-center justify-center overflow-y-auto">
          <div className="w-full max-w-lg p-8">
            {/* Detected framework */}
            <div className="flex items-center gap-3 px-4 py-3 bg-accent/8 border border-accent/15 rounded-xl mb-6">
              <Zap className="w-4 h-4 text-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-text-secondary">Detected: </span>
                <span className="text-sm font-semibold text-accent">{previewConfig.detectedFramework.name}</span>
                {previewConfig.detectedFramework.name !== 'Unknown' && (
                  <span className="text-xs text-text-muted ml-2">(default port: {previewConfig.detectedFramework.defaultPort})</span>
                )}
              </div>
            </div>

            {/* Host mode toggle */}
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2.5 block">Where is your app running?</label>
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button onClick={() => setCfgHostMode('local')}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 transition-all text-left ${cfgHostMode === 'local' ? 'border-accent/50 bg-accent/8 text-text-primary' : 'border-border-subtle bg-surface text-text-secondary hover:border-border-default'}`}>
                <Globe className="w-4 h-4 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium">Running locally</div>
                  <div className="text-[11px] text-text-muted">localhost:{previewConfig.suggestedPort}</div>
                </div>
              </button>
              <button onClick={() => setCfgHostMode('deployed')}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 transition-all text-left ${cfgHostMode === 'deployed' ? 'border-accent/50 bg-accent/8 text-text-primary' : 'border-border-subtle bg-surface text-text-secondary hover:border-border-default'}`}>
                <ExternalLink className="w-4 h-4 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium">Deployed</div>
                  <div className="text-[11px] text-text-muted">Custom URL</div>
                </div>
              </button>
            </div>

            {/* Config form */}
            {cfgHostMode === 'local' ? (
              <div className="space-y-3 mb-5">
                <div className="flex gap-2">
                  <div className="w-28">
                    <label className="text-[11px] text-text-muted mb-1 block">Protocol</label>
                    <select value={cfgProtocol} onChange={(e) => setCfgProtocol(e.target.value)}
                      className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-sm text-text-primary outline-none focus:border-accent transition-all appearance-none cursor-pointer">
                      <option value="http">http</option>
                      <option value="https">https</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-text-muted mb-1 block">Port</label>
                    <input type="number" value={cfgPort} onChange={(e) => setCfgPort(e.target.value)} placeholder={String(previewConfig.suggestedPort)}
                      className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-accent transition-all" />
                  </div>
                </div>
                <div className="px-3 py-2 bg-surface border border-border-subtle rounded-lg">
                  <span className="text-xs text-text-muted">Preview URL: </span>
                  <span className="text-xs text-accent font-mono">{cfgProtocol}://localhost:{cfgPort}</span>
                </div>
              </div>
            ) : (
              <div className="mb-5">
                <label className="text-[11px] text-text-muted mb-1 block">App URL</label>
                <input type="url" value={cfgDeployedUrl} onChange={(e) => setCfgDeployedUrl(e.target.value)} placeholder="https://myapp.vercel.app"
                  className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-accent transition-all" />
              </div>
            )}

            {/* Test connection */}
            <div className="flex items-center gap-3 mb-5">
              <button onClick={cfgHandleTest} disabled={cfgTestStatus === 'testing'}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-text-secondary hover:text-text-primary bg-surface hover:bg-elevated border border-border-subtle rounded-lg transition-all disabled:opacity-50">
                {cfgTestStatus === 'testing' ? <div className="w-3.5 h-3.5 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                  : cfgTestStatus === 'success' ? <Wifi className="w-3.5 h-3.5 text-node-function" />
                  : cfgTestStatus === 'error' ? <WifiOff className="w-3.5 h-3.5 text-red-400" />
                  : <Wifi className="w-3.5 h-3.5" />}
                Test Connection
              </button>
              {cfgTestStatus === 'success' && <span className="text-xs text-node-function">Server reachable</span>}
              {cfgTestStatus === 'error' && <span className="text-xs text-red-400">Could not reach server — is it running?</span>}
            </div>

            {/* Proxy info */}
            <div className="flex items-center gap-2.5 px-4 py-3 bg-node-function/8 border border-node-function/15 rounded-xl mb-5">
              <Zap className="w-4 h-4 text-node-function flex-shrink-0" />
              <p className="text-xs text-text-secondary">
                Preview runs through a local proxy — no app config changes needed. Just make sure your dev server is running.
              </p>
            </div>

            {/* Save button */}
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => { setCanvasView('columns'); setPendingExpand(null); }}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary bg-surface hover:bg-elevated border border-border-subtle rounded-lg transition-all">
                Cancel
              </button>
              <button onClick={cfgHandleSave}
                className="px-5 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-dim rounded-lg transition-all shadow-lg shadow-accent/20">
                Save & Preview
              </button>
            </div>
          </div>
        </div>

      ) : (
        /* ── COLUMNS VIEW ────────────────────────────────────── */
        <div ref={canvasRef} className="flex-1 relative overflow-hidden" style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          {/* Dot grid */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x % (24 * zoom)}px ${pan.y % (24 * zoom)}px`,
          }} />

          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <Loader2 className="w-10 h-10 text-accent animate-spin" />
              <span className="text-sm text-text-secondary">Analyzing architecture...</span>
            </div>
          )}

          {!isLoading && (
            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0 }}>
              <div ref={contentRef} className="flex items-start gap-0" style={{ padding: 40 }}>
                {layers.map((layer, layerIdx) => {
                  const theme = COLUMN_THEMES[layerIdx % COLUMN_THEMES.length];
                  const isLast = layerIdx === layers.length - 1;
                  return (
                    <div key={layerIdx} className="flex items-start flex-shrink-0">
                      <div className="flex flex-col flex-shrink-0" style={{ width: 280 }}>
                        <div className="rounded-xl px-5 py-3 mb-4 border" style={{ background: theme.headerBg, borderColor: theme.cardBorder }}>
                          <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: theme.header }}>{layer.name}</div>
                        </div>
                        <div className="flex flex-col gap-3">
                          {layer.clusters.map((cluster) => {
                            const cohesionPct = Math.round(cluster.cohesion * 100);
                            const isCardLoading = loadingCluster === cluster.id;
                            const isFocused = focusedClusterId === cluster.id;
                            return (
                              <div key={cluster.id} data-clickable onClick={() => handleViewCluster(cluster.id, cluster.label)}
                                className={`group rounded-xl border cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg active:scale-[0.99] ${isFocused ? 'ring-2 ring-accent/50' : ''}`}
                                style={{ background: theme.cardBg, borderColor: theme.cardBorder }}>
                                <div className="px-4 pt-3.5 pb-1.5">
                                  <div className="flex items-center gap-2.5 mb-2">
                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ background: theme.header }}>
                                      {cluster.label.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <h4 className="text-[13px] font-semibold text-text-primary truncate leading-tight">{cluster.label}</h4>
                                      <p className="text-[11px] text-text-muted leading-tight">{cluster.symbolCount} symbols · {cohesionPct}% cohesion</p>
                                    </div>
                                    {isCardLoading && <Loader2 className="w-4 h-4 text-text-muted animate-spin flex-shrink-0" />}
                                  </div>
                                </div>
                                {cluster.keywords.length > 0 && (
                                  <div className="px-4 pb-3">
                                    <div className="flex flex-wrap gap-1">
                                      {cluster.keywords.slice(0, 4).map((kw, ki) => (
                                        <span key={ki} className="px-2 py-0.5 text-[10px] rounded-md bg-elevated text-text-secondary border border-border-subtle">{kw}</span>
                                      ))}
                                      {cluster.keywords.length > 4 && <span className="px-1.5 py-0.5 text-[10px] text-text-muted">+{cluster.keywords.length - 4}</span>}
                                    </div>
                                  </div>
                                )}
                                <div className="px-4 pb-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <span className="text-[10px] text-text-muted italic">Click to explore details</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {!isLast && (
                        <div className="flex items-center justify-center flex-shrink-0 self-center" style={{ width: 60, minHeight: 100 }}>
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-10 h-px bg-border-default" />
                            <ArrowRight className="w-5 h-5 text-text-muted" />
                            <div className="w-10 h-px bg-border-default" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-deep/90 backdrop-blur-sm border border-border-subtle rounded-xl p-1 shadow-xl z-10">
            <button onClick={handleZoomOut} className="p-2 text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-all" title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
            <span className="px-2 text-xs text-text-secondary font-mono min-w-[3.5rem] text-center select-none">{Math.round(zoom * 100)}%</span>
            <button onClick={handleZoomIn} className="p-2 text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-all" title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
            <div className="w-px h-5 bg-border-subtle" />
            <button onClick={handleResetView} className="p-2 text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-all" title="Fit to screen"><Maximize2 className="w-4 h-4" /></button>
          </div>
        </div>
      )}

    </div>
  );
};
