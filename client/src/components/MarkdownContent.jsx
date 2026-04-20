import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function CopyCodeButton({ value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — fail silently
    }
  };

  return (
    <button
      type="button"
      className="ghost-button copy-code-btn"
      onClick={handleCopy}
      aria-label={copied ? "Code copied" : "Copy code block"}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function MarkdownContent({ content }) {
  const components = useMemo(
    () => ({
      a: ({ href, children, ...props }) => (
        <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
          {children}
        </a>
      ),
      code({ node, className, children, ...props }) {
        const code = String(children).replace(/\n$/, "");
        const isInline = node?.position
          ? !className && !code.includes("\n")
          : !className;

        if (isInline) {
          return (
            <code className="inline-code" {...props}>
              {children}
            </code>
          );
        }

        const language = className?.replace("language-", "") || "text";

        return (
          <div className="code-block">
            <div className="code-block-header">
              <span className="code-lang" aria-label={`Language: ${language}`}>
                {language}
              </span>
              <CopyCodeButton value={code} />
            </div>
            <pre>
              <code className={className} {...props}>
                {code}
              </code>
            </pre>
          </div>
        );
      },
    }),
    [],
  );

  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownContent);