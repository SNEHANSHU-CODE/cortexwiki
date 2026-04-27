import "./styles/Legal.css";
function ContactPage() {
  return (
    <main className="legal-page">
      <div className="legal-inner">
        <div className="legal-header">
          <span className="legal-eyebrow">Contact</span>
          <h1>Get in touch</h1>
          <p className="legal-intro">
            Questions, feedback, or bug reports — reach out directly.
            CortexWiki is an independent project and every message is read personally.
          </p>
        </div>

        <div className="legal-sections">
          <section className="legal-section">
            <h2>Email</h2>
            <p>
              For all enquiries:{" "}
              <a
                href="mailto:snehanshusekhar99@gmail.com"
                className="legal-link"
              >
                snehanshusekhar99@gmail.com
              </a>
            </p>
          </section>

          <section className="legal-section">
            <h2>Response time</h2>
            <p>
              We aim to respond within 2–3 business days. For urgent security issues,
              please include "Security" in the subject line.
            </p>
          </section>

          <section className="legal-section">
            <h2>Built by</h2>
            <p>
              Snehanshu Sekhar Jena — software engineer, India.{" "}
              <a
                href="https://linkedin.com/in/snehanshu-sekhar-jena"
                target="_blank"
                rel="noreferrer noopener"
                className="legal-link"
              >
                LinkedIn ↗
              </a>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

export default ContactPage;