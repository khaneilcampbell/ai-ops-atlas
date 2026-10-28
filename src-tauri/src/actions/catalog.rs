//! Local edits to the agent catalog: a display name, an owner, a note and an autonomy level
//! per agent, kept in `catalog-overrides.json` next to the audit log. They change how Atlas
//! shows an agent on this Mac and nothing else: no manifest, repository or agent is touched,
//! and autonomy here is a label, not a permission. Each save asks in a native dialog and is
//! audited like the GitHub actions.

use super::store::{AuditRecord, Stage, Store, ACTION_EDIT_CATALOG};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

pub const MAX_NAME: usize = 80;
pub const MAX_NOTE: usize = 2000;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CatalogEdit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autonomy: Option<u8>,
}

impl CatalogEdit {
    fn is_empty(&self) -> bool {
        self == &CatalogEdit::default()
    }

    /// Trims every field, turns blanks into "not overridden" and checks the limits.
    pub fn clean(self) -> Result<Self, String> {
        let text = |v: Option<String>, max: usize, what: &str| -> Result<Option<String>, String> {
            match v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                Some(s) if s.chars().count() > max => {
                    Err(format!("The {what} can be at most {max} characters."))
                }
                Some(s) if s.chars().any(|c| c.is_control() && c != '\n') => {
                    Err(format!("The {what} has characters Atlas can't show."))
                }
                v => Ok(v),
            }
        };
        if self.autonomy.is_some_and(|a| a > 4) {
            return Err("Autonomy is a level from 0 to 4.".into());
        }
        Ok(Self {
            name: text(self.name, MAX_NAME, "name")?.map(|s| s.replace('\n', " ")),
            owner: text(self.owner, MAX_NAME, "owner")?.map(|s| s.replace('\n', " ")),
            note: text(self.note, MAX_NOTE, "note")?,
            autonomy: self.autonomy,
        })
    }

    /// One line per changed field, for the dialog and the audit log.
    pub fn describe(&self, before: &CatalogEdit) -> Vec<String> {
        let show = |v: &Option<String>| v.clone().unwrap_or_else(|| "(from the manifest)".into());
        let mut out = vec![];
        if self.name != before.name {
            out.push(format!("Name: {}", show(&self.name)));
        }
        if self.owner != before.owner {
            out.push(format!("Owner: {}", show(&self.owner)));
        }
        if self.note != before.note {
            out.push(match &self.note {
                Some(n) if n.chars().count() > 200 => {
                    format!("Note: {}…", n.chars().take(200).collect::<String>())
                }
                n => format!("Note: {}", show(n)),
            });
        }
        if self.autonomy != before.autonomy {
            out.push(format!(
                "Autonomy: {}",
                self.autonomy
                    .map(|a| format!("level {a}"))
                    .unwrap_or_else(|| "(from the manifest)".into())
            ));
        }
        out
    }
}

pub fn valid_agent_id(id: &str) -> bool {
    (1..=80).contains(&id.len())
        && id
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub struct Overrides {
    path: PathBuf,
}

impl Overrides {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            path: dir.join("catalog-overrides.json"),
        }
    }

    /// A missing or unreadable file means no edits.
    pub fn load(&self) -> BTreeMap<String, CatalogEdit> {
        fs::read(&self.path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    fn save(&self, all: &BTreeMap<String, CatalogEdit>) -> Result<(), String> {
        let tmp = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec_pretty(all).map_err(|e| e.to_string())?;
        fs::write(&tmp, bytes).map_err(|e| format!("Could not save the catalog edits: {e}"))?;
        fs::rename(&tmp, &self.path).map_err(|e| format!("Could not save the catalog edits: {e}"))
    }

    /// What saving `edit` for `agent` would change, without saving. `Ok(None)` when nothing would.
    pub fn preview(
        &self,
        agent: &str,
        edit: CatalogEdit,
    ) -> Result<Option<(CatalogEdit, Vec<String>)>, String> {
        if !valid_agent_id(agent) {
            return Err("That isn't an agent id.".into());
        }
        let edit = edit.clean()?;
        let before = self.load().remove(agent).unwrap_or_default();
        let lines = edit.describe(&before);
        Ok((!lines.is_empty()).then_some((edit, lines)))
    }

    /// Saves the edit (an empty one removes the agent's entry) and logs it.
    pub fn apply(
        &self,
        store: &Store,
        actor: &str,
        agent: &str,
        edit: CatalogEdit,
        lines: &[String],
    ) -> Result<(), String> {
        let mut all = self.load();
        if edit.is_empty() {
            all.remove(agent);
        } else {
            all.insert(agent.to_string(), edit);
        }
        self.save(&all)?;
        let _ = store.append(&record(actor, agent, Stage::Done, lines));
        Ok(())
    }

    pub fn log_cancel(&self, store: &Store, actor: &str, agent: &str, lines: &[String]) {
        let _ = store.append(&record(actor, agent, Stage::Cancelled, lines));
    }
}

fn record(actor: &str, agent: &str, stage: Stage, lines: &[String]) -> AuditRecord {
    AuditRecord {
        id: uuid::Uuid::new_v4().to_string(),
        at: chrono::Utc::now(),
        action: ACTION_EDIT_CATALOG.into(),
        actor: actor.to_string(),
        github_login: None,
        // Not a repository: the catalog entry this edit is for.
        repo: format!("catalog/{agent}"),
        run_id: 0,
        pull_number: None,
        title: None,
        base: None,
        workflow: None,
        run_number: None,
        attempt_before: None,
        head_sha: None,
        branch: None,
        stage,
        reason: (stage == Stage::Cancelled).then(|| "cancelled".into()),
        http_status: None,
        request_id: None,
        message: Some(match stage {
            Stage::Done => "Saved on this Mac.".into(),
            _ => "Cancelled. Nothing was saved.".into(),
        }),
        detail: Some(lines.join("\n")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_are_cleaned_previewed_saved_and_logged() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().to_path_buf()).unwrap();
        let o = Overrides::new(d.path().to_path_buf());
        let edit = CatalogEdit {
            name: Some("  Site guard ".into()),
            owner: Some("".into()),
            note: None,
            autonomy: Some(2),
        };
        let (clean, lines) = o.preview("benjaire-site-ci", edit).unwrap().unwrap();
        assert_eq!(clean.name.as_deref(), Some("Site guard"));
        assert_eq!(clean.owner, None, "blank means use the manifest");
        assert_eq!(
            lines,
            vec![
                "Name: Site guard".to_string(),
                "Autonomy: level 2".to_string()
            ]
        );
        o.apply(&store, "kc", "benjaire-site-ci", clean.clone(), &lines)
            .unwrap();
        assert_eq!(o.load().get("benjaire-site-ci"), Some(&clean));
        assert!(
            o.preview("benjaire-site-ci", clean).unwrap().is_none(),
            "no change, no dialog"
        );
        let log = store.audit();
        assert_eq!(
            (log[0].stage, log[0].action.as_str()),
            (Stage::Done, ACTION_EDIT_CATALOG)
        );
        assert_eq!(log[0].repo, "catalog/benjaire-site-ci");

        // Clearing every field removes the entry.
        let (empty, lines) = o
            .preview("benjaire-site-ci", CatalogEdit::default())
            .unwrap()
            .unwrap();
        o.apply(&store, "kc", "benjaire-site-ci", empty, &lines)
            .unwrap();
        assert!(o.load().is_empty());
    }

    #[test]
    fn bad_input_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let o = Overrides::new(d.path().to_path_buf());
        assert!(o.preview("../x", CatalogEdit::default()).is_err());
        assert!(o
            .preview(
                "a",
                CatalogEdit {
                    autonomy: Some(5),
                    ..Default::default()
                }
            )
            .is_err());
        assert!(o
            .preview(
                "a",
                CatalogEdit {
                    name: Some("x".repeat(81)),
                    ..Default::default()
                }
            )
            .is_err());
        assert!(o
            .preview(
                "a",
                CatalogEdit {
                    note: Some("a\u{7}b".into()),
                    ..Default::default()
                }
            )
            .is_err());
    }
}
