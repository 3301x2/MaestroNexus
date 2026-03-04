/**
 * Mermaid Diagram Generator for Processes
 * 
 * Generates Mermaid flowchart syntax from Process step data.
 * Designed to show branching/merging when CALLS edges exist between steps.
 */

export interface ProcessStep {
  id: string;
  name: string;
  filePath?: string;
  stepNumber: number;
  cluster?: string;
}

export interface ProcessEdge {
  from: string;
  to: string;
  type: string;
}

export interface ProcessData {
  id: string;
  label: string;
  processType: 'intra_community' | 'cross_community';
  steps: ProcessStep[];
  edges?: ProcessEdge[];  // CALLS edges between steps for branching
  clusters?: string[];
}

/**
 * Generate Mermaid flowchart from process data
 */
export function generateProcessMermaid(process: ProcessData): string {
  const { steps, edges, clusters } = process;
  
  if (!steps || steps.length === 0) {
    return 'graph TD\n  A[No steps found]';
  }

  const lines: string[] = ['graph TD'];

  // Add class definitions for styling (rounded corners + colors)
  lines.push('  %% Styles');
  lines.push('  classDef default fill:#1e293b,stroke:#94a3b8,stroke-width:3px,color:#f8fafc,rx:10,ry:10,font-size:24px;');
  lines.push('  classDef entry fill:#1e293b,stroke:#34d399,stroke-width:5px,color:#f8fafc,rx:10,ry:10,font-size:24px;');
  lines.push('  classDef step fill:#1e293b,stroke:#22d3ee,stroke-width:3px,color:#f8fafc,rx:10,ry:10,font-size:24px;');
  lines.push('  classDef terminal fill:#1e293b,stroke:#f472b6,stroke-width:5px,color:#f8fafc,rx:10,ry:10,font-size:24px;');
  lines.push('  classDef cluster fill:#0f172a,stroke:#334155,stroke-width:3px,color:#94a3b8,rx:4,ry:4,font-size:20px;');

  // Track clusters for subgraph grouping
  const clusterGroups = new Map<string, ProcessStep[]>();
  const noCluster: ProcessStep[] = [];
  
  for (const step of steps) {
    if (step.cluster) {
      const group = clusterGroups.get(step.cluster) || [];
      group.push(step);
      clusterGroups.set(step.cluster, group);
    } else {
      noCluster.push(step);
    }
  }

  // Generate node IDs (sanitized) - use actual ID to avoid collisions when combining processes
  const nodeId = (step: ProcessStep) => {
    // Sanitize the actual ID to be Mermaid-safe
    return step.id.replace(/[^a-zA-Z0-9_]/g, '_');
  };
  const sanitizeLabel = (text: string) => text.replace(/["\[\]<>{}()]/g, '').substring(0, 30);
  const getFileName = (path?: string) => path?.split('/').pop() || '';

  // Determine node class (entry, terminal, or normal step)
  const sortedStepsRef = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
  const entryId = sortedStepsRef[0]?.id;
  const terminalId = sortedStepsRef[sortedStepsRef.length - 1]?.id;

  const getNodeClass = (step: ProcessStep) => {
    if (step.id === entryId) return 'entry';
    if (step.id === terminalId) return 'terminal';
    return 'step';
  };

  // If we have cluster groupings and cross-community, use subgraphs
  const useClusters = process.processType === 'cross_community' && clusterGroups.size > 1;

  if (useClusters) {
    // Generate subgraphs for each cluster
    let clusterIndex = 0;
    
    for (const [clusterName, clusterSteps] of clusterGroups) {
      lines.push(`  subgraph ${sanitizeLabel(clusterName)}["${sanitizeLabel(clusterName)}"]:::cluster`);
      
      for (const step of clusterSteps) {
        const id = nodeId(step);
        const label = `${step.stepNumber}. ${sanitizeLabel(step.name)}`;
        const file = getFileName(step.filePath);
        const className = getNodeClass(step);
        lines.push(`    ${id}["${label}<br/><small>${file}</small>"]:::${className}`);
      }
      lines.push('  end');
      clusterIndex++;
    }
    
    // Add unclustered steps
    for (const step of noCluster) {
      const id = nodeId(step);
      const label = `${step.stepNumber}. ${sanitizeLabel(step.name)}`;
      const file = getFileName(step.filePath);
      const className = getNodeClass(step);
      lines.push(`  ${id}["${label}<br/><small>${file}</small>"]:::${className}`);
    }
  } else {
    // Simple flat layout
    for (const step of steps) {
      const id = nodeId(step);
      const label = `${step.stepNumber}. ${sanitizeLabel(step.name)}`;
      const file = getFileName(step.filePath);
      const className = getNodeClass(step);
      lines.push(`  ${id}["${label}<br/><small>${file}</small>"]:::${className}`);
    }
  }

  // Generate edges
  if (edges && edges.length > 0) {
    // Use actual CALLS edges for branching
    const stepById = new Map(steps.map(s => [s.id, s]));
    for (const edge of edges) {
      const fromStep = stepById.get(edge.from);
      const toStep = stepById.get(edge.to);
      if (fromStep && toStep) {
        lines.push(`  ${nodeId(fromStep)} --> ${nodeId(toStep)}`);
      }
    }
    // Ensure all nodes are connected (fallback for disconnected components)
    // For now assume graph is connected enough or user accepts fragments.
  } else {
    // Fallback: linear chain based on step order
    const sortedSteps = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
    for (let i = 0; i < sortedSteps.length - 1; i++) {
      lines.push(`  ${nodeId(sortedSteps[i])} --> ${nodeId(sortedSteps[i + 1])}`);
    }
  }

  return lines.join('\n');
}

// ── Dependency Flow Diagram ──────────────────────────────────────────────

export interface DepFlowNode {
  id: string;
  name: string;
  label: string; // NodeLabel e.g. 'Function', 'Class', 'File'
  filePath?: string;
}

export interface DepFlowEdge {
  sourceId: string;
  targetId: string;
  type: string; // CALLS, IMPORTS, etc.
}

/**
 * Generate a Mermaid flowchart showing upstream (dependencies) and
 * downstream (dependents) for a selected node, up to `depth` hops.
 */
export function generateDependencyFlowDiagram(
  centerId: string,
  nodes: DepFlowNode[],
  edges: DepFlowEdge[],
  depth: number = 2,
): string {
  if (nodes.length === 0) {
    return 'graph TD\n  A[No dependencies found]';
  }

  // Build adjacency maps
  const downstream = new Map<string, { target: string; type: string }[]>(); // node → things it calls/uses
  const upstream = new Map<string, { source: string; type: string }[]>();   // node → things that call/use it

  for (const e of edges) {
    if (!downstream.has(e.sourceId)) downstream.set(e.sourceId, []);
    downstream.get(e.sourceId)!.push({ target: e.targetId, type: e.type });
    if (!upstream.has(e.targetId)) upstream.set(e.targetId, []);
    upstream.get(e.targetId)!.push({ source: e.sourceId, type: e.type });
  }

  // BFS to collect nodes within depth hops
  const nodeSet = new Set<string>();
  const edgeSet = new Set<string>(); // "sourceId->targetId" dedup

  // BFS downstream (what center depends on)
  const downQueue: { id: string; d: number }[] = [{ id: centerId, d: 0 }];
  const downVisited = new Set<string>();
  downVisited.add(centerId);
  while (downQueue.length > 0) {
    const { id, d } = downQueue.shift()!;
    nodeSet.add(id);
    if (d >= depth) continue;
    for (const { target, type } of downstream.get(id) || []) {
      const key = `${id}->${target}`;
      edgeSet.add(`${key}|${type}`);
      nodeSet.add(target);
      if (!downVisited.has(target)) {
        downVisited.add(target);
        downQueue.push({ id: target, d: d + 1 });
      }
    }
  }

  // BFS upstream (what depends on center)
  const upQueue: { id: string; d: number }[] = [{ id: centerId, d: 0 }];
  const upVisited = new Set<string>();
  upVisited.add(centerId);
  while (upQueue.length > 0) {
    const { id, d } = upQueue.shift()!;
    nodeSet.add(id);
    if (d >= depth) continue;
    for (const { source, type } of upstream.get(id) || []) {
      const key = `${source}->${id}`;
      edgeSet.add(`${key}|${type}`);
      nodeSet.add(source);
      if (!upVisited.has(source)) {
        upVisited.add(source);
        upQueue.push({ id: source, d: d + 1 });
      }
    }
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const lines: string[] = ['graph TD'];

  // Styles
  lines.push('  %% Styles');
  lines.push('  classDef default fill:#1e293b,stroke:#94a3b8,stroke-width:2px,color:#f8fafc,rx:8,ry:8,font-size:14px;');
  lines.push('  classDef center fill:#1e293b,stroke:#22d3ee,stroke-width:4px,color:#22d3ee,rx:8,ry:8,font-size:14px;');
  lines.push('  classDef upstream fill:#1e293b,stroke:#34d399,stroke-width:2px,color:#f8fafc,rx:8,ry:8,font-size:14px;');
  lines.push('  classDef downstream fill:#1e293b,stroke:#f472b6,stroke-width:2px,color:#f8fafc,rx:8,ry:8,font-size:14px;');

  const sanitize = (s: string) => s.replace(/["\[\]<>{}()#]/g, '').substring(0, 35);
  const mermaidId = (id: string) => 'n_' + id.replace(/[^a-zA-Z0-9_]/g, '_');

  // Emit nodes
  for (const id of nodeSet) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const mid = mermaidId(id);
    const name = sanitize(node.name);
    const typeTag = node.label === 'File' ? '📄' : node.label === 'Class' ? '🔷' : node.label === 'Method' ? '🔧' : '⚡';

    let cls = 'default';
    if (id === centerId) cls = 'center';
    else if (upVisited.has(id) && !downVisited.has(id)) cls = 'upstream';
    else if (downVisited.has(id) && !upVisited.has(id)) cls = 'downstream';
    else if (upVisited.has(id)) cls = 'upstream';

    lines.push(`  ${mid}["${typeTag} ${name}"]:::${cls}`);
  }

  // Emit edges
  for (const entry of edgeSet) {
    const [pathPart, type] = entry.split('|');
    const [sourceId, targetId] = pathPart.split('->');
    const sId = mermaidId(sourceId);
    const tId = mermaidId(targetId);
    const edgeLabel = type === 'CALLS' ? 'calls' : type === 'IMPORTS' ? 'imports' : type.toLowerCase();
    lines.push(`  ${sId} -->|${edgeLabel}| ${tId}`);
  }

  // Click bindings (for node selection callback)
  for (const id of nodeSet) {
    const mid = mermaidId(id);
    lines.push(`  click ${mid} callback "${id}"`);
  }

  return lines.join('\n');
}

/**
 * Compute the maximum useful depth for a node — the furthest hop
 * reachable in either direction (upstream or downstream).
 * Returns at least 1 if the node has any connections, 0 otherwise.
 */
export function computeMaxDepth(
  centerId: string,
  edges: DepFlowEdge[],
  cap: number = 6,
): number {
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();

  for (const e of edges) {
    if (!downstream.has(e.sourceId)) downstream.set(e.sourceId, []);
    downstream.get(e.sourceId)!.push(e.targetId);
    if (!upstream.has(e.targetId)) upstream.set(e.targetId, []);
    upstream.get(e.targetId)!.push(e.sourceId);
  }

  const bfsMaxDepth = (start: string, adj: Map<string, string[]>): number => {
    const visited = new Set<string>();
    visited.add(start);
    const queue: { id: string; d: number }[] = [{ id: start, d: 0 }];
    let maxD = 0;
    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (d > maxD) maxD = d;
      if (d >= cap) continue;
      for (const next of adj.get(id) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, d: d + 1 });
        }
      }
    }
    return maxD;
  };

  const downMax = bfsMaxDepth(centerId, downstream);
  const upMax = bfsMaxDepth(centerId, upstream);
  return Math.min(Math.max(downMax, upMax), cap);
}

/**
 * Simple linear mermaid for quick preview
 */
export function generateSimpleMermaid(processLabel: string, stepCount: number): string {
  const [entry, terminal] = processLabel.split(' → ').map(s => s.trim());
  
  return `graph LR
  classDef entry fill:#059669,stroke:#34d399,stroke-width:2px,color:#ffffff,rx:10,ry:10;
  classDef terminal fill:#be185d,stroke:#f472b6,stroke-width:2px,color:#ffffff,rx:10,ry:10;
  A["🟢 ${entry || 'Start'}"]:::entry --> B["... ${stepCount - 2} steps ..."] --> C["🔴 ${terminal || 'End'}"]:::terminal`;
}
