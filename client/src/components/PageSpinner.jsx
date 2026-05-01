import "./styles/PageSpinner.css";

/**
 * Minimal spinner — used as Suspense fallback for all non-landing pages.
 */
function PageSpinner({ label = "Loading…" }) {
  return (
    <div className="ps-root" role="status" aria-label={label}>
      <div className="ps-ring" aria-hidden="true">
        <div className="ps-ring__inner" />
      </div>
      <span className="ps-label">{label}</span>
    </div>
  );
}

export default PageSpinner;