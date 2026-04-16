function SkeletonLine({ short = false, wide = false }) {
  return (
    <span
      className={`skeleton-line${short ? " is-short" : ""}${wide ? " is-wide" : ""}`}
      aria-hidden="true"
    />
  );
}

function AppSkeleton({ label = "Loading CortexWiki…", compact = false }) {
  return (
    <main
      className={`app-skeleton${compact ? " is-compact" : ""}`}
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <section className="app-skeleton-shell surface-panel">
        <div className="app-skeleton-header" aria-hidden="true">
          <div className="app-skeleton-brand">
            <span className="app-skeleton-mark" />
            <div className="app-skeleton-brand-copy">
              <SkeletonLine short />
              <SkeletonLine />
            </div>
          </div>
          <div className="app-skeleton-nav">
            <SkeletonLine short />
            <SkeletonLine short />
            <SkeletonLine short />
          </div>
        </div>

        <div className="app-skeleton-grid" aria-hidden="true">
          <article className="app-skeleton-card surface-card">
            <SkeletonLine short />
            <SkeletonLine wide />
            <SkeletonLine />
            <SkeletonLine />
            <div className="app-skeleton-pills">
              <span className="skeleton-pill" />
              <span className="skeleton-pill" />
              <span className="skeleton-pill" />
            </div>
          </article>

          {!compact && (
            <article className="app-skeleton-card surface-card">
              <SkeletonLine short />
              <SkeletonLine wide />
              <SkeletonLine />
              <SkeletonLine />
              <SkeletonLine short />
            </article>
          )}
        </div>

        {/* Visually shown label; sr-only equivalent via aria-live above */}
        <p className="app-skeleton-label" aria-live="polite">{label}</p>
      </section>
    </main>
  );
}

export default AppSkeleton;