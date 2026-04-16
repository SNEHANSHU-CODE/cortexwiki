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
  // Memoize components so ReactMarkdown never rebuilds the renderer map on
  // every re-render (critical during streaming when content changes rapidly).
  const components = useMemo(
    () => ({
      a: ({ href, children, ...props }) => (
        <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
          {children}
        </a>
      ),
      // react-markdown v9+ passes `node` — use that to detect block vs inline.
      code({ node, className, children, ...props }) {
        const code = String(children).replace(/\n$/, "");
        // A code element is inline when its parent is NOT a <pre>.
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
    <ReactMarkdown
      className="markdown-content"
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

// Memo: skip re-render when content string hasn't changed.
// This is the key fix for streaming flicker — parent re-renders every chunk
// but MarkdownContent only re-renders when its own content prop changes.
export default memo(MarkdownContent);