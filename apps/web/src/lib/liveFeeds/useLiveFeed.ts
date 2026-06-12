/** React binding for the liveFeeds kernel: one hook per source.
 * Owns the client lifecycle; re-renders only on data/status change. */

import { useEffect, useRef, useState } from "react";

import { FeedClient, type FeedDefinition, type FeedStatus, type LonLatBounds } from "./feedClient";

export interface LiveFeed<T> {
  events: T[];
  status: FeedStatus;
}

const IDLE_STATUS: FeedStatus = {
  state: "idle",
  lastSuccessMs: null,
  lastError: null,
  consecutiveFailures: 0,
};

export function useLiveFeed<T>(
  definition: FeedDefinition<T>,
  enabled: boolean,
  bbox: LonLatBounds | null,
): LiveFeed<T> {
  const [feed, setFeed] = useState<LiveFeed<T>>({ events: [], status: IDLE_STATUS });
  const clientRef = useRef<FeedClient<T> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setFeed({ events: [], status: IDLE_STATUS });
      return;
    }
    const client = new FeedClient<T>(definition, (events, status) => {
      setFeed({ events, status });
    });
    clientRef.current = client;
    client.start();
    return () => {
      client.stop();
      clientRef.current = null;
    };
    // definition objects are module-level constants; identity is stable.
  }, [definition, enabled]);

  useEffect(() => {
    clientRef.current?.setBbox(bbox);
    // Stringify: bbox arrays are rebuilt per render by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox?.join(",")]);

  return feed;
}
