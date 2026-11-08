//! Restarting after an update without asking for Touch ID or the Keychain again.
//!
//! The copy that installed the update starts the new copy itself and passes it, over a
//! socket that only the two processes hold, the secrets it already unlocked plus the view and
//! window position to restore. Nothing is written to disk. The secrets are only sent when the
//! new app on disk is signed with the same certificate as the running one, so a replaced or
//! re-signed bundle never receives them and has to unlock with Touch ID like any other launch.
//!
//! The new copy then saves the vault as its own Keychain item (the old copy removes its item
//! first), so the next ordinary launch reads it without the login password prompt. If that
//! fails at any step the old copy puts its item back before quitting.
//!
//! Protocol, one line each: old sends the payload, new answers `ok`; old sends `reown` (its
//! item is removed) or `keep`; after `reown` new answers `saved` or `failed`; new sends `ready`
//! once its window is up, and the old copy quits.

use std::collections::BTreeMap;
use std::io::{BufRead, Write};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::secrets;

/// Set on the new copy only, so an ordinary launch never reads its stdin.
const ENV: &str = "ATLAS_UPDATE_HANDOFF";
const STEP_TIMEOUT: Duration = Duration::from_secs(10);
const READY_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
struct Payload {
    secrets: Option<BTreeMap<String, String>>,
    /// The web view's own note of what was on screen, returned once by `take_resume`.
    resume: Option<String>,
    window: Option<Bounds>,
}

fn read_line(r: &mut impl BufRead) -> Option<String> {
    let mut line = String::new();
    match r.read_line(&mut line) {
        Ok(n) if n > 0 => Some(line.trim_end().to_owned()),
        _ => None,
    }
}

fn send_line(w: &mut impl Write, line: &str) -> bool {
    w.write_all(format!("{line}\n").as_bytes())
        .and_then(|_| w.flush())
        .is_ok()
}

/// The old copy's side. `release` removes its vault item and `restore` adds it back.
/// Returns once the new copy's window is up, or it stopped answering.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn give(
    r: &mut impl BufRead,
    w: &mut impl Write,
    payload: &Payload,
    release: impl FnOnce() -> Result<(), String>,
    restore: impl FnOnce() -> Result<(), String>,
) {
    let Ok(json) = serde_json::to_string(payload) else {
        return;
    };
    if !send_line(w, &json) || read_line(r).as_deref() != Some("ok") {
        return;
    }
    if payload.secrets.is_some() && release().is_ok() {
        let saved = send_line(w, "reown") && read_line(r).as_deref() == Some("saved");
        if !saved {
            // Adding fails harmlessly if the new copy saved it after all.
            let _ = restore();
        }
    } else if !send_line(w, "keep") {
        return;
    }
    let _ = read_line(r);
}

/// The new copy's side, first half: reads the payload before anything else starts.
fn take(r: &mut impl BufRead, w: &mut impl Write) -> Option<Payload> {
    let payload: Payload = serde_json::from_str(&read_line(r)?).ok()?;
    send_line(w, "ok").then_some(payload)
}

/// The new copy's side, second half: saves the vault as its own if asked, then says when ready.
fn finish(
    r: &mut impl BufRead,
    w: &mut impl Write,
    secrets: Option<&BTreeMap<String, String>>,
    add: impl FnOnce(&BTreeMap<String, String>) -> Result<(), String>,
    wait_ready: impl FnOnce(),
) {
    if read_line(r).as_deref() == Some("reown") {
        let ok = secrets.is_some_and(|s| add(s).is_ok());
        if !send_line(w, if ok { "saved" } else { "failed" }) {
            return;
        }
    }
    wait_ready();
    let _ = send_line(w, "ready");
}

static RESUME: Mutex<Option<String>> = Mutex::new(None);
static BOUNDS: Mutex<Option<Bounds>> = Mutex::new(None);
static READY: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

/// What the previous copy had on screen, once, right after an update.
#[tauri::command]
pub fn take_resume() -> Option<String> {
    RESUME.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Called first thing at launch. On an ordinary launch it does nothing.
pub fn receive() {
    if std::env::var_os(ENV).is_none() {
        return;
    }
    std::env::remove_var(ENV);
    #[cfg(unix)]
    {
        use std::io::BufReader;
        use std::os::fd::AsFd;
        use std::os::unix::net::UnixStream;

        let Ok(fd) = std::io::stdin().as_fd().try_clone_to_owned() else {
            return;
        };
        let stream = UnixStream::from(fd);
        if stream.set_read_timeout(Some(STEP_TIMEOUT)).is_err() {
            return;
        }
        let Ok(mut w) = stream.try_clone() else {
            return;
        };
        let mut r = BufReader::new(stream);
        let Some(payload) = take(&mut r, &mut w) else {
            return;
        };
        *RESUME.lock().unwrap_or_else(|e| e.into_inner()) = payload.resume;
        *BOUNDS.lock().unwrap_or_else(|e| e.into_inner()) = payload.window;
        if let Some(s) = &payload.secrets {
            secrets::adopt(s.clone());
        }
        std::thread::spawn(move || {
            finish(
                &mut r,
                &mut w,
                payload.secrets.as_ref(),
                secrets::add_vault,
                wait_ready,
            )
        });
    }
}

fn wait_ready() {
    let (lock, cvar) = &READY;
    let ready = lock.lock().unwrap_or_else(|e| e.into_inner());
    let _ = cvar.wait_timeout_while(ready, READY_TIMEOUT, |r| !*r);
}

/// Called from setup: puts the window where the previous copy had it and brings it forward.
pub fn window_ready(app: &tauri::App) {
    use tauri::Manager;
    let bounds = BOUNDS.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let (Some(b), Some(win)) = (bounds, app.get_webview_window("main")) {
        let _ = win.set_size(tauri::PhysicalSize::new(b.width, b.height));
        let _ = win.set_position(tauri::PhysicalPosition::new(b.x, b.y));
        let _ = win.set_focus();
    }
    let (lock, cvar) = &READY;
    *lock.lock().unwrap_or_else(|e| e.into_inner()) = true;
    cvar.notify_all();
}

/// Restarts into the update that was just installed, keeping Atlas unlocked and on the same
/// view. Falls back to an ordinary restart if the new copy can't be started this way.
#[tauri::command]
pub async fn update_relaunch(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    resume: Option<String>,
) -> Result<(), String> {
    let bounds = window_bounds(&window);
    tauri::async_runtime::spawn_blocking(move || {
        let resume = resume.filter(|r| r.len() <= 4096);
        if !platform::start_new_copy(resume, bounds) {
            app.restart();
        }
        app.exit(0);
    })
    .await
    .map_err(|e| e.to_string())
}

fn window_bounds(window: &tauri::WebviewWindow) -> Option<Bounds> {
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return None;
    }
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(Bounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::io::BufReader;
    use std::os::fd::OwnedFd;
    use std::os::unix::net::UnixStream;
    use std::os::unix::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::OnceLock;

    /// The running app's designated requirement, read at launch before any update replaces
    /// the bundle on disk. Only certificate-based ones count: an ad-hoc build has no stable
    /// identity to compare against.
    static IDENTITY: OnceLock<Option<String>> = OnceLock::new();

    fn bundle() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let contents = exe.parent()?.parent()?;
        (contents.file_name()? == "Contents").then(|| contents.parent().map(Path::to_path_buf))?
    }

    fn designated(bundle: &Path) -> Option<String> {
        let out = Command::new("/usr/bin/codesign")
            .args(["--display", "-r-"])
            .arg(bundle)
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned()
            + &String::from_utf8_lossy(&out.stderr);
        let req = text
            .lines()
            .find_map(|l| l.strip_prefix("designated => "))?
            .trim()
            .to_owned();
        // A self-signed build's requirement names its certificate (`certificate leaf` or
        // `certificate root`); an ad-hoc one only names its own hash.
        req.contains("certificate").then_some(req)
    }

    pub fn remember_identity() {
        std::thread::spawn(|| {
            let _ = IDENTITY.set(bundle().and_then(|b| designated(&b)));
        });
    }

    /// True when the app now on disk meets the running app's own requirement, i.e. is signed
    /// by the same certificate with the same bundle identifier.
    fn same_identity(bundle: &Path) -> bool {
        let Some(Some(req)) = IDENTITY.get() else {
            return false;
        };
        Command::new("/usr/bin/codesign")
            .args(["--verify", "--deep", "--strict"])
            .arg(format!("-R={req}"))
            .arg(bundle)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }

    pub fn start_new_copy(resume: Option<String>, window: Option<Bounds>) -> bool {
        let (Some(bundle), Ok(exe)) = (bundle(), std::env::current_exe()) else {
            return false;
        };
        let secrets = secrets::snapshot().filter(|_| same_identity(&bundle));
        let Ok((mine, theirs)) = UnixStream::pair() else {
            return false;
        };
        // Like Tauri's own restart: no shared stdout or process group, so the new copy
        // doesn't die when this one exits. Its stdin is the socket.
        let spawned = Command::new(&exe)
            .env(ENV, "1")
            .stdin(Stdio::from(OwnedFd::from(theirs)))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn();
        if spawned.is_err() {
            return false;
        }
        // The last answer waits for the new window, which can take longer than one step.
        let _ = mine.set_read_timeout(Some(READY_TIMEOUT));
        let Ok(mut w) = mine.try_clone() else {
            return true;
        };
        let mut r = BufReader::new(mine);
        let payload = Payload {
            secrets,
            resume,
            window,
        };
        let held = payload.secrets.clone();
        give(&mut r, &mut w, &payload, secrets::release_vault, || {
            held.as_ref().map_or(Ok(()), secrets::add_vault)
        });
        true
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;

    pub fn remember_identity() {}

    pub fn start_new_copy(_resume: Option<String>, _window: Option<Bounds>) -> bool {
        false
    }
}

pub use platform::remember_identity;

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::{BufReader, Cursor};

    fn secrets() -> BTreeMap<String, String> {
        BTreeMap::from([("github-token".to_owned(), "ghp_x".to_owned())])
    }

    fn payload(with_secrets: bool) -> Payload {
        Payload {
            secrets: with_secrets.then(secrets),
            resume: Some(r#"{"view":"agents"}"#.into()),
            window: Some(Bounds {
                x: 10,
                y: 20,
                width: 1200,
                height: 800,
            }),
        }
    }

    /// Runs the old copy's side against scripted answers from the new copy.
    fn old_side(p: &Payload, answers: &str, release_ok: bool) -> (String, bool, bool) {
        let mut r = BufReader::new(Cursor::new(answers.as_bytes().to_vec()));
        let mut sent = Vec::new();
        let released = Cell::new(false);
        let restored = Cell::new(false);
        give(
            &mut r,
            &mut sent,
            p,
            || {
                released.set(true);
                if release_ok {
                    Ok(())
                } else {
                    Err("denied".into())
                }
            },
            || {
                restored.set(true);
                Ok(())
            },
        );
        (
            String::from_utf8(sent).unwrap(),
            released.get(),
            restored.get(),
        )
    }

    #[test]
    fn payload_round_trips_and_is_acknowledged() {
        let p = payload(true);
        let line = serde_json::to_string(&p).unwrap() + "\n";
        let mut r = BufReader::new(Cursor::new(line.into_bytes()));
        let mut sent = Vec::new();
        assert_eq!(take(&mut r, &mut sent), Some(p));
        assert_eq!(sent, b"ok\n");
    }

    #[test]
    fn garbage_is_not_taken() {
        let mut r = BufReader::new(Cursor::new(b"not json\n".to_vec()));
        let mut sent = Vec::new();
        assert_eq!(take(&mut r, &mut sent), None);
        assert!(sent.is_empty());
    }

    #[test]
    fn new_copy_takes_over_the_vault() {
        let (sent, released, restored) = old_side(&payload(true), "ok\nsaved\nready\n", true);
        assert!(sent.ends_with("\nreown\n"));
        assert!(released && !restored);
    }

    #[test]
    fn old_copy_puts_the_vault_back_when_the_new_one_fails() {
        let (_, released, restored) = old_side(&payload(true), "ok\nfailed\n", true);
        assert!(released && restored);
        // And when it stops answering altogether.
        let (_, _, restored) = old_side(&payload(true), "ok\n", true);
        assert!(restored);
    }

    #[test]
    fn a_vault_that_cant_be_released_is_kept() {
        let (sent, released, restored) = old_side(&payload(true), "ok\nready\n", false);
        assert!(sent.ends_with("\nkeep\n"));
        assert!(released && !restored);
    }

    #[test]
    fn nothing_is_released_without_secrets_or_an_answer() {
        let (sent, released, _) = old_side(&payload(false), "ok\nready\n", true);
        assert!(sent.ends_with("\nkeep\n") && !released);
        let (sent, released, _) = old_side(&payload(true), "", true);
        assert!(!sent.contains("reown") && !released);
    }

    #[test]
    fn new_copy_saves_only_when_asked() {
        let s = secrets();
        let added = Cell::new(false);
        let mut sent = Vec::new();
        finish(
            &mut BufReader::new(Cursor::new(b"reown\n".to_vec())),
            &mut sent,
            Some(&s),
            |_| {
                added.set(true);
                Ok(())
            },
            || (),
        );
        assert!(added.get());
        assert_eq!(sent, b"saved\nready\n");

        let mut sent = Vec::new();
        finish(
            &mut BufReader::new(Cursor::new(b"keep\n".to_vec())),
            &mut sent,
            Some(&s),
            |_| panic!("must not save"),
            || (),
        );
        assert_eq!(sent, b"ready\n");

        let mut sent = Vec::new();
        finish(
            &mut BufReader::new(Cursor::new(b"reown\n".to_vec())),
            &mut sent,
            Some(&s),
            |_| Err("duplicate".into()),
            || (),
        );
        assert_eq!(sent, b"failed\nready\n");
    }
}
