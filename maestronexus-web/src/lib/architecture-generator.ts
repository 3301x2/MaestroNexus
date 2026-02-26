/**
 * Architecture Diagram Generator
 *
 * Generates Mermaid diagrams for the high-level architecture view.
 * Shows clusters (communities) and their inter-relationships.
 */

export interface ArchitectureCluster {
  id: string;
  label: string;
  symbolCount: number;
  cohesion: number;
  members?: Array<{ id: string; name: string; type: string; filePath?: string }>;
}

export interface ClusterRelationship {
  from: string;
  to: string;
  relType: string;
  weight: number;
}

export interface ArchitectureData {
  id: string;
  label: string;
  clusters: ArchitectureCluster[];
  relationships: ClusterRelationship[];
}

/**
 * Generate full architecture Mermaid diagram showing all clusters and their relationships
 */
export function generateArchitectureMermaid(data: ArchitectureData): string {
  const { clusters, relationships } = data;

  if (!clusters || clusters.length === 0) {
    return 'graph TD\n  A[No clusters detected]';
  }

  const lines: string[] = ['graph TD'];

  // Styles matching existing process mermaid theme
  lines.push('  %% Styles');
  lines.push('  classDef default fill:#1e293b,stroke:#94a3b8,stroke-width:3px,color:#f8fafc,rx:10,ry:10,font-size:20px;');
  lines.push('  classDef large fill:#1e293b,stroke:#22d3ee,stroke-width:5px,color:#f8fafc,rx:10,ry:10,font-size:22px;');
  lines.push('  classDef medium fill:#1e293b,stroke:#a78bfa,stroke-width:4px,color:#f8fafc,rx:10,ry:10,font-size:20px;');
  lines.push('  classDef small fill:#1e293b,stroke:#94a3b8,stroke-width:3px,color:#f8fafc,rx:10,ry:10,font-size:18px;');

  const sanitizeId = (text: string) => text.replace(/[^a-zA-Z0-9_]/g, '_');
  const sanitizeLabel = (text: string) => text.replace(/["\[\]<>{}()]/g, '').substring(0, 40);

  // Sort clusters by symbol count for consistent layout
  const sorted = [...clusters].sort((a, b) => b.symbolCount - a.symbolCount);
  const maxSymbols = sorted[0]?.symbolCount || 1;

  // Generate cluster nodes
  for (const cluster of sorted) {
    const id = sanitizeId(cluster.id);
    const label = sanitizeLabel(cluster.label);
    const cohesionPct = Math.round(cluster.cohesion * 100);

    // Size class based on relative symbol count
    const ratio = cluster.symbolCount / maxSymbols;
    const sizeClass = ratio > 0.5 ? 'large' : ratio > 0.2 ? 'medium' : 'small';

    lines.push(`  ${id}["${label}<br/><small>${cluster.symbolCount} symbols | ${cohesionPct}% cohesion</small>"]:::${sizeClass}`);
  }

  // Generate relationship edges
  // Aggregate relationships by from-to pair
  const edgeMap = new Map<string, { from: string; to: string; types: Set<string>; totalWeight: number }>();

  for (const rel of relationships) {
    const key = `${rel.from}__${rel.to}`;
    const reverseKey = `${rel.to}__${rel.from}`;

    // Combine bidirectional edges
    const existing = edgeMap.get(key) || edgeMap.get(reverseKey);
    if (existing) {
      existing.types.add(rel.relType);
      existing.totalWeight += rel.weight;
    } else {
      edgeMap.set(key, {
        from: rel.from,
        to: rel.to,
        types: new Set([rel.relType]),
        totalWeight: rel.weight,
      });
    }
  }

  // Find cluster ID from label
  const clusterIdMap = new Map(clusters.map(c => [c.label, sanitizeId(c.id)]));

  for (const edge of edgeMap.values()) {
    const fromId = clusterIdMap.get(edge.from);
    const toId = clusterIdMap.get(edge.to);
    if (!fromId || !toId || fromId === toId) continue;

    // Edge label shows dominant relationship types
    const typeLabels = Array.from(edge.types).slice(0, 2).join(', ');
    const thickness = edge.totalWeight > 10 ? '==>' : edge.totalWeight > 3 ? '-->' : '-.->';

    lines.push(`  ${fromId} ${thickness}|"${typeLabels} (${edge.totalWeight})"| ${toId}`);
  }

  return lines.join('\n');
}

/**
 * Generate detail diagram for a single cluster showing its members grouped by type
 */
export function generateClusterDetailMermaid(cluster: ArchitectureCluster): string {
  const members = cluster.members || [];

  if (members.length === 0) {
    return `graph TD\n  A["${cluster.label}: No members found"]`;
  }

  const lines: string[] = ['graph TD'];

  // Styles
  lines.push('  %% Styles');
  lines.push('  classDef default fill:#1e293b,stroke:#94a3b8,stroke-width:2px,color:#f8fafc,rx:8,ry:8,font-size:18px;');
  lines.push('  classDef func fill:#1e293b,stroke:#10b981,stroke-width:3px,color:#f8fafc,rx:8,ry:8,font-size:18px;');
  lines.push('  classDef cls fill:#1e293b,stroke:#f59e0b,stroke-width:3px,color:#f8fafc,rx:8,ry:8,font-size:18px;');
  lines.push('  classDef file fill:#1e293b,stroke:#3b82f6,stroke-width:3px,color:#f8fafc,rx:8,ry:8,font-size:18px;');
  lines.push('  classDef iface fill:#1e293b,stroke:#ec4899,stroke-width:3px,color:#f8fafc,rx:8,ry:8,font-size:18px;');
  lines.push('  classDef method fill:#1e293b,stroke:#14b8a6,stroke-width:3px,color:#f8fafc,rx:8,ry:8,font-size:18px;');
  lines.push('  classDef other fill:#1e293b,stroke:#64748b,stroke-width:2px,color:#f8fafc,rx:8,ry:8,font-size:16px;');
  lines.push('  classDef cluster fill:#0f172a,stroke:#334155,stroke-width:3px,color:#94a3b8,rx:4,ry:4,font-size:20px;');

  const sanitizeId = (text: string) => text.replace(/[^a-zA-Z0-9_]/g, '_');
  const sanitizeLabel = (text: string) => text.replace(/["\[\]<>{}()]/g, '').substring(0, 35);

  // Group members by type
  const groups = new Map<string, typeof members>();
  for (const member of members) {
    const type = member.type || 'Other';
    const group = groups.get(type) || [];
    group.push(member);
    groups.set(type, group);
  }

  // Type to style class mapping
  const typeClassMap: Record<string, string> = {
    Function: 'func',
    Class: 'cls',
    File: 'file',
    Interface: 'iface',
    Method: 'method',
  };

  // Priority order for groups
  const typeOrder = ['Class', 'Interface', 'Function', 'Method', 'File'];
  const sortedTypes = [...groups.keys()].sort((a, b) => {
    const ai = typeOrder.indexOf(a);
    const bi = typeOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // Generate subgraphs for each type group
  for (const type of sortedTypes) {
    const typeMembers = groups.get(type) || [];
    // Limit to 15 members per type to keep diagram readable
    const shown = typeMembers.slice(0, 15);
    const hidden = typeMembers.length - shown.length;
    const className = typeClassMap[type] || 'other';

    lines.push(`  subgraph ${sanitizeId(type)}s["${type}s (${typeMembers.length})"]`);

    for (const member of shown) {
      const id = sanitizeId(member.id);
      const label = sanitizeLabel(member.name);
      const file = member.filePath?.split('/').pop() || '';
      lines.push(`    ${id}["${label}<br/><small>${file}</small>"]:::${className}`);
    }

    if (hidden > 0) {
      lines.push(`    ${sanitizeId(type)}_more["... +${hidden} more"]:::other`);
    }

    lines.push('  end');
  }

  return lines.join('\n');
}
