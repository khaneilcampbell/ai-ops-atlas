# Changelog lines for open pull requests

Each pull request adds **one new file here** instead of editing the top of `CHANGELOG.md`. Two
pull requests never touch the same file, so they can't conflict on the changelog.

- Name the file after your branch, e.g. `changelog.d/project-thread-abc123.md`.
- Put one line in it, written for Khaneil: `- YYYY-MM-DD · What changed, in plain words (#PR)`.
  Add the pull request number once it exists. More than one line is fine.
- `scripts/release-notes.mjs` reads these files and `CHANGELOG.md` together. The newest five lines
  show in the Mac app's **Update available** button, newest date first, then highest PR number.

Leave the files in place after merging. This README is not read as an entry.
