"""Bounded GET-only GitHub evidence collector. No model calls or repository writes."""
import argparse
import json
import re
import subprocess
import time
from pathlib import Path


def collect(policy_path):
    policy = json.loads(policy_path.read_text())
    if not policy.get("enabled") or policy.get("mode") != "observe":
        raise ValueError("Collector requires enabled=true and mode=observe")
    repos = policy.get("repositories", [])
    if not repos or len(repos) != len(set(repos)) or len(repos) > policy["maxRepositoriesPerRun"]:
        raise ValueError("Provide a nonempty unique repository allowlist within the limit")
    if any(not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", r) for r in repos):
        raise ValueError("Repositories must be owner/name")
    stop = policy_path.parent / policy["stopFile"]
    started = time.monotonic()
    requests = 0
    report = {"mode": "observe", "repositories": [], "billing": "unavailable; no paid calls made"}

    def get(endpoint):
        nonlocal requests
        if stop.exists():
            raise ValueError("Stop file is present")
        remaining = policy["maxRunSeconds"] - (time.monotonic() - started)
        if remaining <= 0 or requests >= policy["maxRequestsPerRun"]:
            raise ValueError("Run budget exhausted")
        requests += 1
        try:
            result = subprocess.run(
                ["gh", "api", "--method", "GET", "--hostname", "github.com", endpoint],
                capture_output=True, text=True,
                timeout=min(remaining, policy["requestTimeoutSeconds"]), check=False,
            )
            if result.returncode:
                return {"status": "unavailable", "reason": "GitHub request failed; check access and API availability"}
            return {"status": "observed", "data": json.loads(result.stdout)}
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            return {"status": "unavailable", "reason": "Request timed out or returned invalid JSON"}

    for repo in repos:
        base = f"repos/{repo}"
        report["repositories"].append({
            "repository": repo,
            "metadata": get(base),
            "recent_runs": get(base + "/actions/runs?per_page=10"),
            "dependabot_alerts": get(base + "/dependabot/alerts?state=open&per_page=20"),
            "code_scanning_alerts": get(base + "/code-scanning/alerts?state=open&per_page=20"),
        })
    report["requests"] = requests
    report["coverage"] = "Bounded first pages only; no logs, secrets, code execution, billing or complete security audit"
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=Path(__file__).with_name("policy.json"))
    args = parser.parse_args()
    try:
        print(json.dumps(collect(args.policy), indent=2))
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"Stopped: {error}\n")
