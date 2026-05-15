import { useEffect, useState, useRef } from "react";
import { logManager, type LogEntry, type LogSeverity, type LogSubsystem } from "../../lib/logging";

export function ConsolePanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filterSeverity, setFilterSeverity] = useState<LogSeverity | "all">("all");
  const [filterSubsystem, setFilterSubsystem] = useState<LogSubsystem | "all">("all");
  const [searchText, setSearchText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    setEntries(logManager.getEntries());

    const unsubscribe = logManager.subscribe((entry) => {
      setEntries((prev) => [...prev.slice(-499), entry]);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const filtered = entries.filter((entry) => {
    if (filterSeverity !== "all" && entry.severity !== filterSeverity) return false;
    if (filterSubsystem !== "all" && entry.subsystem !== filterSubsystem) return false;
    if (searchText && !entry.message.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const severityColors: Record<LogSeverity, string> = {
    debug: "#888",
    info: "#0cf",
    warn: "#fa0",
    error: "#f00",
  };

  const handleCopyLogs = () => {
    const exported = logManager.export();
    navigator.clipboard.writeText(exported);
  };

  return (
    <div className="wb-scroll-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <h3>Console</h3>

      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value as LogSeverity | "all")}
          className="wb-select"
          style={{ flex: "0 0 auto" }}
        >
          <option value="all">All Levels</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>

        <select
          value={filterSubsystem}
          onChange={(e) => setFilterSubsystem(e.target.value as LogSubsystem | "all")}
          className="wb-select"
          style={{ flex: "0 0 auto" }}
        >
          <option value="all">All Systems</option>
          <option value="app">App</option>
          <option value="api">API</option>
          <option value="wms">WMS</option>
          <option value="layer">Layer</option>
          <option value="timeline">Timeline</option>
          <option value="plugin">Plugin</option>
          <option value="simulation">Simulation</option>
          <option value="verification">Verification</option>
        </select>

        <input
          type="text"
          placeholder="Search..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="wb-input"
          style={{ flex: "1 1 auto", minWidth: "100px" }}
        />

        <label className="wb-checkbox" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>

        <button onClick={() => logManager.clear()} className="wb-button">
          Clear
        </button>

        <button onClick={handleCopyLogs} className="wb-button">
          Export
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "monospace",
          fontSize: "0.75rem",
          backgroundColor: "#1a1a1a",
          padding: "8px",
          borderRadius: "4px",
          border: "1px solid #333",
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: "#666" }}>No logs to display</div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} style={{ marginBottom: "2px", wordBreak: "break-all" }}>
              <span style={{ color: severityColors[entry.severity] }}>
                {entry.timestamp.toLocaleTimeString()}.{String(entry.timestamp.getMilliseconds()).padStart(3, "0")}
              </span>
              {" "}
              <span style={{ color: "#888" }}>[{entry.subsystem}]</span>
              {" "}
              <span style={{ color: severityColors[entry.severity], fontWeight: "bold" }}>
                {entry.severity.toUpperCase()}
              </span>
              {": "}
              <span style={{ color: "#ccc" }}>{entry.message}</span>
              {entry.details && (
                <div style={{ marginLeft: "20px", color: "#666", fontSize: "0.7rem" }}>
                  {JSON.stringify(entry.details, null, 2)}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
