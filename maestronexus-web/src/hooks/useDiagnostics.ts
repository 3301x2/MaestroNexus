/**
 * Diagnostics Hook
 *
 * Analyzes the knowledge graph to detect code health issues:
 *  1. Dead code — functions/classes/methods with zero incoming CALLS
 *  2. Disconnected files — files nothing imports
 *  3. Circular dependencies — cycles in IMPORTS edges
 *  4. Oversized modules — Community clusters with 30+ members
 *  5. Unused imports — symbols imported but never called from that file
 */

import { useState, useCallback, useMemo } from 'react';
import { useAppState } from './useAppState';

// ── Types ────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'info';

export interface DiagnosticIssue {
  id: string;
  type: 'dead-code' | 'disconnected-file' | 'circular-dependency' | 'oversized-module' | 'unused-import';
  severity: Severity;
  title: string;
  description: string;
  /** Node IDs that should be highlighted when clicking this issue */
  nodeIds: string[];
  /** File path if applicable */
  filePath?: string;
}

export interface DiagnosticsSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

// ── Entry-point exclusion patterns ───────────────────────────────────────

const ENTRY_POINT_PATTERNS = [
  /\/page\.\w+$/,            // Next.js pages
  /\/layout\.\w+$/,          // Next.js layouts
  /\/route\.\w+$/,           // Next.js API routes
  /\/index\.\w+$/,           // Index files (barrel exports)
  /\/main\.\w+$/,            // Main entry
  /\/app\.\w+$/,             // App entry
  /\.config\.\w+$/,          // Config files
  /\.test\.\w+$/,            // Test files
  /\.spec\.\w+$/,            // Spec files
  /\/__tests__\//,           // Test directories
  /\/test\//,                // Test directories
  /\/tests\//,               // Test directories
  /\.stories\.\w+$/,         // Storybook
  /\.d\.ts$/,                // Type declarations
  /middleware\.\w+$/,        // Middleware
  /global\.\w+$/,            // Global files
  /loading\.\w+$/,           // Next.js loading
  /error\.\w+$/,             // Next.js error
  /not-found\.\w+$/,         // Next.js not-found
];

function isEntryPoint(filePath: string): boolean {
  return ENTRY_POINT_PATTERNS.some(p => p.test(filePath));
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useDiagnostics() {
  const { graph, runQuery } = useAppState();

  const [issues, setIssues] = useState<DiagnosticIssue[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo<DiagnosticsSummary>(() => {
    const s = { total: issues.length, critical: 0, warning: 0, info: 0 };
    for (const issue of issues) s[issue.severity]++;
    return s;
  }, [issues]);

  const analyze = useCallback(async () => {
    if (!graph) return;
    setIsAnalyzing(true);
    setError(null);
    const found: DiagnosticIssue[] = [];

    try {
      // ── 1. Dead code: functions/classes/methods with zero incoming CALLS ──
      // Find all callable nodes that nothing calls
      try {
        const deadCodeResult = await runQuery(`
          MATCH (n)
          WHERE n.label IN ['Function', 'Method', 'Class']
          AND NOT EXISTS {
            MATCH (caller)-[r:CodeRelation {type: 'CALLS'}]->(n)
          }
          RETURN n.id AS id, n.name AS name, n.label AS type, n.filePath AS filePath
          LIMIT 100
        `);

        for (const row of deadCodeResult) {
          const id = row.id || row[0];
          const name = row.name || row[1] || 'Unknown';
          const type = row.type || row[2] || 'CodeElement';
          const filePath = row.filePath || row[3] || '';

          // Skip entry points
          if (filePath && isEntryPoint(filePath)) continue;
          // Skip constructors / lifecycle methods
          if (name === 'constructor' || name.startsWith('__')) continue;

          found.push({
            id: `dead-${id}`,
            type: 'dead-code',
            severity: 'critical',
            title: `${type} "${name}" is never called`,
            description: filePath ? `Defined in ${filePath.split('/').slice(-2).join('/')}` : 'No file path',
            nodeIds: [id],
            filePath,
          });
        }
      } catch {
        // Query may fail if node labels don't exist — skip silently
      }

      // ── 2. Disconnected files: files with zero incoming IMPORTS ──────────
      try {
        const disconnectedResult = await runQuery(`
          MATCH (f)
          WHERE f.label = 'File'
          AND NOT EXISTS {
            MATCH (other)-[r:CodeRelation {type: 'IMPORTS'}]->(f)
          }
          RETURN f.id AS id, f.name AS name, f.filePath AS filePath
          LIMIT 100
        `);

        for (const row of disconnectedResult) {
          const id = row.id || row[0];
          const name = row.name || row[1] || 'Unknown';
          const filePath = row.filePath || row[2] || name;

          // Skip entry points, configs, tests
          if (isEntryPoint(filePath || name)) continue;

          found.push({
            id: `disconnected-${id}`,
            type: 'disconnected-file',
            severity: 'warning',
            title: `"${name}" is never imported`,
            description: 'No other file imports this module',
            nodeIds: [id],
            filePath: filePath || undefined,
          });
        }
      } catch {
        // Skip silently
      }

      // ── 3. Circular dependencies: cycles in IMPORTS edges ───────────────
      // Use graph data directly for cycle detection (more efficient than Cypher)
      try {
        const importEdges = graph.relationships
          .filter(r => r.type === 'IMPORTS')
          .map(r => ({ from: r.sourceId, to: r.targetId }));

        // Build adjacency list
        const adj = new Map<string, string[]>();
        for (const e of importEdges) {
          if (!adj.has(e.from)) adj.set(e.from, []);
          adj.get(e.from)!.push(e.to);
        }

        // Find cycles using DFS with coloring
        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Map<string, number>();
        const parent = new Map<string, string>();
        const cycles: string[][] = [];
        const maxCycles = 20;

        function dfs(node: string) {
          if (cycles.length >= maxCycles) return;
          color.set(node, GRAY);
          for (const neighbor of adj.get(node) || []) {
            if (cycles.length >= maxCycles) return;
            if (color.get(neighbor) === GRAY) {
              // Found a cycle — reconstruct it
              const cycle: string[] = [neighbor];
              let curr = node;
              while (curr !== neighbor) {
                cycle.push(curr);
                curr = parent.get(curr) || neighbor;
              }
              cycle.push(neighbor);
              cycle.reverse();
              cycles.push(cycle);
            } else if ((color.get(neighbor) || WHITE) === WHITE) {
              parent.set(neighbor, node);
              dfs(neighbor);
            }
          }
          color.set(node, BLACK);
        }

        for (const nodeId of adj.keys()) {
          if ((color.get(nodeId) || WHITE) === WHITE) {
            dfs(nodeId);
          }
          if (cycles.length >= maxCycles) break;
        }

        // Convert cycles to issues using node names from the graph
        const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
        for (const cycle of cycles) {
          const names = cycle.map(id => {
            const n = nodeMap.get(id);
            return n?.properties?.name || n?.properties?.filePath?.split('/').pop() || id.slice(0, 8);
          });
          // Deduplicate: use sorted cycle key
          const cycleKey = [...cycle].sort().join(',');

          found.push({
            id: `cycle-${cycleKey.slice(0, 40)}`,
            type: 'circular-dependency',
            severity: 'critical',
            title: `Circular dependency: ${names.slice(0, 4).join(' → ')}${names.length > 4 ? ' → ...' : ''}`,
            description: `${cycle.length - 1} files in cycle`,
            nodeIds: cycle.filter((v, i) => cycle.indexOf(v) === i), // unique
          });
        }
      } catch {
        // Skip silently
      }

      // ── 4. Oversized modules: Community clusters with 30+ members ──────
      try {
        const communities = graph.nodes.filter(n => n.label === 'Community');
        for (const c of communities) {
          const count = c.properties.symbolCount || 0;
          if (count > 30) {
            const label = c.properties.heuristicLabel || c.properties.name || c.id;
            found.push({
              id: `oversized-${c.id}`,
              type: 'oversized-module',
              severity: 'warning',
              title: `Module "${label}" has ${count} symbols`,
              description: 'Consider splitting into smaller, focused modules',
              nodeIds: [c.id],
            });
          }
        }
      } catch {
        // Skip silently
      }

      // ── 5. Unused imports: files import symbols they never call ─────────
      try {
        const unusedImportResult = await runQuery(`
          MATCH (file)-[imp:CodeRelation {type: 'IMPORTS'}]->(imported)
          WHERE NOT EXISTS {
            MATCH (file)-[:CodeRelation {type: 'CALLS'}]->(imported)
          }
          AND NOT EXISTS {
            MATCH (child)-[:CodeRelation {type: 'DEFINES'}]->(file),
                  (child)-[:CodeRelation {type: 'CALLS'}]->(imported)
          }
          RETURN file.id AS fileId, file.name AS fileName, imported.id AS importedId, imported.name AS importedName
          LIMIT 100
        `);

        for (const row of unusedImportResult) {
          const fileId = row.fileId || row[0];
          const fileName = row.fileName || row[1] || 'Unknown';
          const importedId = row.importedId || row[2];
          const importedName = row.importedName || row[3] || 'Unknown';

          found.push({
            id: `unused-import-${fileId}-${importedId}`,
            type: 'unused-import',
            severity: 'info',
            title: `"${importedName}" imported but unused in ${fileName}`,
            description: 'Imported symbol is never called from this file',
            nodeIds: [fileId, importedId],
            filePath: fileName,
          });
        }
      } catch {
        // Skip silently
      }

      // Deduplicate by id
      const seen = new Set<string>();
      const deduped = found.filter(issue => {
        if (seen.has(issue.id)) return false;
        seen.add(issue.id);
        return true;
      });

      // Sort: critical first, then warning, then info
      const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
      deduped.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      setIssues(deduped);
      setLastAnalyzed(new Date());
    } catch (err) {
      console.error('[Diagnostics] Analysis failed:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  }, [graph, runQuery]);

  return {
    issues,
    summary,
    isAnalyzing,
    lastAnalyzed,
    error,
    analyze,
  };
}
