import { useAppState } from '../hooks/useAppState';

export const StatusBar = () => {
  const { graph, progress } = useAppState();

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.relationships.length ?? 0;

  // Detect primary language
  const primaryLanguage = (() => {
    if (!graph) return null;
    const languages = graph.nodes
      .map(n => n.properties.language)
      .filter(Boolean);
    if (languages.length === 0) return null;

    const counts = languages.reduce((acc, lang) => {
      acc[lang!] = (acc[lang!] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  })();

  return (
    <footer className="flex items-center justify-between px-5 py-2 bg-deep border-t border-dashed border-border-subtle text-[11px] text-text-muted">
      {/* Left - Status */}
      <div className="flex items-center gap-4">
        {progress && progress.phase !== 'complete' ? (
          <>
            <div className="w-28 h-1 bg-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-node-interface rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span>{progress.message}</span>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-node-function rounded-full" />
            <span>Ready</span>
          </div>
        )}
      </div>

      {/* Center - Eternity Fine */}
      <a
        href="https://eternityfine.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 hover:bg-accent/20 hover:border-accent/40 hover:scale-[1.02] transition-all duration-200 cursor-pointer"
      >
        <span className="text-[11px] font-medium text-accent group-hover:text-accent-dim transition-colors">A product of Eternity Fine</span>
      </a>

      {/* Right - Stats */}
      <div className="flex items-center gap-3">
        {graph && (
          <>
            <span>{nodeCount} nodes</span>
            <span className="text-border-default">•</span>
            <span>{edgeCount} edges</span>
            {primaryLanguage && (
              <>
                <span className="text-border-default">•</span>
                <span>{primaryLanguage}</span>
              </>
            )}
          </>
        )}
      </div>
    </footer>
  );
};
