import { fetchSales, salesStatus, type SalesEnv } from "../../../server/stripeSales";

// POST /api/n8n/sales: Stripe sales in a date range, read by the n8n sales feed. GET: is it set up. Behind Access.
export const onRequestPost = ({ request, env }: { request: Request; env: SalesEnv }) => fetchSales(request, env);
export const onRequestGet = ({ env }: { env: SalesEnv }) => salesStatus(env);

export const onRequest = () => Response.json({ message: "Use GET or POST." }, { status: 405, headers: { allow: "GET, POST" } });
