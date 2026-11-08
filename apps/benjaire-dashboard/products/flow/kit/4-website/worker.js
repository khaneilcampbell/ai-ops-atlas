// Benjaire Flow v1.0 form endpoint for Cloudflare Workers.
// Receives your website form, blocks bots, validates the fields and forwards
// the inquiry to Flow 1 with the secret intake key. If Flow cannot be reached,
// it emails you the inquiry through Resend so nothing is lost.
// Setup: guides/cloudflare.md
//
// Variables and secrets:
//   FLOW_INTAKE_URL        https://YOUR-N8N/webhook/flow-intake
//   FLOW_INTAKE_KEY        secret: the intake_key from flow_settings
//   ALLOWED_ORIGINS        https://acme.com,https://www.acme.com
//   THANK_YOU_URL          page to redirect to after a normal form post
//   TURNSTILE_SECRET_KEY   secret, optional: turns on bot protection
//   RESEND_API_KEY         secret, optional: turns on the offline fallback
//   FALLBACK_FROM          optional: Website <hello@acme.com>
//   FALLBACK_TO            optional: where fallback emails go

const LIMITS = { name: 120, email: 200, company: 160, phone: 40, message: 5000, messageMin: 10, body: 20000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const line = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const body = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, "").trim().slice(0, max);

function reply(req, env, status, data) {
  const wantsJson = (req.headers.get("Accept") || "").includes("application/json");
  if (!wantsJson && env.THANK_YOU_URL) {
    const url = new URL(env.THANK_YOU_URL);
    if (!data.ok) url.searchParams.set("status", "error");
    return Response.redirect(url.toString(), 303);
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

async function humanCheck(token, env, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const out = await res.json();
    return out.success === true;
  } catch {
    return false;
  }
}

async function sendToFlow(payload, env) {
  try {
    const res = await fetch(env.FLOW_INTAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-flow-key": env.FLOW_INTAKE_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    if (res.status === 422) return { ok: false, invalid: true };
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0 };
  }
}

async function fallbackEmail(payload, env, reason) {
  if (!env.RESEND_API_KEY || !env.FALLBACK_FROM || !env.FALLBACK_TO) return false;
  const text = [
    "Flow could not be reached (" + reason + "), so this inquiry was emailed directly.",
    "It is NOT saved in Flow. Reply from here or add it by hand.",
    "",
    "Name:    " + payload.name,
    "Email:   " + payload.email,
    "Company: " + (payload.company || "(not given)"),
    "Phone:   " + (payload.phone || "(not given)"),
    "Source:  " + payload.source,
    "",
    payload.message
  ].join("\n");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY },
      body: JSON.stringify({
        from: env.FALLBACK_FROM,
        to: [env.FALLBACK_TO],
        reply_to: payload.email,
        subject: "[Fallback] New inquiry: " + payload.name,
        text
      }),
      signal: AbortSignal.timeout(10000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(req.headers.get("Origin") || "")) {
      return reply(req, env, 403, { ok: false, error: "This form can only be sent from our website." });
    }
    if (Number(req.headers.get("Content-Length") || 0) > LIMITS.body) {
      return reply(req, env, 413, { ok: false, error: "Your message is too long." });
    }

    let form;
    try { form = await req.formData(); } catch { return reply(req, env, 400, { ok: false, error: "The form could not be read. Please try again." }); }

    // Honeypot: people never see this field. Pretend success for bots.
    if (line(form.get("website"), 200)) return reply(req, env, 200, { ok: true });

    const ip = req.headers.get("CF-Connecting-IP");
    if (!(await humanCheck(String(form.get("cf-turnstile-response") || ""), env, ip))) {
      return reply(req, env, 400, { ok: false, error: "We could not confirm you are not a robot. Please try again." });
    }

    const payload = {
      name: line(form.get("name"), LIMITS.name),
      email: line(form.get("email"), LIMITS.email).toLowerCase(),
      company: line(form.get("company"), LIMITS.company),
      phone: line(form.get("phone"), LIMITS.phone),
      message: body(form.get("message"), LIMITS.message),
      source: line(form.get("source") || "website", 40).replace(/[^a-z0-9_-]/gi, "") || "website",
      website: ""
    };
    if (!payload.name || !EMAIL_RE.test(payload.email) || payload.message.length < LIMITS.messageMin) {
      return reply(req, env, 422, { ok: false, error: "Please include your name, a valid email and a short message." });
    }

    const result = await sendToFlow(payload, env);
    if (result.ok) return reply(req, env, 200, { ok: true });
    if (result.invalid) return reply(req, env, 422, { ok: false, error: "Please include a valid email and a message of at least 10 characters." });

    const reason = result.status ? "HTTP " + result.status : "no response";
    console.error("Flow intake failed:", reason);
    if (await fallbackEmail(payload, env, reason)) return reply(req, env, 200, { ok: true });
    return reply(req, env, 502, { ok: false, error: "Your message could not be sent. Please email us directly." });
  }
};
