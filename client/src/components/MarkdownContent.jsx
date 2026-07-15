import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./styles/MarkdownContent.css";

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

function highlightCode(code) {
  if (!code) return "";
  
  // 1. Escape HTML entities
  let escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
    
  const placeholders = [];
  let placeholderCounter = 0;
  
  function addPlaceholder(text, className) {
    const key = `___TOKEN_PLACEHOLDER_${placeholderCounter++}___`;
    placeholders.push({
      key,
      html: `<span class="${className}">${text}</span>`
    });
    return key;
  }
  
  // 2. Extract comments (highest priority to avoid false matches inside comments)
  escaped = escaped.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g, (match) => {
    return addPlaceholder(match, "token comment");
  });
  
  // 3. Extract strings
  escaped = escaped.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, (match) => {
    return addPlaceholder(match, "token string");
  });
  
  // 4. Highlight keywords
  const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|export|from|default|class|extends|new|this|typeof|instanceof|in|of|as|async|await|try|catch|finally|throw|def|elif|except|yield|lambda|and|or|not|is|pass|None|True|False|int|str|float|list|dict|set|tuple|print|len|struct|impl|fn|pub|use|mod|let|mut|match|enum|type|where|interface|package|public|private|protected|static|final|void|null|undefined)\b/g;
  escaped = escaped.replace(keywords, (match) => {
    return `<span class="token keyword">${match}</span>`;
  });
  
  // 5. Highlight functions
  escaped = escaped.replace(/\b([a-zA-Z_]\w*)(?=\s*\()/g, (match) => {
    return `<span class="token function">${match}</span>`;
  });
  
  // 6. Highlight numbers
  escaped = escaped.replace(/\b(\d+(?:\.\d+)?)\b/g, (match) => {
    return `<span class="token number">${match}</span>`;
  });
  
  // 7. Restore placeholders
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const p = placeholders[i];
    escaped = escaped.replace(p.key, p.html);
  }
  
  return escaped;
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
      code({ className, children, ...props }) {
        const raw      = String(children).replace(/\n$/, "");
        // A code node is inline when it has no language class and no newlines
        const isInline = !className && !raw.includes("\n");

        if (isInline) {
          return <code className="inline-code" {...props}>{children}</code>;
        }

        const language = className?.replace("language-", "") || "text";
        const highlightedHtml = highlightCode(raw);


        return (
          <div className="code-block">
            <div className="code-block-header">
              <span className="code-lang" aria-label={`Language: ${language}`}>
                {language}
              </span>
              <CopyCodeButton value={raw} />
            </div>
            <pre>
              <code
                className={className}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
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