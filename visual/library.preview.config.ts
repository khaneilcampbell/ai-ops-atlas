import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import base from "../vite.config";
import type { D1, D1Statement } from "../server/live";
import { ingestOutputs, receiveOutputs, routeOutputs, type Bucket, type OutputsEnv } from "../server/outputs";
import { LIBRARY_DEV_TOKEN, librarySamples } from "./libraryFixtures";

// A click-around preview of the Output Library, for looking before a merge:
//   npm run preview:library   then open http://localhost:5226 and press Library in the map toolbar.
// The page runs as the hosted web build. This dev server answers /api/outputs with the real server
// code (server/outputs.ts) on an in-memory SQLite database and an in-memory bucket, seeded with
// development examples through the real ingest path. Every record is marked as an example and the
// drawer says so; nothing here is Atlas storage, and nothing persists after the server stops.
// POST more with: curl -X POST localhost:5226/api/hooks/outputs -H "authorization: Bearer <LIBRARY_DEV_TOKEN>" -d @body.json
// LIBRARY_PREVIEW_STORAGE=off previews the "file storage not connected" state.

function sqliteD1(): D1 {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    all: async <T,>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

function memoryBucket(): Bucket & { failNext: number } {
  const objects = new Map<string, Uint8Array>();
  const b = {
    failNext: 0,
    async put(key: string, value: Uint8Array) {
      if (b.failNext > 0) {
        b.failNext--;
        throw new Error("Preview storage refused the write (simulated outage)");
      }
      objects.set(key, value.slice());
    },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const v = objects.get(key);
      if (!v) return null;
      const bytes = options?.range ? v.slice(options.range.offset, options.range.offset + options.range.length) : v.slice();
      return { body: new Response(bytes).body!, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
    },
  };
  return b;
}

const libraryApi = (): Plugin => {
  const bucket = memoryBucket();
  const env: OutputsEnv = { LIVE: sqliteD1(), AGENT_FEED_TOKEN: LIBRARY_DEV_TOKEN, LIBRARY_ENV: "development", ...(process.env.LIBRARY_PREVIEW_STORAGE === "off" ? {} : { OUTPUTS: bucket }) };
  const opts = { sample: true, sleep: async () => {} };
  const seeded = (async () => {
    for (const s of librarySamples(Date.now())) {
      bucket.failNext = s.failStorage ? 100 : 0;
      await ingestOutputs(env, s.body, { ...opts, now: () => Date.parse(s.body.source.producedAt ?? new Date().toISOString()) });
    }
    bucket.failNext = 0;
  })();
  return {
    name: "atlas-library-preview-api",
    configureServer(server) {
      server.middlewares.use("/api", async (req: IncomingMessage, res: ServerResponse) => {
        await seeded;
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const url = `http://preview/api${req.url ?? "/"}`;
        const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: chunks.length && req.method !== "GET" ? Buffer.concat(chunks) : undefined });
        const path = new URL(url).pathname;
        let out: Response;
        if (path === "/api/hooks/outputs" && req.method === "POST") out = await receiveOutputs(request, env, opts);
        else if (path.startsWith("/api/outputs")) out = await routeOutputs(request, env, opts);
        else out = Response.json({ message: "Not in the Library preview." }, { status: 404 });
        res.statusCode = out.status;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await out.arrayBuffer()));
      });
    },
  };
};

export default mergeConfig(
  base,
  defineConfig({
    plugins: [libraryApi()],
    define: { "import.meta.env.VITE_ATLAS_WEB": JSON.stringify("1") },
    server: { port: Number(process.env.PORT ?? 5226), strictPort: true, host: true },
  }),
);
