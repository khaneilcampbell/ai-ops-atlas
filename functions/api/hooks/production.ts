import { receiveProduction, type LiveEnv } from '../../../server/live';
export const onRequestPost = ({ request, env }: { request: Request; env: LiveEnv }) => receiveProduction(request, env);
export const onRequest = () => Response.json({ message: 'Use POST.' }, { status: 405, headers: { allow: 'POST' } });
