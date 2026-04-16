import { startTransition, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import GraphViewer from "../components/GraphViewer";
import NodeDetailsPanel from "../components/NodeDetailsPanel";
import { clearGraphError, requestGraph, selectGraphNode } from "../redux/slices/graphSlice";

function GraphSkeleton() {
  return (
    <div className="graph-skeleton" aria-hidden="true">
      <span className="skeleton-line is-short" />
      <span className="skeleton-line is-wide" />
      <span className="skeleton-line" />
      <div className="graph-skeleton-canvas surface-card" />
    </div>
  );
}

// Normalise edge endpoint to a plain string id regardless of shape.
function edgeNodeId(endpoint) {
  return typeof endpoint === "string" ? endpoint : endpoint?.id ?? "";
}

function GraphPage() {
  const [topicInput, setTopicInput] = useState("");
  const dispatch = useDispatch();
  const { nodes, edges, topic, selectedNodeId, status, error } =
    useSelector((s) => s.graph);

  // Load graph on mount only when idle.
  useEffect(() => {
    if (status === "idle") {
      void dispatch(requestGraph(""));
    }
  }, [dispatch, status]);

  // Keep search field in sync with the active topic.
  useEffect(() => {
    setTopicInput(topic ?? "");
  }, [topic]);

  // ── Derived data ────────────────────────────────────────────────────────
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const selectedRelationships = useMemo(
    () =>
      edges.filter((edge) => {
        const src = edgeNodeId(edge.source);
        const tgt = edgeNodeId(edge.target);
        return src === selectedNodeId || tgt === selectedNodeId;
      }),
    [edges, selectedNodeId],
  );

  const connectedNodes = useMemo(() => {
    const relatedIds = new Set(
      selectedRelationships.flatMap((rel) => [
        edgeNodeId(rel.source),
        edgeNodeId(rel.target),
      ]),
    );
    relatedIds.delete(selectedNodeId);
    return nodes
      .filter((n) => relatedIds.has(n.id))
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  }, [nodes, selectedNodeId, selectedRelationships]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSearch = (e) => {
    e.preventDefault();
    dispatch(clearGraphError());
    void dispatch(requestGraph(topicInput.trim()));
  };

  const handleFocusNode = (nodeId) => {
    startTransition(() => dispatch(selectGraphNode(nodeId)));
  };

  const hasNodes  = nodes.length > 0;
  const isLoading = status === "loading";

  return (
    <section className="workspace-page">
      <header className="hero-panel page-header-panel">
        <div className="page-header-copy">
          <span className="eyebrow">Knowledge graph</span>
          <h1>Explore concepts as a connected system.</h1>
          <p>
            Search for a topic, hover to highlight relationships, click to
            inspect details, and smoothly pan through the graph without flicker
            or layout jumps.
          </p>
        </div>

        <form className="graph-search-form" onSubmit={handleSearch}>
          <label className="sr-only" htmlFor="graphSearch">Search graph node</label>
          <input
            id="graphSearch"
            type="search"
            className="text-input"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="Search a concept…"
          />
          <button type="submit" className="button button-primary" disabled={isLoading}>
            Focus node
          </button>
        </form>
      </header>

      <div className="stats-grid">
        <article className="metric-card surface-card">
          <span>Nodes</span>
          <strong>{nodes.length}</strong>
        </article>
        <article className="metric-card surface-card">
          <span>Relationships</span>
          <strong>{edges.length}</strong>
        </article>
        <article className="metric-card surface-card">
          <span>Active topic</span>
          <strong>{topic || "All concepts"}</strong>
        </article>
      </div>

      <div className="workspace-grid graph-layout">
        <section className="surface-panel graph-panel">
          <div className="section-heading-inline">
            <div>
              <span className="eyebrow">Interactive graph</span>
              <h2>Pan, zoom, and inspect relationships</h2>
            </div>
            <Link className="ghost-button" to="/ingest">Add more data</Link>
          </div>

          {isLoading && !hasNodes ? (
            <GraphSkeleton />
          ) : error && !hasNodes ? (
            <div className="empty-state">
              <h3>Graph unavailable</h3>
              <p>{error}</p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void dispatch(requestGraph(topic))}
              >
                Retry
              </button>
            </div>
          ) : !hasNodes ? (
            <div className="empty-state">
              <h3>No graph data yet</h3>
              <p>
                Ingest a source first, then come back to explore the resulting
                concepts and relationships.
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="status-banner is-error" role="alert">
                  <span>{error}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void dispatch(requestGraph(topic))}
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
        </section>

        <NodeDetailsPanel
          node={selectedNode}
          relationships={selectedRelationships}
          connectedNodes={connectedNodes}
          onSelectNode={handleFocusNode}
        />
      </div>
    </section>
  );
}

export default GraphPage;