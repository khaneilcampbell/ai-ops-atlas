import { edgeCache, readPropertyForApp, type PropertyEnv } from "../../../server/properties";

// GET /api/hooks/properties?domain=…: the same site checks for the Mac app, with its sync key instead of Access.
export const onRequestGet = ({ request, env, waitUntil }: { request: Request; env: PropertyEnv; waitUntil: (p: Promise<unknown>) => void }) => readPropertyForApp(request, env, edgeCache(), fetch, { waitUntil });

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
