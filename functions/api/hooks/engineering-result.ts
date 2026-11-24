import { forHook, type ExecutiveEnv } from "../../../server/executive/api";

// The repository runner's report job (.github/workflows/atlas-engineer.yml) posts engineering-change/1
// here with ATLAS_ENGINEERING_CALLBACK_TOKEN. No Access session: the key and the dispatch record decide.
export const onRequestPost = ({ request, env }: { request: Request; env: ExecutiveEnv }) => forHook(request, env, "engineering-result");
export const onRequest = () => Response.json({ message: "Use POST." }, { status: 405, headers: { allow: "POST" } });
