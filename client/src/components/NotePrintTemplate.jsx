import { forwardRef } from "react";
import MarkdownContent from "./MarkdownContent";
import "./styles/NotePrintTemplate.css";

const NotePrintTemplate = forwardRef(({ title, content, date }, ref) => {
  return (
    <div className="note-print-wrapper">
      <div className="note-print-container" ref={ref}>
        <div className="note-print-header">
          <h1 className="note-print-title">{title}</h1>
          <div className="note-print-meta">
            {date && (
              <span className="note-print-date">
                Generated on: {new Date(date).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        
        <div className="note-print-content">
          {/* Re-use the existing MarkdownContent but styling will be forced to light mode in CSS */}
          <MarkdownContent content={content} />
        </div>
      </div>
    </div>
  );
});

NotePrintTemplate.displayName = "NotePrintTemplate";

export default NotePrintTemplate;
