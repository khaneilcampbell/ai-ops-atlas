import { answer } from "./github";

// Sample answers for the website dashboards: what /api/properties and the GitHub proxy return for
// benjaire.com (newest Workers Builds deploy failed, certificate ten days from its end) and
// khaneilcampbell.com (healthy; Cloudflare and Uptime Kuma not connected). Used by the screenshot
// check (properties.web.ts) and by the click-around preview (npm run preview:properties).

const ok = <T>(source: string, checkedAt: string, data: T) => ({
  state: "ok",
  source,
  checkedAt,
  data,
});
const none = (source: string, need: string) => ({
  state: "not-configured",
  source,
  need,
});

export function sampleSite(domain: string, now: number) {
  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const ahead = (d: number) => new Date(now + d * 86_400_000).toISOString();
  const broken = domain === "benjaire.com";
  const at = ago(0.1);
  return {
    domain,
    checks: {
      domain: ok("RDAP (rdap.org)", at, {
        registrar: "Cloudflare, Inc.",
        registeredAt: "2025-04-02T00:00:00.000Z",
        expiresAt: ahead(broken ? 150 : 290),
        updatedAt: null,
        status: ["client transfer prohibited"],
        nameservers: ["adam.ns.cloudflare.com", "nova.ns.cloudflare.com"],
        dnssec: false,
      }),
      dns: ok("Cloudflare DNS over HTTPS", at, {
        a: ["104.21.32.1", "172.67.160.1"],
        aaaa: ["2606:4700:3030::1"],
        ns: ["adam.ns.cloudflare.com", "nova.ns.cloudflare.com"],
        mx: ["10 route1.mx.cloudflare.net"],
        caa: [],
        www: [domain],
        validated: false,
      }),
      tls: ok("Certificate Transparency logs (crt.sh)", at, {
        issuer: broken ? "Google Trust Services" : "Let's Encrypt",
        notBefore: ago(24 * 80),
        notAfter: ahead(broken ? 10 : 61),
        names: [domain, `www.${domain}`],
        current: 1,
      }),
      probe: ok("HTTPS request", at, {
        status: 200,
        ms: broken ? 184 : 96,
        finalUrl: `https://${domain}/`,
        cloudflare: broken,
        hsts: broken,
      }),
      performance: ok("Google PageSpeed Insights, mobile", at, {
        strategy: "mobile",
        score: broken ? 78 : 97,
        lcpMs: broken ? 2900 : 1200,
        cls: 0.02,
        tbtMs: 60,
        field: null,
        reportUrl: `https://pagespeed.web.dev/analysis?url=https%3A%2F%2F${domain}%2F`,
      }),
      traffic: none(
        "Cloudflare analytics",
        "A read-only Cloudflare API token on the site (CLOUDFLARE_API_TOKEN).",
      ),
      edgeEvents: none(
        "Cloudflare audit log",
        "A read-only Cloudflare API token on the site (CLOUDFLARE_API_TOKEN).",
      ),
      uptime: none(
        "Uptime Kuma",
        "The address of Khaneil's Uptime Kuma and a public status page (UPTIME_KUMA_URL).",
      ),
    },
  };
}

/** GitHub answers, with the two sites' deploys added. */
export function sampleGithub(path: string, now: number): unknown {
  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const checks =
    /^\/repos\/khaneilcampbell\/benjaire\.com\/commits\/([0-9a-f]+)\/check-runs/.exec(
      path,
    );
  if (checks) {
    const newest = (
      answer("/repos/khaneilcampbell/benjaire.com/commits") as { sha: string }[]
    )[0].sha;
    const failed = checks[1] === newest;
    return {
      total_count: 1,
      check_runs: [
        {
          id: failed ? 71 : 70,
          name: "Workers Builds: benjaire-com",
          status: "completed",
          conclusion: failed ? "failure" : "success",
          started_at: ago(failed ? 0.6 : 5),
          completed_at: ago(failed ? 0.5 : 4.9),
          details_url: "https://dash.cloudflare.com/builds/71",
        },
      ],
    };
  }
  if (
    /^\/repos\/khaneilcampbell\/khaneilcampbell\.com\/deployments\?/.test(path)
  )
    return [
      {
        id: 501,
        sha: "c0ffee1".padEnd(40, "0"),
        environment: "github-pages",
        created_at: ago(26),
      },
    ];
  if (
    /^\/repos\/khaneilcampbell\/khaneilcampbell\.com\/deployments\/501\/statuses/.test(
      path,
    )
  )
    return [
      {
        state: "success",
        created_at: ago(25.9),
        log_url:
          "https://github.com/khaneilcampbell/khaneilcampbell.com/actions/runs/1",
      },
    ];
  return answer(path);
}
