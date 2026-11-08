import { edgeCache, readProperty, type PropertyEnv } from "../../server/properties";

// GET /api/properties?domain=…: site checks for a website property dashboard. Behind Access like every route.
export const onRequestGet = ({ request, env, waitUntil }: { request: Request; env: PropertyEnv; waitUntil: (p: Promise<unknown>) => void }) => readProperty(request, env, edgeCache(), fetch, { waitUntil });

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
