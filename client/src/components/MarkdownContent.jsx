import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./styles/Components.css";

function CopyCodeButton({ value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — fail silently
    }
  };

  return (
    <button
      type="button"
      className="ghost-button copy-code-btn"
      onClick={handleCopy}
      aria-label={copied ? "Code copied" : "Copy code block"}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function MarkdownContent({ content }) {
  // Memoized components — critical for streaming performance.
  // Prevents ReactMarkdown from remounting its renderer on every token.
  const components = useMemo(
    () => ({
      a: ({ href, children, ...props }) => (
        <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
          {children}
        </a>
      ),
      code({ node, className, children, ...props }) {
        const raw      = String(children).replace(/\n$/, "");
        // A code node is inline when it has no language class and no newlines
        const isInline = !className && !raw.includes("\n");

        if (isInline) {
          return <code className="inline-code" {...props}>{children}</code>;
        }

        const language = className?.replace("language-", "") || "text";

        return (
          <div className="code-block">
            <div className="code-block-header">
              <span className="code-lang" aria-label={`Language: ${language}`}>
                {language}
              </span>
              <CopyCodeButton value={raw} />
            </div>
            <pre>
              <code className={className} {...props}>{raw}</code>
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

// memo: skip re-render when content hasn't changed.
// During streaming the parent re-renders on every token, but MarkdownContent
// only re-renders when its content prop value changes.
export default memo(MarkdownContent);