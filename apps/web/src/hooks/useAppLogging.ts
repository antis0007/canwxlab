import { useEffect } from "react";
import { api } from "../lib/api";
import { logManager } from "../lib/logging";

export function useAppLogging() {
  useEffect(() => {
    logManager.info("app", "CanWxLab workstation launched", {
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });

    const checkApiHealth = async () => {
      try {
        await api.sourceStatus();
        logManager.info("api", "API connected successfully");
      } catch (err) {
        logManager.error("api", "API unavailable", { error: String(err) });
      }
    };

    checkApiHealth();
    const interval = setInterval(checkApiHealth, 30000);

    return () => clearInterval(interval);
  }, []);
}
