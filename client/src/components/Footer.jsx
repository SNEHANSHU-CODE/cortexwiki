function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="marketing-footer surface-panel" role="contentinfo">
      <div className="footer-brand">
        <strong>CortexWiki</strong>
        <p>
          Grounded chat, source ingestion, and graph-native reasoning in one
          premium workspace.
        </p>
        <small>© {year} CortexWiki. All rights reserved.</small>
      </div>

      <div className="footer-columns">
        <nav className="footer-column" aria-label="Product links">
          <span>Product</span>
          <a href="#features">Features</a>
          <a href="#workflow">How it works</a>
          <a href="#preview">Preview</a>
        </nav>

        <nav className="footer-column" aria-label="Company links">
          <span>Company</span>
          <a href="#top">Overview</a>
          <a href="#security">Security</a>
          <a
            href="mailto:hello@cortexwiki.ai"
            aria-label="Email CortexWiki support"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}

export default Footer;