/**
 * Diagnostics Panel
 *
 * Displays code health issues detected from the knowledge graph.
 * Rendered as a tab content inside the FileTreePanel left sidebar.
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle, AlertCircle, Info, RefreshCw, Loader2,
  ChevronDown, ChevronRight, XCircle, FileWarning, RotateCcw,
  GitBranch, Box, Zap,
} from 'lucide-react';
import { useAppState } from '../hooks/useAppState';
import { useDiagnostics, type DiagnosticIssue, type Severity } from '../hooks/useDiagnostics';

// ── Severity styling ─────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<Severity, {
  icon: typeof AlertCircle;
  color: string;
  bg: string;
  border: string;
  label: string;
  dot: string;
}> = {
  critical: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    label: 'Critical',
    dot: 'bg-red-500',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    label: 'Warning',
    dot: 'bg-amber-500',
  },
  info: {
    icon: Info,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    label: 'Info',
    dot: 'bg-blue-500',
  },
};

const TYPE_ICONS: Record<DiagnosticIssue['type'], typeof AlertCircle> = {
  'dead-code': Zap,
  'disconnected-file': FileWarning,
  'circular-dependency': GitBranch,
  'oversized-module': Box,
  'unused-import': RotateCcw,
};

// ── Component ────────────────────────────────────────────────────────────

export function DiagnosticsPanel() {
  const { graph, setHighlightedNodeIds, setBlastRadiusNodeIds, triggerNodeAnimation } = useAppState();
  const { issues, summary, isAnalyzing, lastAnalyzed, error, analyze } = useDiagnostics();

  const [expandedSeverity, setExpandedSeverity] = useState<Record<Severity, boolean>>({
    critical: true,
    warning: true,
    info: false,
  });

  // Auto-analyze when graph is loaded and no analysis has been run
  useEffect(() => {
    if (graph && !lastAnalyzed && !isAnalyzing) {
      analyze();
    }
  }, [graph, lastAnalyzed, isAnalyzing, analyze]);

  const handleIssueClick = (issue: DiagnosticIssue) => {
    if (issue.nodeIds.length > 0) {
      // Use red blast-radius highlighting for dead code / critical issues
      setBlastRadiusNodeIds(new Set(issue.nodeIds));
      setHighlightedNodeIds(new Set(issue.nodeIds));
      triggerNodeAnimation(issue.nodeIds, 'glow');
    }
  };

  const toggleSeverity = (severity: Severity) => {
    setExpandedSeverity(prev => ({ ...prev, [severity]: !prev[severity] }));
  };

  const groupedIssues: Record<Severity, DiagnosticIssue[]> = {
    critical: issues.filter(i => i.severity === 'critical'),
    warning: issues.filter(i => i.severity === 'warning'),
    info: issues.filter(i => i.severity === 'info'),
  };

  if (!graph) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-text-muted text-center">Load a project to run diagnostics</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Summary bar */}
      <div className="px-3 py-2.5 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-text-secondary" />
            <span className="text-xs font-medium text-text-primary">
              {isAnalyzing ? 'Analyzing...' : `${summary.total} issue${summary.total !== 1 ? 's' : ''}`}
            </span>
          </div>
          <button
            onClick={analyze}
            disabled={isAnalyzing}
            className="p-1 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors disabled:opacity-40"
            title="Re-run analysis"
          >
            {isAnalyzing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />
            }
          </button>
        </div>

        {/* Severity badges */}
        {summary.total > 0 && (
          <div className="flex items-center gap-2">
            {summary.critical > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                {summary.critical}
              </span>
            )}
            {summary.warning > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {summary.warning}
              </span>
            )}
            {summary.info > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-[10px] text-blue-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                {summary.info}
              </span>
            )}
          </div>
        )}

        {lastAnalyzed && (
          <p className="text-[10px] text-text-muted mt-1.5">
            Last run: {lastAnalyzed.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-[11px] text-red-400">{error}</p>
        </div>
      )}

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isAnalyzing && issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 gap-3">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
            <p className="text-xs text-text-muted">Analyzing code health...</p>
          </div>
        ) : summary.total === 0 && lastAnalyzed ? (
          <div className="flex flex-col items-center justify-center p-8 gap-2">
            <div className="w-8 h-8 rounded-full bg-node-function/20 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-node-function" />
            </div>
            <p className="text-xs text-text-secondary font-medium">All clear!</p>
            <p className="text-[11px] text-text-muted text-center">No code health issues detected</p>
          </div>
        ) : (
          (['critical', 'warning', 'info'] as Severity[]).map(severity => {
            const group = groupedIssues[severity];
            if (group.length === 0) return null;
            const config = SEVERITY_CONFIG[severity];
            const isExpanded = expandedSeverity[severity];

            return (
              <div key={severity}>
                {/* Severity group header */}
                <button
                  onClick={() => toggleSeverity(severity)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-surface/50 border-b border-border-subtle hover:bg-hover/50 transition-colors sticky top-0 z-10"
                >
                  {isExpanded
                    ? <ChevronDown className="w-3 h-3 text-text-muted" />
                    : <ChevronRight className="w-3 h-3 text-text-muted" />
                  }
                  <span className={`w-2 h-2 rounded-full ${config.dot}`} />
                  <span className={`text-[11px] font-medium ${config.color}`}>
                    {config.label}
                  </span>
                  <span className="text-[10px] text-text-muted ml-auto">
                    {group.length}
                  </span>
                </button>

                {/* Issues in this group */}
                {isExpanded && (
                  <div className="flex flex-col">
                    {group.map(issue => {
                      const TypeIcon = TYPE_ICONS[issue.type] || AlertCircle;
                      return (
                        <button
                          key={issue.id}
                          onClick={() => handleIssueClick(issue)}
                          className="w-full text-left px-3 py-2 border-b border-border-subtle/50 hover:bg-hover/50 transition-colors group"
                        >
                          <div className="flex items-start gap-2">
                            <TypeIcon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${config.color} opacity-70 group-hover:opacity-100`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-text-primary leading-tight truncate group-hover:text-white transition-colors">
                                {issue.title}
                              </p>
                              <p className="text-[10px] text-text-muted leading-tight mt-0.5 truncate">
                                {issue.description}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
