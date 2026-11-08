//! GitHub Steward's read policy. The Steward may read one repository through seven fixed
//! endpoints, GET only, with no ETag cache. The rule lives here rather than in the web view,
//! so a change to the panel's code can't widen what the Steward reaches with the read token.

/// The only repository the Steward observes.
pub const REPO: &str = "khaneilcampbell/ai-ops-atlas";

/// A branch name as the panel encodes it: no traversal, no separators but encoded ones.
fn branch_ok(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 100
        && !b.contains("..")
        && b.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-%".contains(c))
}

/// True only for the Steward's seven reads of `REPO`.
pub fn allowed(path: &str) -> bool {
    let Some(rest) = path.strip_prefix(&format!("/repos/{REPO}")) else {
        return false;
    };
    match rest {
        "" | "/readme" | "/contents/.github/dependabot.yml" => true,
        "/dependabot/alerts?state=open&per_page=20" => true,
        "/code-scanning/alerts?state=open&per_page=20" => true,
        _ => {
            if let Some(b) = rest.strip_prefix("/commits/") {
                branch_ok(b)
            } else if let Some(b) = rest.strip_prefix("/actions/runs?per_page=30&branch=") {
                branch_ok(b)
            } else {
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::allowed;

    const R: &str = "/repos/khaneilcampbell/ai-ops-atlas";

    #[test]
    fn allows_the_seven_reads() {
        for suffix in [
            "",
            "/commits/main",
            "/actions/runs?per_page=30&branch=main",
            "/dependabot/alerts?state=open&per_page=20",
            "/code-scanning/alerts?state=open&per_page=20",
            "/readme",
            "/contents/.github/dependabot.yml",
            "/commits/release%2F1.0",
        ] {
            assert!(allowed(&format!("{R}{suffix}")), "{suffix}");
        }
    }

    #[test]
    fn blocks_other_repositories_endpoints_and_tricks() {
        for path in [
            "/repos/khaneilcampbell/other",
            "/repos/khaneilcampbell/ai-ops-atlas-fork",
            "/repos/khaneilcampbell/ai-ops-atlas/pulls",
            "/repos/khaneilcampbell/ai-ops-atlas/secret-scanning/alerts",
            "/repos/khaneilcampbell/ai-ops-atlas/dependabot/alerts?state=open&per_page=100",
            "/repos/khaneilcampbell/ai-ops-atlas/contents/src/main.rs",
            "/repos/khaneilcampbell/ai-ops-atlas/commits/../../other",
            "/repos/khaneilcampbell/ai-ops-atlas/commits/main/../x",
            "/repos/khaneilcampbell/ai-ops-atlas/commits/",
            "/repos/khaneilcampbell/ai-ops-atlas/actions/runs?per_page=30&branch=main&per_page=100",
            "/repos/khaneilcampbell/ai-ops-atlas/merges",
            "/user/repos",
            "https://api.github.com/repos/khaneilcampbell/ai-ops-atlas",
        ] {
            assert!(!allowed(path), "{path}");
        }
    }
}
