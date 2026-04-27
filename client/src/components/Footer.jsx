import "./styles/Footer.css";
import { Link } from "react-router-dom";

function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="cw-footer">
      <div className="cw-footer__inner">
        <div className="cw-footer__brand">
          <span className="cw-footer__mark" aria-hidden="true">CW</span>
          <span className="cw-footer__name">CortexWiki</span>
        </div>

        <p className="cw-footer__copy">
          © {year} Snehanshu Sekhar Jena. All rights reserved.
        </p>

        <nav className="cw-footer__links" aria-label="Legal navigation">
          <Link to="/privacy" className="cw-footer__link">Privacy Policy</Link>
          <span className="cw-footer__sep" aria-hidden="true">·</span>
          <Link to="/terms"   className="cw-footer__link">Terms of Service</Link>
          <span className="cw-footer__sep" aria-hidden="true">·</span>
          <Link to="/contact" className="cw-footer__link">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}

export default Footer;