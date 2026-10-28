import { editStatus, proposeEdit, type EditEnv } from "../../server/edit";

// GET /api/edit: whether the site may open edit pull requests, and on which repositories.
// POST /api/edit: open one. Behind Access like every route; see server/edit.ts.
export const onRequestGet = ({ env }: { env: EditEnv }) => editStatus(env);

export const onRequestPost = ({ request, env }: { request: Request; env: EditEnv }) => proposeEdit(request, env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
