import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import base from "../vite.config";
import { sampleGithub, sampleSite } from "./propertiesFixtures";

// A click-around preview of the website dashboards with sample data, for looking before a merge:
//   npm run preview:properties   then open http://localhost:5182 (or the Mac's address on a phone).
// The page runs as the hosted web build; this dev server answers its /api calls with the same
// sample answers the screenshot check uses, so nothing reaches GitHub, Cloudflare or the sites.

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

const sampleApi = (): Plugin => ({
  name: "atlas-sample-api",
  configureServer(server) {
    server.middlewares.use(
      "/api",
      (req: IncomingMessage, res: ServerResponse) => {
        const u = new URL(req.url ?? "/", "http://preview");
        if (u.pathname === "/properties")
          return send(
            res,
            200,
            sampleSite(u.searchParams.get("domain") ?? "", Date.now()),
          );
        if (u.pathname.startsWith("/github/")) {
          const body = sampleGithub(
            u.pathname.slice("/github".length) + u.search,
            Date.now(),
          );
          return send(
            res,
            body == null ? 404 : 200,
            body ?? { message: "Not Found" },
          );
        }
        send(res, 404, { message: "Not in the sample preview." });
      },
    );
  },
});

export default mergeConfig(
  base,
  defineConfig({
    plugins: [sampleApi()],
    define: { "import.meta.env.VITE_ATLAS_WEB": JSON.stringify("1") },
    server: { port: 5182, strictPort: true, host: true },
  }),
);
