function AppSkeleton({ compact, label = "Loading..." }) {
  return (
    <div className={`app-skeleton${compact ? " is-compact" : ""}`}>
      <div className="app-skeleton-shell">
        <div className="app-skeleton-header">
          <div className="app-skeleton-brand">
            <div className="app-skeleton-mark" />
            <div className="app-skeleton-brand-copy">
              <span className="skeleton-line is-short" />
              <span className="skeleton-line" />
            </div>
          </div>
          <div className="app-skeleton-nav">
            <span className="skeleton-pill" />
            <span className="skeleton-pill" />
          </div>
        </div>
        <div className="app-skeleton-grid">
          <div className="surface-panel app-skeleton-card">
            <span className="skeleton-line is-short" />
            <span className="skeleton-line is-wide" />
            <span className="skeleton-line" />
            <div className="app-skeleton-pills">
              <span className="skeleton-pill" />
              <span className="skeleton-pill" />
              <span className="skeleton-pill" />
            </div>
          </div>
          {!compact && (
            <div className="surface-panel app-skeleton-card">
              <span className="skeleton-line is-short" />
              <span className="skeleton-line is-wide" />
              <span className="skeleton-line" />
              <div className="app-skeleton-pills">
                <span className="skeleton-pill" />
                <span className="skeleton-pill" />
              </div>
            </div>
          )}
        </div>
        {label && <p className="app-skeleton-label">{label}</p>}
      </div>
    </div>
  );
}

export default AppSkeleton;