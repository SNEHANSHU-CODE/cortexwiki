import { memo } from "react";
import "./components.css";

function edgeNodeId(ep) {
  return typeof ep === "string" ? ep : (ep?.id ?? "");
}

function EmptyState() {
  return (
    <div className="ndp-panel">
      <div className="ndp-header">
        <span className="ndp-eyebrow">Node details</span>
      </div>
      <div className="ndp-panel-empty">
        <span className="ndp-panel-empty__icon">🔍</span>
        <h3>Select a node</h3>
        <p>Click any node in the graph to inspect its relationships and importance score.</p>
      </div>
    </div>
  );
}

function NodeDetailsPanel({ node, relationships, connectedNodes, onSelectNode }) {
  if (!node) return <EmptyState />;

  return (
    <aside className="ndp-panel" aria-label={`Details for node: ${node.id}`}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="ndp-header">
        <span className="ndp-eyebrow">Node details</span>
        <h2 className="ndp-title">{node.id}</h2>
        {node.description && (
          <p className="ndp-desc">{node.description}</p>
        )}
      </div>

      <div className="ndp-body">

        {/* ── Metrics ────────────────────────────────────────────────── */}
        <div className="ndp-metrics">
          <div className="ndp-metric">
            <span className="ndp-metric__label">Importance</span>
            <span className="ndp-metric__value">
              {Math.round((node.importance ?? 0) * 100)}%
            </span>
          </div>
          <div className="ndp-metric">
            <span className="ndp-metric__label">Category</span>
            <span className="ndp-metric__value">{node.category || "concept"}</span>
          </div>
        </div>

        {/* ── Relationships ───────────────────────────────────────────── */}
        <section className="ndp-section" aria-labelledby="ndp-rel-heading">
          <span className="ndp-section-label" id="ndp-rel-heading">
            Relationships · {relationships.length}
          </span>
          {relationships.length === 0 ? (
            <p className="ndp-empty">No relationships for this node yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }} role="list">
              {relationships.map((rel) => {
                const src = edgeNodeId(rel.source);
                const tgt = edgeNodeId(rel.target);
                const key = `${src}→${tgt}:${rel.label ?? ""}`;
                return (
                  <div key={key} className="ndp-rel" role="listitem">
                    <span className="ndp-rel__label">{rel.label || "related"}</span>
                    <span className="ndp-rel__nodes">
                      {src}
                      <span>→</span>
                      {tgt}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Connected concepts ──────────────────────────────────────── */}
        <section className="ndp-section" aria-labelledby="ndp-conn-heading">
          <span className="ndp-section-label" id="ndp-conn-heading">
            Connected · {connectedNodes.length}
          </span>
          {connectedNodes.length === 0 ? (
            <p className="ndp-empty">No connected concepts yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }} role="list">
              {connectedNodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="ndp-node-btn"
                  onClick={() => onSelectNode?.(n.id)}
                  role="listitem"
                  aria-label={`Focus node: ${n.id}`}
                >
                  <span className="ndp-node-btn__name">{n.id}</span>
                  <span className="ndp-node-btn__meta">
                    {Math.round((n.importance ?? 0) * 100)}%
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

      </div>
    </aside>
  );
}

export default memo(NodeDetailsPanel);