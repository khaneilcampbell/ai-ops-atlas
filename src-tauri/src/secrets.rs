//! Credential storage in the OS credential store (the macOS Keychain on a Mac).
//! The GitHub token and the Anthropic API key are written from the settings screen and
//! read only by the Rust clients that use them; no command returns either to the web view.
//! The Actions token (the only credential that can write) has its own Keychain entry and is
//! read only by `actions::client`; the read-only GitHub client never touches it.

use keyring::Entry;

const SERVICE: &str = "com.khaneilcampbell.ai-ops-atlas";
const ACCOUNT: &str = "github-token";
const ANTHROPIC_ACCOUNT: &str = "anthropic-api-key";
const ACTIONS_ACCOUNT: &str = "github-actions-write-token";

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn entry() -> Result<Entry, String> {
    entry_for(ACCOUNT)
}

fn read(account: &str) -> Option<String> {
    entry_for(account)
        .ok()?
        .get_password()
        .ok()
        .filter(|t| !t.is_empty())
}

fn clear(account: &str) -> Result<(), String> {
    match entry_for(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the credential: {e}")),
    }
}

pub fn read_token() -> Option<String> {
    read(ACCOUNT)
}

/// The write-scoped Actions token. Read only by the actions client at request time.
pub fn read_actions_token() -> Option<String> {
    read(ACTIONS_ACCOUNT)
}

/// Checks an Actions token's shape. Only fine-grained tokens are accepted, because classic
/// tokens can't be limited to selected repositories, and it must differ from the read token.
pub fn check_actions_token(token: &str, read_token: Option<&str>) -> Result<(), String> {
    if !(token.starts_with("github_pat_") && looks_like_token(token)) {
        return Err("Use a fine-grained token (starting with github_pat_) limited to the repositories you want to re-run.".into());
    }
    if read_token == Some(token) {
        return Err(
            "That's the read-only token. Create a separate token with Actions: Read and write."
                .into(),
        );
    }
    Ok(())
}

pub fn set_actions_token(token: &str) -> Result<(), String> {
    check_actions_token(token, read_token().as_deref())?;
    entry_for(ACTIONS_ACCOUNT)?
        .set_password(token)
        .map_err(|e| format!("Could not save to the Keychain: {e}"))
}

pub fn clear_actions_token() -> Result<(), String> {
    clear(ACTIONS_ACCOUNT)
}

/// The Anthropic key, read only by the Claude client at request time.
pub fn read_anthropic_key() -> Option<String> {
    read(ANTHROPIC_ACCOUNT)
}

/// Anthropic API keys start with `sk-ant-`; this catches pasting the wrong thing.
fn looks_like_anthropic_key(k: &str) -> bool {
    k.starts_with("sk-ant-")
        && (30..=300).contains(&k.len())
        && k.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn anthropic_key_present() -> bool {
    read_anthropic_key().is_some()
}

#[tauri::command]
pub fn anthropic_key_status() -> bool {
    anthropic_key_present()
}

#[tauri::command]
pub fn anthropic_key_set(key: String) -> Result<(), String> {
    let key = key.trim();
    if !looks_like_anthropic_key(key) {
        return Err(
            "That doesn't look like an Anthropic API key. Expected one starting with sk-ant-."
                .into(),
        );
    }
    entry_for(ANTHROPIC_ACCOUNT)?
        .set_password(key)
        .map_err(|e| format!("Could not save to the Keychain: {e}"))
}

#[tauri::command]
pub fn anthropic_key_clear() -> Result<(), String> {
    clear(ANTHROPIC_ACCOUNT)
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
    clear(ACCOUNT)
}

#[cfg(test)]
mod tests {
    use super::{check_actions_token, looks_like_anthropic_key, looks_like_token};

    #[test]
    fn actions_token_must_be_fine_grained_and_separate() {
        let pat = "github_pat_11ABCDEFG0123456789_abcdefghijklmnop";
        assert!(check_actions_token(pat, None).is_ok());
        assert!(check_actions_token(pat, Some("ghp_other")).is_ok());
        assert!(
            check_actions_token(pat, Some(pat)).is_err(),
            "same as read token"
        );
        assert!(check_actions_token("ghp_abcdefghijklmnopqrstuvwxyz0123456789", None).is_err());
        assert!(check_actions_token("github_pat_short", None).is_err());
    }

    #[test]
    fn token_shapes() {
        assert!(looks_like_token("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        assert!(looks_like_token(
            "github_pat_11ABCDEFG0123456789_abcdefghijklmnop"
        ));
        assert!(!looks_like_token("hello"));
        assert!(!looks_like_token("ghp_has space inside_xxxxxxxxxxxxxxxx"));
    }

    #[test]
    fn anthropic_key_shapes() {
        assert!(looks_like_anthropic_key(
            "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789_-AB"
        ));
        assert!(!looks_like_anthropic_key(
            "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
        ));
        assert!(!looks_like_anthropic_key("sk-ant-short"));
        assert!(!looks_like_anthropic_key(
            "sk-ant-api03-abcdefghijklmnopqrstuvwxyz 0123456789"
        ));
    }
}
