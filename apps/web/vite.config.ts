import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function suppressBrokenSourceMaps(): Plugin {
  return {
    name: "suppress-broken-sourcemaps",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url.includes("/.vite/deps/") && url.endsWith(".js.map")) {
          const origEnd = res.end.bind(res) as typeof res.end;
          res.end = function (...args: unknown[]) {
            const body = args[0];
            if (typeof body === "string") {
              try {
                const parsed = JSON.parse(body);
                if (
                  !Array.isArray(parsed.sources) ||
                  parsed.sources.length === 0
                ) {
                  res.setHeader("Content-Type", "application/json");
                  return origEnd(
                    JSON.stringify({
                      version: 3,
                      sources: ["(no-source)"],
                      mappings: "",
                    }),
                  );
                }
              } catch {
                /* pass through */
              }
            }
            return origEnd.apply(res, args as Parameters<typeof origEnd>);
          } as typeof res.end;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), suppressBrokenSourceMaps()],
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
  test: {
    environment: "node",
  },
});
