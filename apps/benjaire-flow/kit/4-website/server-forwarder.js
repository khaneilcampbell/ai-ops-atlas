// Benjaire Flow: forward your website form from your own Node server.
// Use this instead of the Cloudflare Worker if your site already has a backend.
// Requires Node 18 or newer (built in fetch) and Express.
//
//   FLOW_INTAKE_URL=https://YOUR-N8N/webhook/flow-intake
//   FLOW_INTAKE_KEY=your intake_key   (keep it in the environment, never in page source)

const express = require("express");
const router = express.Router();

const line = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const FAIL = { ok: false, error: "Your message could not be sent. Please email us directly." };

router.post("/api/contact", express.urlencoded({ extended: false, limit: "20kb" }), express.json({ limit: "20kb" }), async (req, res) => {
  const b = req.body || {};
  if (line(b.website, 200)) return res.json({ ok: true }); // honeypot: bots fill it, people never see it

  const payload = {
    name: line(b.name, 120),
    email: line(b.email, 200).toLowerCase(),
    company: line(b.company, 160),
    phone: line(b.phone, 40),
    message: String(b.message ?? "").trim().slice(0, 5000),
    source: line(b.source || "website", 40),
    website: ""
  };
  if (!payload.name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email) || payload.message.length < 10) {
    return res.status(422).json({ ok: false, error: "Please include your name, a valid email and a short message." });
  }

  try {
    const r = await fetch(process.env.FLOW_INTAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-flow-key": process.env.FLOW_INTAKE_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    if (r.ok) return res.json({ ok: true });
    return res.status(r.status === 422 ? 422 : 502).json(FAIL);
  } catch (err) {
    console.error("Flow intake failed:", err.message);
    return res.status(502).json(FAIL);
  }
});

module.exports = router;
// In your app: app.use(require("./server-forwarder"));
