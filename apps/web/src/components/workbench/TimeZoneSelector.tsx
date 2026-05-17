// Quick-select time zone picker shown in the TopBar. Click the chip to
// open a small popover with a search box and a curated list of zones.
// Selection persists via lib/timezone.ts and updates the TopBar VALID,
// the BottomTimeline cursor readout, and the RightInspector station-
// time row in one shot.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMMON_TIME_ZONES,
  browserDefaultTimeZone,
  isValidTimeZone,
  utcOffsetLabel,
} from "../../lib/timezone";

interface TimeZoneSelectorProps {
  value: string;
  onChange: (zone: string) => void;
  /** ms anchor used to render the live UTC-offset label for each option. */
  refMs: number;
}

export function TimeZoneSelector({ value, onChange, refMs }: TimeZoneSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const browserTz = useMemo(() => browserDefaultTimeZone(), []);

  const offsetLabel = useMemo(() => utcOffsetLabel(value, refMs) || value, [value, refMs]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return COMMON_TIME_ZONES;
    return COMMON_TIME_ZONES.filter((option) => {
      return (
        option.id.toLowerCase().includes(term)
        || option.label.toLowerCase().includes(term)
        || option.hint.toLowerCase().includes(term)
      );
    });
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const pick = (zone: string) => {
    onChange(zone);
    setOpen(false);
    setQuery("");
  };

  const tryCommitTyped = () => {
    const trimmed = query.trim();
    if (trimmed && isValidTimeZone(trimmed)) pick(trimmed);
  };

  return (
    <div className="wb-tz-picker" ref={popoverRef}>
      <button
        type="button"
        className={`wb-tz-chip${open ? " is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        title={`Active time zone: ${value} (${offsetLabel})`}
      >
        <span className="wb-tz-chip-label">TZ</span>
        <span className="wb-tz-chip-value">{offsetLabel}</span>
      </button>
      {open && (
        <div className="wb-tz-popover" role="dialog" aria-label="Select time zone">
          <input
            ref={inputRef}
            className="wb-tz-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search city or IANA zone…"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (filtered.length > 0) pick(filtered[0].id);
                else tryCommitTyped();
              }
            }}
          />
          <div className="wb-tz-quick-row">
            <button type="button" onClick={() => pick("UTC")} className={value === "UTC" ? "is-active" : ""}>UTC</button>
            <button
              type="button"
              onClick={() => pick(browserTz)}
              className={value === browserTz ? "is-active" : ""}
              title={`Browser default: ${browserTz}`}
            >
              Local ({browserTz.split("/").pop() ?? browserTz})
            </button>
          </div>
          <div className="wb-tz-list">
            {filtered.map((option) => {
              const isActive = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`wb-tz-option${isActive ? " is-active" : ""}`}
                  onClick={() => pick(option.id)}
                  title={option.hint}
                >
                  <span className="wb-tz-option-label">{option.label}</span>
                  <span className="wb-tz-option-offset">{utcOffsetLabel(option.id, refMs)}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="wb-tz-empty">
                No match. Press Enter to use the typed value if it is a valid IANA zone.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
