import { useLayoutEffect, useRef, useState } from "react";

/** Collapsible long-text block: clamps to a few lines with a downtick toggle
 * that appears only when the content actually overflows. Reusable anywhere
 * the UI would otherwise clip long content (alert zone lists, analysis
 * values, descriptions). */
export interface ExpandableTextProps {
  text: string;
  /** Lines shown while collapsed. */
  collapsedLines?: number;
  className?: string;
}

export function ExpandableText({ text, collapsedLines = 3, className }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Measure against the clamped height; +1 tolerates subpixel rounding.
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, collapsedLines, expanded]);

  return (
    <div className={`wb-expandable${className ? ` ${className}` : ""}`}>
      <div
        ref={bodyRef}
        className="wb-expandable-body"
        style={expanded ? undefined : ({
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: collapsedLines,
          overflow: "hidden",
        } as React.CSSProperties)}
      >
        {text}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          className="wb-expandable-toggle"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          {expanded ? "▴ less" : "▾ more"}
        </button>
      )}
    </div>
  );
}
