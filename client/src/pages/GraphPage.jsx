import { startTransition, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import GraphViewer from "../components/GraphViewer";
import { clearGraphError, requestGraph, selectGraphNode } from "../redux/slices/graphSlice";
import "./styles/Graph.css";

function edgeNodeId(ep) {
  return typeof ep === "string" ? ep : ep?.id ?? "";
}

function GraphSkeleton() {
  return (
    <div className="ws-graph-skeleton" style={{ padding: "1rem", flex: 1 }}>
      <div className="ws-skeleton-line ws-skeleton-line--short" />
      <div className="ws-skeleton-line ws-skeleton-line--wide" />
      <div className="ws-skeleton-line ws-skeleton-line--med" />
      <div className="ws-graph-skeleton__canvas" />
    </div>
  );
}

function NodeDetails({ node, relationships, connectedNodes, onSelectNode }) {
  if (!node) {
    return (
      <div className="graph-embed__details">
        <div className="ws-panel__header">
          <span className="ws-eyebrow">Node details</span>
        </div>
        <div className="ws-empty" style={{ minHeight: 140, padding: "1.5rem" }}>
          <span className="ws-empty__icon">🔍</span>
          <p>Click any node to inspect its relationships.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-embed__details">
      <div className="ws-panel__header">
        <span className="ws-eyebrow">Node details</span>
      </div>
      <div className="ws-panel__body">
        <div>
          <h3 style={{
            fontFamily: "'Syne', system-ui, sans-serif",
            fontWeight: 800, fontSize: "1rem",
            color: "#f8fafc", margin: "0 0 0.3rem",
          }}>
            {node.id}
          </h3>
          {node.description && (
            <p style={{ fontSize: "0.82rem", color: "#64748b", margin: 0, lineHeight: 1.6 }}>
              {node.description}
            </p>
          )}
        </div>

        <div className="ws-details-metrics">
          <div className="ws-details-metric">
            <span className="ws-details-metric__label">Importance</span>
            <span className="ws-details-metric__value">
              {Math.round((node.importance ?? 0) * 100)}%
            </span>
          </div>
          <div className="ws-details-metric">
            <span className="ws-details-metric__label">Category</span>
            <span className="ws-details-metric__value">{node.category || "concept"}</span>
          </div>
        </div>

        {relationships.length > 0 && (
          <div>
            <span className="ws-eyebrow" style={{ display: "block", marginBottom: "0.4rem" }}>
              Relationships · {relationships.length}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {relationships.map((rel) => {
                const src = edgeNodeId(rel.source);
                const tgt = edgeNodeId(rel.target);
                return (
                  <div key={`${src}→${tgt}:${rel.label ?? ""}`} className="ws-rel-item">
                    <strong>{rel.label || "related"}</strong>
                    <span>{src} → {tgt}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {connectedNodes.length > 0 && (
          <div>
            <span className="ws-eyebrow" style={{ display: "block", marginBottom: "0.4rem" }}>
              Connected · {connectedNodes.length}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {connectedNodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="ws-details-node-btn"
                  onClick={() => onSelectNode(n.id)}
                  aria-label={`Focus ${n.id}`}
                >
                  <span className="ndp-node-btn__name">{n.id}</span>
                  <span className="ndp-node-btn__meta">
                    {Math.round((n.importance ?? 0) * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * GraphPage — accepts wikiId prop when embedded in WikiDashboard.
 * No page header, no outer padding — fills its parent container.
 */
function GraphPage({ wikiId }) {
  const dispatch = useDispatch();
  const { nodes, edges, topic, selectedNodeId, status, error } =
    useSelector((s) => s.graph);
  const [topicInput, setTopicInput] = useState(() => topic ?? "");

  // Load graph when wikiId changes
  useEffect(() => {
    if (!wikiId) return;
    void dispatch(requestGraph({ wikiId, topic: "" }));
  }, [dispatch, wikiId]);

  // Derived data
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const selectedRelationships = useMemo(
    () => edges.filter((e) => {
      const s = edgeNodeId(e.source);
      const t = edgeNodeId(e.target);
      return s === selectedNodeId || t === selectedNodeId;
    }),
    [edges, selectedNodeId],
  );

  const connectedNodes = useMemo(() => {
    const ids = new Set(
      selectedRelationships.flatMap((r) => [edgeNodeId(r.source), edgeNodeId(r.target)])
    );
    ids.delete(selectedNodeId);
    return nodes
      .filter((n) => ids.has(n.id))
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  }, [nodes, selectedNodeId, selectedRelationships]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (!wikiId) return;
    dispatch(clearGraphError());
    void dispatch(requestGraph({ wikiId, topic: topicInput.trim() }));
  };

  const handleFocusNode = (nodeId) =>
    startTransition(() => dispatch(selectGraphNode(nodeId)));

  const hasNodes  = nodes.length > 0;
  const isLoading = status === "loading";

  return (
    <div className="graph-embed">

      {/* ── Top bar: stats + search ───────────────────────────────────── */}
      <div className="graph-embed__topbar">
        <div className="graph-embed__stats">
          <span className="graph-embed__stat">
            <span className="graph-embed__stat-label">Nodes</span>
            <span className="graph-embed__stat-value">{nodes.length}</span>
          </span>
          <span className="graph-embed__stat-sep">·</span>
          <span className="graph-embed__stat">
            <span className="graph-embed__stat-label">Edges</span>
            <span className="graph-embed__stat-value">{edges.length}</span>
          </span>
          <span className="graph-embed__stat-sep">·</span>
          <span className="graph-embed__stat">
            <span className="graph-embed__stat-label">Topic</span>
            <span className="graph-embed__stat-value">{topic || "All"}</span>
          </span>
        </div>

        <form className="graph-embed__search" onSubmit={handleSearch}>
          <label className="sr-only" htmlFor="graphSearch">Search concept</label>
          <input
            id="graphSearch"
            type="search"
            className="ws-field__input"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="Search a concept…"
            disabled={!wikiId || isLoading}
            style={{ minWidth: 160, fontSize: "0.85rem", padding: "0.45rem 0.75rem" }}
          />
          <button
            type="submit"
            className="ws-btn ws-btn--primary"
            style={{ fontSize: "0.82rem", padding: "0.45rem 0.875rem" }}
            disabled={!wikiId || isLoading}
          >
            Focus
          </button>
        </form>
      </div>

      {/* ── Graph canvas + node details ───────────────────────────────── */}
      <div className="graph-embed__body">

        {/* Canvas */}
        <div className="graph-embed__canvas">
          {!wikiId ? (
            <div className="ws-empty" style={{ minHeight: 360 }}>
              <span className="ws-empty__icon">🕸️</span>
              <h3>Select a wiki to load graph</h3>
              <p>Choose a wiki from the left panel to explore its concept graph.</p>
            </div>
          ) : isLoading && !hasNodes ? (
            <GraphSkeleton />
          ) : error && !hasNodes ? (
            <div className="ws-empty" style={{ minHeight: 360 }}>
              <span className="ws-empty__icon">⚠️</span>
              <h3>Graph unavailable</h3>
              <p>{error}</p>
              <button
                type="button"
                className="ws-btn ws-btn--ghost"
                onClick={() => void dispatch(requestGraph({ wikiId, topic }))}
              >
                Retry
              </button>
            </div>
          ) : !hasNodes ? (
            <div className="ws-empty" style={{ minHeight: 360 }}>
              <span className="ws-empty__icon">🕸️</span>
              <h3>No graph data yet</h3>
              <p>Ingest a source into this wiki — concepts and relationships will appear here.</p>
            </div>
          ) : (
            <>
              {error && (
                <div
                  className="ws-banner ws-banner--error"
                  style={{ margin: "0.75rem" }}
                  role="alert"
                >
                  <span>{error}</span>
                  <button
                    type="button"
                    className="ws-btn ws-btn--ghost"
                    style={{ fontSize: "0.75rem" }}
                    onClick={() => void dispatch(requestGraph({ wikiId, topic }))}
                  >
                    Retry
                  </button>
                </div>
              )}
              <GraphViewer
                graphData={{ nodes, edges }}
                selectedNodeId={selectedNodeId}
                onNodeSelect={(node) => handleFocusNode(node.id)}
              />
            </>
          )}
        </div>

        {/* Node details sidebar */}
        <NodeDetails
          node={selectedNode}
          relationships={selectedRelationships}
          connectedNodes={connectedNodes}
          onSelectNode={handleFocusNode}
        />
      </div>
    </div>
  );
}

export default GraphPage;