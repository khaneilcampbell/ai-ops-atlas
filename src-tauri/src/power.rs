//! Whether the Mac is running on battery, so the map's Automatic performance setting can
//! switch to Battery saver.

use std::process::Command;

/// True on battery, false on power, None when the power source is unknown.
#[tauri::command]
pub async fn power_on_battery() -> Option<bool> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = Command::new("/usr/bin/pmset")
            .args(["-g", "batt"])
            .output()
            .ok()?;
        parse(&String::from_utf8_lossy(&out.stdout))
    })
    .await
    .ok()
    .flatten()
}

/// `pmset -g batt` starts with "Now drawing from 'Battery Power'" or "... 'AC Power'".
fn parse(out: &str) -> Option<bool> {
    let first = out.lines().next()?;
    if first.contains("'Battery Power'") {
        Some(true)
    } else if first.contains("'AC Power'") {
        Some(false)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn reads_the_power_source() {
        assert_eq!(parse("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t82%; discharging; 5:12 remaining present: true\n"), Some(true));
        assert_eq!(parse("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n"), Some(false));
        assert_eq!(parse("Now drawing from 'AC Power'\n"), Some(false));
        assert_eq!(parse(""), None);
        assert_eq!(parse("something else"), None);
    }
}
