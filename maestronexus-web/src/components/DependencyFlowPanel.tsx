/**
 * Dependency Flow Panel
 *
 * Shows upstream (dependencies) and downstream (dependents) for the
 * currently selected node on the force graph, rendered as a Mermaid
 * flowchart with zoom/pan. Clicking a node in the diagram selects it on the graph.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Network, Loader2, RefreshCw, Minus, Plus, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';
import mermaid from 'mermaid';
import { useAppState } from '../hooks/useAppState';
import {
  generateDependencyFlowDiagram,
  computeMaxDepth,
  type DepFlowNode,
  type DepFlowEdge,
} from '../lib/mermaid-generator';

// Relationship types we care about for dependency flow
const DEP_EDGE_TYPES = ['CALLS', 'IMPORTS', 'USES', 'INHERITS', 'IMPLEMENTS', 'EXTENDS'];

export function DependencyFlowPanel() {
  const {
    graph,
    selectedNode,
    setSelectedNode,
    setHighlightedNodeIds,
    triggerNodeAnimation,
  } = useAppState();

  const [mermaidCode, setMermaidCode] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [isRendering, setIsRendering] = useState(false);
  const [depth, setDepth] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Zoom/pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Build the node/edge data from the graph for the selected node
  const flowData = useMemo(() => {
    if (!graph || !selectedNode) return null;

    const relevantEdges = graph.relationships.filter(r =>
      DEP_EDGE_TYPES.includes(r.type)
    );

    const depEdges: DepFlowEdge[] = relevantEdges.map(r => ({
      sourceId: r.sourceId,
      targetId: r.targetId,
      type: r.type,
    }));

    const depNodes: DepFlowNode[] = graph.nodes.map(n => ({
      id: n.id,
      name: n.properties.name,
      label: n.label,
      filePath: n.properties.filePath,
    }));

    return { nodes: depNodes, edges: depEdges };
  }, [graph, selectedNode]);

  // Compute the max useful depth for this node
  const maxDepth = useMemo(() => {
    if (!selectedNode || !flowData) return 1;
    return computeMaxDepth(selectedNode.id, flowData.edges, 6);
  }, [selectedNode, flowData]);

  // Clamp depth when node changes and max depth is lower
  useEffect(() => {
    if (maxDepth > 0 && depth > maxDepth) {
      setDepth(maxDepth);
    }
  }, [maxDepth]);

  // Reset zoom/pan when selected node changes
  useEffect(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, [selectedNode]);

  // Generate mermaid code when selected node or depth changes
  useEffect(() => {
    if (!selectedNode || !flowData) {
      setMermaidCode(null);
      setSvgHtml('');
      return;
    }

    const code = generateDependencyFlowDiagram(
      selectedNode.id,
      flowData.nodes,
      flowData.edges,
      depth,
    );
    setMermaidCode(code);
  }, [selectedNode, flowData, depth]);

  // Render mermaid SVG when code changes
  useEffect(() => {
    if (!mermaidCode) {
      setSvgHtml('');
      return;
    }

    let cancelled = false;
    setIsRendering(true);
    setError(null);

    const render = async () => {
      try {
        const id = `depflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, mermaidCode.trim());
        if (!cancelled) {
          setSvgHtml(svg);
          setError(null);
        }
      } catch (err) {
        console.debug('[DepFlow] Mermaid render error:', err);
        if (!cancelled) {
          setError('Failed to render dependency diagram');
        }
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    };

    const timeout = setTimeout(render, 100);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [mermaidCode]);

  // Wheel zoom on the diagram area
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(prev => Math.min(Math.max(0.15, prev + e.deltaY * -0.001 * prev), 8));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [svgHtml]);

  // Pan handlers
  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't start panning if clicking a node
    if ((e.target as HTMLElement).closest('.node')) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  }, [panOffset]);

  const handlePanMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  }, [isPanning, panStart]);

  const handlePanMouseUp = useCallback(() => setIsPanning(false), []);

  // Fit diagram to available space
  const fitToContainer = useCallback(() => {
    if (!scrollRef.current || !containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    const containerW = scrollRef.current.clientWidth;
    const containerH = scrollRef.current.clientHeight;
    const svgW = svg.getBoundingClientRect().width / zoom; // get unscaled size
    const svgH = svg.getBoundingClientRect().height / zoom;
    if (svgW === 0 || svgH === 0) return;
    const padding = 32; // 16px padding on each side
    const scaleX = (containerW - padding) / svgW;
    const scaleY = (containerH - padding) / svgH;
    const fitZoom = Math.min(scaleX, scaleY, 2); // don't upscale beyond 2x
    const fitX = (containerW - svgW * fitZoom) / 2;
    const fitY = (containerH - svgH * fitZoom) / 2;
    setZoom(fitZoom);
    setPanOffset({ x: fitX, y: fitY });
  }, [zoom]);

  // Auto-fit when SVG first renders
  useEffect(() => {
    if (!svgHtml) return;
    // Give DOM a tick to render
    const t = setTimeout(fitToContainer, 50);
    return () => clearTimeout(t);
  }, [svgHtml]);

  // Zoom controls
  const handleZoomIn = useCallback(() => setZoom(prev => Math.min(prev * 1.3, 8)), []);
  const handleZoomOut = useCallback(() => setZoom(prev => Math.max(prev * 0.7, 0.15)), []);
  const handleResetView = useCallback(() => {
    fitToContainer();
  }, [fitToContainer]);

  // Handle clicks on mermaid nodes — select the corresponding graph node
  const handleSvgClick = useCallback((e: React.MouseEvent) => {
    if (!graph) return;

    // Mermaid click callbacks put the node ID in the data
    const target = (e.target as HTMLElement).closest?.('[data-id]');
    if (!target) {
      const nodeEl = (e.target as HTMLElement).closest?.('.node');
      if (!nodeEl) return;
      const dataId = nodeEl.querySelector('[data-id]')?.getAttribute('data-id');
      if (dataId) {
        selectNodeById(dataId);
        return;
      }
      return;
    }

    const clickedId = target.getAttribute('data-id');
    if (clickedId) {
      selectNodeById(clickedId);
    }
  }, [graph]);

  // Also intercept mermaid callback clicks via the window callback
  useEffect(() => {
    (window as any).callback = (nodeId: string) => {
      selectNodeById(nodeId);
    };
    return () => {
      delete (window as any).callback;
    };
  }, [graph, selectedNode]);

  const selectNodeById = useCallback((nodeId: string) => {
    if (!graph) return;
    const node = graph.nodes.find(n => n.id === nodeId);
    if (node) {
      setSelectedNode(node);
      setHighlightedNodeIds(new Set([nodeId]));
      triggerNodeAnimation([nodeId], 'pulse');
    }
  }, [graph, setSelectedNode, setHighlightedNodeIds, triggerNodeAnimation]);

  const handleRefresh = useCallback(() => {
    if (!selectedNode || !flowData) return;
    const code = generateDependencyFlowDiagram(
      selectedNode.id,
      flowData.nodes,
      flowData.edges,
      depth,
    );
    setMermaidCode(code);
  }, [selectedNode, flowData, depth]);

  // No graph loaded
  if (!graph) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-text-muted text-center">Load a project to view dependency flows</p>
      </div>
    );
  }

  // No node selected
  if (!selectedNode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
        <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
          <Network className="w-5 h-5 text-accent" />
        </div>
        <p className="text-xs text-text-secondary font-medium">Select a node</p>
        <p className="text-[11px] text-text-muted text-center leading-relaxed">
          Click on a node in the graph to see its upstream and downstream dependencies
        </p>
      </div>
    );
  }

  const effectiveMax = Math.max(maxDepth, 1);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <Network className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            <span className="text-xs font-medium text-text-primary truncate">
              {selectedNode.properties.name}
            </span>
            <span className="text-[10px] text-text-muted flex-shrink-0">
              ({selectedNode.label})
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRendering}
            className="p-1 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors disabled:opacity-40"
            title="Refresh diagram"
          >
            {isRendering
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />
            }
          </button>
        </div>

        {/* Depth control */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted">Depth:</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDepth(d => Math.max(1, d - 1))}
              disabled={depth <= 1}
              className="p-0.5 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors disabled:opacity-30"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="text-[11px] text-text-primary font-medium w-4 text-center">{depth}</span>
            <button
              onClick={() => setDepth(d => Math.min(effectiveMax, d + 1))}
              disabled={depth >= effectiveMax}
              className="p-0.5 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors disabled:opacity-30"
            >
              <Plus className="w-3 h-3" />
            </button>
            <span className="text-[9px] text-text-muted ml-0.5">/ {effectiveMax}</span>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="flex items-center gap-1 text-[9px] text-text-muted">
              <span className="w-2 h-2 rounded-full border-2 border-cyan-400" />center
            </span>
            <span className="flex items-center gap-1 text-[9px] text-text-muted">
              <span className="w-2 h-2 rounded-full border-2 border-emerald-400" />depends on
            </span>
            <span className="flex items-center gap-1 text-[9px] text-text-muted">
              <span className="w-2 h-2 rounded-full border-2 border-pink-400" />used by
            </span>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-[11px] text-red-400">{error}</p>
        </div>
      )}

      {/* Diagram with zoom/pan */}
      <div
        ref={scrollRef}
        className="flex-1 relative overflow-hidden"
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
        onMouseDown={handlePanMouseDown}
        onMouseMove={handlePanMouseMove}
        onMouseUp={handlePanMouseUp}
        onMouseLeave={handlePanMouseUp}
      >
        {isRendering && !svgHtml ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
            <p className="text-xs text-text-muted">Generating dependency flow...</p>
          </div>
        ) : svgHtml ? (
          <div
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            <div
              ref={containerRef}
              className="p-4 [&_.node]:cursor-pointer [&_.node:hover]:opacity-80"
              onClick={handleSvgClick}
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <p className="text-xs text-text-muted">No dependencies found for this node</p>
          </div>
        )}

        {/* Zoom controls */}
        {svgHtml && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-deep/90 backdrop-blur-sm border border-border-subtle rounded-xl p-1 shadow-xl z-10">
            <button onClick={handleZoomOut} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-all" title="Zoom out">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 text-[10px] text-text-secondary font-mono min-w-[2.5rem] text-center select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={handleZoomIn} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-all" title="Zoom in">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-border-subtle" />
            <button onClick={handleResetView} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-all" title="Reset view">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
