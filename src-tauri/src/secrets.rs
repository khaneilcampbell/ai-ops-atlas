//! GitHub token storage in the OS credential store (the macOS Keychain on a Mac).
//! The token is written from the settings screen and read only by the GitHub client;
//! no command returns it to the web view.

use keyring::Entry;

const SERVICE: &str = "com.khaneilcampbell.ai-ops-atlas";
const ACCOUNT: &str = "github-token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keychain unavailable: {e}"))
}

pub fn read_token() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

/// Accepts the documented GitHub token formats so a pasted typo fails early.
fn looks_like_token(t: &str) -> bool {
    const PREFIXES: [&str; 5] = ["github_pat_", "ghp_", "gho_", "ghu_", "ghs_"];
    PREFIXES.iter().any(|p| t.starts_with(p))
        && (20..=255).contains(&t.len())
        && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[tauri::command]
pub fn github_token_status() -> bool {
    read_token().is_some()
}

#[tauri::command]
pub fn github_token_set(token: String) -> Result<(), String> {
    let token = token.trim();
    if !looks_like_token(token) {
        return Err("That doesn't look like a GitHub token. Expected one starting with github_pat_ or ghp_.".into());
    }
    entry()?
        .set_password(token)
        .map_err(|e| format!("Could not save to the Keychain: {e}"))
}

#[tauri::command]
pub fn github_token_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the token: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::looks_like_token;

    #[test]
    fn token_shapes() {
        assert!(looks_like_token("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        assert!(looks_like_token("github_pat_11ABCDEFG0123456789_abcdefghijklmnop"));
        assert!(!looks_like_token("hello"));
        assert!(!looks_like_token("ghp_has space inside_xxxxxxxxxxxxxxxx"));
    }
}
