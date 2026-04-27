import "./styles/Legal.css";
const LAST_UPDATED = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  .toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const SECTIONS = [
  {
    title: "Information We Collect",
    body: `We collect information you provide directly — your name, email address, and password when you register. We also collect content you choose to ingest into your knowledge base, including URLs and the text extracted from them. We do not collect financial information or sell your data.`,
  },
  {
    title: "How We Use Your Information",
    body: `We use your information solely to provide the CortexWiki service: authenticating your account, storing and querying your knowledge base, and generating AI responses grounded in your ingested sources. We do not use your data to train AI models.`,
  },
  {
    title: "Data Storage",
    body: `Your account data and ingested knowledge are stored in MongoDB Atlas. Your knowledge graph relationships are stored in Neo4j. All data is associated with your account and not shared with other users.`,
  },
  {
    title: "Authentication and Security",
    body: `We use JWT-based authentication with short-lived access tokens (15 minutes) and HttpOnly refresh cookies (7 days). Passwords are hashed and never stored in plain text. Tokens are rotated on each refresh.`,
  },
  {
    title: "Third-Party Services",
    body: `CortexWiki uses Google Gemini and Groq for AI inference. Queries are sent to these services to generate answers. Please review Google's and Groq's privacy policies for details on how they handle data. We do not share your account information with these providers.`,
  },
  {
    title: "Data Deletion",
    body: `You may request deletion of your account and all associated data by contacting us at snehanshusekhar99@gmail.com. We will process deletion requests within 30 days.`,
  },
  {
    title: "Changes to This Policy",
    body: `We may update this policy as the service evolves. The "Last updated" date at the top of this page will always reflect the most recent revision. Continued use of CortexWiki after changes constitutes acceptance of the updated policy.`,
  },
  {
    title: "Contact",
    body: `Questions about this policy? Email us at snehanshusekhar99@gmail.com.`,
  },
];

function PrivacyPolicy() {
  return (
    <main className="legal-page">
      <div className="legal-inner">
        <div className="legal-header">
          <span className="legal-eyebrow">Legal</span>
          <h1>Privacy Policy</h1>
          <p className="legal-meta">Last updated: {LAST_UPDATED}</p>
          <p className="legal-intro">
            CortexWiki is built for individuals who care about where their data goes.
            This policy explains what we collect, why, and how we protect it — in plain language.
          </p>
        </div>

        <div className="legal-sections">
          {SECTIONS.map((s, i) => (
            <section key={i} className="legal-section">
              <h2>{s.title}</h2>
              <p>{s.body}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

export default PrivacyPolicy;