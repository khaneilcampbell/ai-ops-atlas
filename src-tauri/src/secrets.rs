//! Credential storage in the OS credential store (the macOS Keychain on a Mac).
//! The GitHub token and the Anthropic API key are written from the settings screen and
//! read only by the Rust clients that use them; no command returns either to the web view.
//! The Actions token (the only credential that can write) has its own slot and is
//! read only by `actions::client`; the read-only GitHub client never touches it. Merge tokens
//! are the same, one per repository, each in its own slot.
//!
//! All four secrets live in one Keychain item and are read once per launch, after a Touch ID
//! check (or the Mac's password if Touch ID isn't available), then kept in memory until Atlas
//! quits. Before this, every GitHub request read the Keychain again, and each self-update gave
//! the app a new code signature the Keychain didn't recognise, so macOS asked for the login
//! password over and over.
//!
//! Installing an update hands the unlocked secrets straight to the new copy (see `handoff`), so
//! the restart needs neither Touch ID nor the Keychain. The new copy then saves the vault again
//! as its own item, because Keychain items made by apps without an Apple team ID are tied to
//! the exact build (its cdhash), so every update would otherwise ask for the login password
//! once more at the next launch.

use std::collections::BTreeMap;
use std::sync::Mutex;

use keyring::Entry;
use serde::Serialize;

const SERVICE: &str = "com.khaneilcampbell.ai-ops-atlas";
const ACCOUNT: &str = "github-token";
const ANTHROPIC_ACCOUNT: &str = "anthropic-api-key";
const ACTIONS_ACCOUNT: &str = "github-actions-write-token";
const USAGE_SYNC_ACCOUNT: &str = "usage-sync-key";
/// Manage agents: enable, disable and run the allow-listed agent workflows.
const AGENTS_ACCOUNT: &str = "github-agents-token";
/// One slot per repository: `github-merge-token:owner/name`, lowercase.
const MERGE_PREFIX: &str = "github-merge-token:";
/// The single item holding all of the above as JSON.
const VAULT_ACCOUNT: &str = "vault";
/// The separate items older versions wrote, moved into the vault on first unlock.
const LEGACY_ACCOUNTS: [&str; 4] = [
    ACCOUNT,
    ANTHROPIC_ACCOUNT,
    ACTIONS_ACCOUNT,
    USAGE_SYNC_ACCOUNT,
];

type Secrets = BTreeMap<String, String>;

/// Where the vault is kept. The Keychain in the app, a map in tests.
trait Store {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    fn remove(&self, account: &str) -> Result<(), String>;
    /// Adds a new item and fails if one is already there, so it can never overwrite (or prompt
    /// to change) an item another build owns.
    fn add(&self, account: &str, value: &str) -> Result<(), String>;
}

struct Keychain;

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("Keychain unavailable: {e}"))
}

impl Store for Keychain {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match entry_for(account)?.get_password() {
            Ok(v) => Ok(Some(v).filter(|v| !v.is_empty())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Couldn't read the Keychain: {e}")),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        entry_for(account)?
            .set_password(value)
            .map_err(|e| format!("Could not save to the Keychain: {e}"))
    }

    fn remove(&self, account: &str) -> Result<(), String> {
        match entry_for(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Could not remove the credential: {e}")),
        }
    }

    #[cfg(target_os = "macos")]
    fn add(&self, account: &str, value: &str) -> Result<(), String> {
        use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};
        SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .and_then(|k| k.add_generic_password(SERVICE, account, value.as_bytes()))
            .map_err(|e| format!("Could not save to the Keychain: {e}"))
    }

    #[cfg(not(target_os = "macos"))]
    fn add(&self, account: &str, value: &str) -> Result<(), String> {
        if self.get(account)?.is_some() {
            return Err("Already saved.".into());
        }
        self.set(account, value)
    }
}

/// Reads the vault, moving any older per-secret items into it the first time. Only a missing
/// vault triggers the move: if the Keychain refuses (the person pressed Deny), nothing is
/// written, so a refusal can never overwrite saved secrets with an empty vault.
fn load(store: &dyn Store) -> Result<Secrets, String> {
    if let Some(json) = store.get(VAULT_ACCOUNT)? {
        return serde_json::from_str(&json)
            .map_err(|_| "The saved credentials are unreadable.".into());
    }
    let mut secrets = Secrets::new();
    for account in LEGACY_ACCOUNTS {
        // A refused legacy item fails the unlock too, or the move would leave it behind.
        if let Some(v) = store.get(account)? {
            secrets.insert(account.to_owned(), v);
        }
    }
    if !secrets.is_empty() {
        save(store, &secrets)?;
        for account in LEGACY_ACCOUNTS {
            let _ = store.remove(account);
        }
    }
    Ok(secrets)
}

fn save(store: &dyn Store, secrets: &Secrets) -> Result<(), String> {
    if secrets.is_empty() {
        return store.remove(VAULT_ACCOUNT);
    }
    let json = serde_json::to_string(secrets).map_err(|e| e.to_string())?;
    store.set(VAULT_ACCOUNT, &json)
}

enum Lock {
    /// Not read yet this launch.
    Locked,
    Unlocked(Secrets),
    /// Touch ID was cancelled or the Keychain refused. Atlas runs without tokens until the
    /// person presses Unlock, rather than asking again on every request.
    Declined(String),
}

static STATE: Mutex<Lock> = Mutex::new(Lock::Locked);

/// Unlocks if needed and runs `f` on the secrets. Callers wait on the mutex while the Touch ID
/// sheet is up, so concurrent requests produce one prompt, not one each.
fn with_secrets<T>(f: impl FnOnce(&mut Secrets) -> T) -> Result<T, String> {
    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    if matches!(*state, Lock::Locked) {
        *state = match unlock(&Keychain, auth::verify) {
            Ok(s) => Lock::Unlocked(s),
            Err(e) => Lock::Declined(e),
        };
    }
    match &mut *state {
        Lock::Unlocked(s) => Ok(f(s)),
        Lock::Declined(e) => Err(e.clone()),
        Lock::Locked => unreachable!(),
    }
}

/// Reads the vault, then asks for Touch ID if anything is in it. With nothing saved there is
/// nothing to protect, so a fresh install doesn't prompt.
fn unlock(
    store: &dyn Store,
    verify: impl FnOnce() -> Result<(), String>,
) -> Result<Secrets, String> {
    let secrets = load(store)?;
    if !secrets.is_empty() {
        verify()?;
    }
    Ok(secrets)
}

/// What the running copy holds, for handing to the updated copy. None unless unlocked with
/// something saved, so a locked Atlas never passes anything on.
// Only the macOS update restart uses this.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn snapshot() -> Option<BTreeMap<String, String>> {
    let state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    match &*state {
        Lock::Unlocked(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// Takes the secrets the previous copy handed over, in place of the Touch ID unlock.
pub(crate) fn adopt(secrets: BTreeMap<String, String>) {
    *STATE.lock().unwrap_or_else(|e| e.into_inner()) = Lock::Unlocked(secrets);
}

/// Removes the vault item, so the updated copy can save it again as its own.
// Only the macOS update restart uses this.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn release_vault() -> Result<(), String> {
    Keychain.remove(VAULT_ACCOUNT)
}

/// Saves the vault as a new item owned by this build. Fails if any vault item exists.
pub(crate) fn add_vault(secrets: &BTreeMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string(secrets).map_err(|e| e.to_string())?;
    Keychain.add(VAULT_ACCOUNT, &json)
}

fn read(account: &str) -> Option<String> {
    with_secrets(|s| s.get(account).cloned()).ok().flatten()
}

fn write(account: &str, value: Option<&str>) -> Result<(), String> {
    with_secrets(|s| {
        let mut next = s.clone();
        match value {
            Some(v) => next.insert(account.to_owned(), v.to_owned()),
            None => next.remove(account),
        };
        save(&Keychain, &next)?;
        *s = next;
        Ok(())
    })
    .map_err(|e| format!("{e} Unlock Atlas first."))?
}

fn clear(account: &str) -> Result<(), String> {
    write(account, None)
}

#[derive(Serialize)]
pub struct VaultStatus {
    /// "locked", "unlocked" or "declined".
    state: &'static str,
    /// Why the last unlock didn't go through, in plain words.
    error: Option<String>,
}

/// True once this launch's unlock succeeded. Never prompts, so background work can ask first.
pub fn unlocked() -> bool {
    matches!(
        *STATE.lock().unwrap_or_else(|e| e.into_inner()),
        Lock::Unlocked(_)
    )
}

#[tauri::command]
pub fn vault_status() -> VaultStatus {
    let state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    match &*state {
        Lock::Locked => VaultStatus {
            state: "locked",
            error: None,
        },
        Lock::Unlocked(_) => VaultStatus {
            state: "unlocked",
            error: None,
        },
        Lock::Declined(e) => VaultStatus {
            state: "declined",
            error: Some(e.clone()),
        },
    }
}

/// Unlocks at launch, or tries again after a cancelled Touch ID prompt. The window shows its
/// lock screen until this returns, so no other command waits on the Touch ID sheet.
#[tauri::command]
pub async fn vault_unlock() -> Result<VaultStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        {
            let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
            if matches!(*state, Lock::Declined(_)) {
                *state = Lock::Locked;
            }
        }
        let _ = with_secrets(|_| ());
        vault_status()
    })
    .await
    .map_err(|e| e.to_string())
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
    write(ACTIONS_ACCOUNT, Some(token))
}

pub fn clear_actions_token() -> Result<(), String> {
    clear(ACTIONS_ACCOUNT)
}

/// The Manage agents token. Read only by the actions client at request time.
pub fn read_agents_token() -> Option<String> {
    read(AGENTS_ACCOUNT)
}

pub fn agents_token_present() -> bool {
    read_agents_token().is_some()
}

/// Checks a Manage agents token's shape: fine-grained only, and not any other token Atlas
/// holds, so managing agents never borrows read, re-run or merge rights.
pub fn check_agents_token(token: &str, others: &[String]) -> Result<(), String> {
    if !(token.starts_with("github_pat_") && looks_like_token(token)) {
        return Err("Use a fine-grained token (starting with github_pat_) limited to the ai-ops-atlas repository.".into());
    }
    if others.iter().any(|o| o == token) {
        return Err("That token is already saved for something else in Atlas. Create a separate one for managing agents.".into());
    }
    Ok(())
}

pub fn set_agents_token(token: &str) -> Result<(), String> {
    let others: Vec<String> = with_secrets(|s| {
        s.iter()
            .filter(|(k, _)| k.as_str() != AGENTS_ACCOUNT)
            .map(|(_, v)| v.clone())
            .collect()
    })?;
    check_agents_token(token, &others)?;
    write(AGENTS_ACCOUNT, Some(token))
}

pub fn clear_agents_token() -> Result<(), String> {
    clear(AGENTS_ACCOUNT)
}

fn merge_account(repo: &str) -> String {
    format!("{MERGE_PREFIX}{}", repo.to_ascii_lowercase())
}

/// The merge token for one repository. Read only by the actions client at request time.
pub fn read_merge_token(repo: &str) -> Option<String> {
    read(&merge_account(repo))
}

/// Repositories (lowercase owner/name) with a merge token saved.
pub fn merge_token_repos() -> Vec<String> {
    with_secrets(|s| {
        s.keys()
            .filter_map(|k| k.strip_prefix(MERGE_PREFIX).map(str::to_owned))
            .collect()
    })
    .unwrap_or_default()
}

/// Checks a merge token's shape: fine-grained only, and not any other token Atlas holds, so
/// each repository's merge rights stay separate from reads, re-runs and other repositories.
pub fn check_merge_token(token: &str, others: &[String]) -> Result<(), String> {
    if !(token.starts_with("github_pat_") && looks_like_token(token)) {
        return Err(
            "Use a fine-grained token (starting with github_pat_) limited to this one repository."
                .into(),
        );
    }
    if others.iter().any(|o| o == token) {
        return Err("That token is already saved for something else in Atlas. Create a separate token for this repository, with Pull requests and Contents: Read and write only.".into());
    }
    Ok(())
}

pub fn set_merge_token(repo: &str, token: &str) -> Result<(), String> {
    let mine = merge_account(repo);
    let others: Vec<String> = with_secrets(|s| {
        s.iter()
            .filter(|(k, _)| **k != mine)
            .map(|(_, v)| v.clone())
            .collect()
    })?;
    check_merge_token(token, &others)?;
    write(&mine, Some(token))
}

pub fn clear_merge_token(repo: &str) -> Result<(), String> {
    clear(&merge_account(repo))
}

/// A fresh Touch ID check (or the Mac's password) for one irreversible action, on top of the
/// unlock at launch.
pub fn confirm_owner(reason: &str) -> Result<(), String> {
    auth::confirm(reason)
}

/// The shared secret for pushing usage records to the hosted site. Read only by `usage_sync`.
pub fn read_usage_sync_key() -> Option<String> {
    read(USAGE_SYNC_ACCOUNT)
}

pub fn set_usage_sync_key(key: &str) -> Result<(), String> {
    write(USAGE_SYNC_ACCOUNT, Some(key))
}

pub fn clear_usage_sync_key() -> Result<(), String> {
    clear(USAGE_SYNC_ACCOUNT)
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
    write(ANTHROPIC_ACCOUNT, Some(key))
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
    write(ACCOUNT, Some(token))
}

#[tauri::command]
pub fn github_token_clear() -> Result<(), String> {
    clear(ACCOUNT)
}

/// The Touch ID check. LocalAuthentication's "device owner" policy uses Touch ID or an Apple
/// Watch when available and falls back to the Mac's login password, all in the system sheet.
#[cfg(target_os = "macos")]
mod auth {
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};

    pub fn verify() -> Result<(), String> {
        confirm("unlock the GitHub and Anthropic keys it has saved").map_err(|_| {
            String::from("Touch ID was cancelled, so your saved keys are still locked.")
        })
    }

    pub fn confirm(reason: &str) -> Result<(), String> {
        let policy = LAPolicy::DeviceOwnerAuthentication;
        // SAFETY: plain LocalAuthentication calls; the reply block only sends on a channel.
        unsafe {
            let ctx = LAContext::new();
            // No login password or Touch ID set up at all: there is nothing to verify with,
            // and the Keychain still guards the item, so let it through.
            if ctx.canEvaluatePolicy_error(policy).is_err() {
                return Ok(());
            }
            let (tx, rx) = mpsc::channel::<bool>();
            let reply = RcBlock::new(move |ok: Bool, _err: *mut NSError| {
                let _ = tx.send(ok.as_bool());
            });
            let reason = NSString::from_str(reason);
            ctx.evaluatePolicy_localizedReason_reply(policy, &reason, &reply);
            match rx.recv() {
                Ok(true) => Ok(()),
                _ => Err("Touch ID was cancelled.".into()),
            }
        }
    }
}

/// Other platforms rely on the OS credential store's own prompt.
#[cfg(not(target_os = "macos"))]
mod auth {
    pub fn verify() -> Result<(), String> {
        Ok(())
    }

    pub fn confirm(_reason: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Fake {
        items: RefCell<BTreeMap<String, String>>,
        deny: bool,
    }

    impl Store for Fake {
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            if self.deny {
                return Err("denied".into());
            }
            Ok(self.items.borrow().get(account).cloned())
        }
        fn set(&self, account: &str, value: &str) -> Result<(), String> {
            self.items.borrow_mut().insert(account.into(), value.into());
            Ok(())
        }
        fn remove(&self, account: &str) -> Result<(), String> {
            self.items.borrow_mut().remove(account);
            Ok(())
        }
        fn add(&self, account: &str, value: &str) -> Result<(), String> {
            if self.items.borrow().contains_key(account) {
                return Err("duplicate".into());
            }
            self.set(account, value)
        }
    }

    #[test]
    fn legacy_items_move_into_one_vault() {
        let store = Fake::default();
        store.set(ACCOUNT, "ghp_x").unwrap();
        store.set(ANTHROPIC_ACCOUNT, "sk-ant-x").unwrap();
        let secrets = load(&store).unwrap();
        assert_eq!(secrets.get(ACCOUNT).map(String::as_str), Some("ghp_x"));
        assert_eq!(secrets.len(), 2);
        let items = store.items.borrow();
        assert!(items.contains_key(VAULT_ACCOUNT));
        assert!(!items.contains_key(ACCOUNT) && !items.contains_key(ANTHROPIC_ACCOUNT));
        drop(items);
        // A second launch reads the vault alone.
        assert_eq!(load(&store).unwrap(), secrets);
    }

    #[test]
    fn a_refused_keychain_writes_nothing() {
        let store = Fake {
            deny: true,
            ..Default::default()
        };
        store
            .items
            .borrow_mut()
            .insert(VAULT_ACCOUNT.into(), r#"{"github-token":"ghp_x"}"#.into());
        assert!(load(&store).is_err());
        assert!(store.items.borrow().contains_key(VAULT_ACCOUNT));
    }

    #[test]
    fn touch_id_only_when_something_is_saved() {
        let empty = Fake::default();
        assert!(unlock(&empty, || Err("should not ask".into())).is_ok());

        let saved = Fake::default();
        save(
            &saved,
            &Secrets::from([(ACCOUNT.to_owned(), "ghp_x".to_owned())]),
        )
        .unwrap();
        assert!(unlock(&saved, || Err("cancelled".into())).is_err());
        assert_eq!(unlock(&saved, || Ok(())).unwrap().len(), 1);
    }

    #[test]
    fn clearing_the_last_secret_removes_the_vault() {
        let store = Fake::default();
        save(
            &store,
            &Secrets::from([(ACCOUNT.to_owned(), "ghp_x".to_owned())]),
        )
        .unwrap();
        save(&store, &Secrets::new()).unwrap();
        assert!(store.items.borrow().is_empty());
    }

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
    fn merge_tokens_are_fine_grained_and_not_reused() {
        let t = "github_pat_11ABCDEFG0123456789_abcdefghijklmnop";
        assert!(check_merge_token(t, &[]).is_ok());
        assert!(
            check_merge_token(t, &[t.to_string()]).is_err(),
            "same as another saved token"
        );
        assert!(check_merge_token("ghp_abcdefghijklmnopqrstuvwxyz0123456789", &[]).is_err());
        assert_eq!(merge_account("Owner/Repo"), "github-merge-token:owner/repo");
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
