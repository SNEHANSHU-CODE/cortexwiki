import { memo } from "react";

function getNodeId(endpoint) {
  return typeof endpoint === "string" ? endpoint : (endpoint?.id ?? "");
}

function EmptyPanel() {
  return (
    <aside className="surface-panel graph-details-panel" aria-label="Node details">
      <span className="eyebrow">Node details</span>
      <h2>Select a node</h2>
      <p>
        Hover to inspect connected concepts, then click a node to lock focus
        and review its relationships.
      </p>
    </aside>
  );
}

function NodeDetailsPanel({ node, relationships, connectedNodes, onSelectNode }) {
  if (!node) return <EmptyPanel />;

  return (
    <aside
      className="surface-panel graph-details-panel"
      aria-label={`Details for node: ${node.id}`}
    >
      <span className="eyebrow">Node details</span>
      <h2>{node.id}</h2>
      <p>
        {node.description || "No additional description available for this concept yet."}
      </p>

      <div className="details-metrics">
        <div className="metric-chip">
          <span>Importance</span>
          <strong>{Math.round((node.importance ?? 0) * 100)}%</strong>
        </div>
        <div className="metric-chip">
          <span>Category</span>
          <strong>{node.category || "concept"}</strong>
        </div>
      </div>

      {/* ── Relationships ─────────────────────────────────────────────── */}
      <section className="details-section" aria-labelledby="rel-heading">
        <h3 id="rel-heading">Relationships</h3>
        {relationships.length === 0 ? (
          <p className="muted-copy">No relationships available for this node.</p>
        ) : (
          <div className="details-list" role="list">
            {relationships.map((rel) => {
              const src = getNodeId(rel.source);
              const tgt = getNodeId(rel.target);
              // Stable key — avoids collision when label is undefined.
              const key = `${src}→${tgt}:${rel.label ?? ""}`;
              return (
                <article key={key} className="details-item" role="listitem">
                  <strong>{rel.label || "related"}</strong>
                  <span aria-label={`${src} to ${tgt}`}>
                    {src} → {tgt}
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Connected concepts ────────────────────────────────────────── */}
      <section className="details-section" aria-labelledby="conn-heading">
        <h3 id="conn-heading">Connected concepts</h3>
        {connectedNodes.length === 0 ? (
          <p className="muted-copy">No connected concepts yet.</p>
        ) : (
          <div className="details-list" role="list">
            {connectedNodes.map((related) => (
              <button
                key={related.id}
                type="button"
                className="details-item details-button"
                onClick={() => onSelectNode?.(related.id)}
                role="listitem"
                aria-label={`Focus node: ${related.id}`}
              >
                <strong>{related.id}</strong>
                <span>{Math.round((related.importance ?? 0) * 100)}% importance</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

export default memo(NodeDetailsPanel);