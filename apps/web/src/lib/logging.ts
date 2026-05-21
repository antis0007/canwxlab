export type LogSeverity = "debug" | "info" | "warn" | "error";
export type LogSubsystem = "app" | "api" | "wms" | "layer" | "timeline" | "plugin" | "simulation" | "verification" | "satellite";

export interface LogEntry {
  id: string;
  timestamp: Date;
  severity: LogSeverity;
  subsystem: LogSubsystem;
  message: string;
  details?: Record<string, unknown>;
}

interface LogListener {
  (entry: LogEntry): void;
}

class LogManager {
  private entries: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private maxEntries = 500;
  private entryId = 0;

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  log(
    severity: LogSeverity,
    subsystem: LogSubsystem,
    message: string,
    details?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      id: String(++this.entryId),
      timestamp: new Date(),
      severity,
      subsystem,
      message,
      details,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.listeners.forEach((listener) => listener(entry));

    if (details !== undefined) {
      if (severity === "error" || severity === "warn") {
        console[severity](`[${subsystem}] ${message}`, details);
      } else {
        console.log(`[${subsystem}] ${message}`, details);
      }
    } else {
      if (severity === "error" || severity === "warn") {
        console[severity](`[${subsystem}] ${message}`);
      } else {
        console.log(`[${subsystem}] ${message}`);
      }
    }
  }

  debug(subsystem: LogSubsystem, message: string, details?: Record<string, unknown>): void {
    this.log("debug", subsystem, message, details);
  }

  info(subsystem: LogSubsystem, message: string, details?: Record<string, unknown>): void {
    this.log("info", subsystem, message, details);
  }

  warn(subsystem: LogSubsystem, message: string, details?: Record<string, unknown>): void {
    this.log("warn", subsystem, message, details);
  }

  error(subsystem: LogSubsystem, message: string, details?: Record<string, unknown>): void {
    this.log("error", subsystem, message, details);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}

export const logManager = new LogManager();
