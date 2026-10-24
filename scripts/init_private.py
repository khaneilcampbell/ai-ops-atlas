"""Create your private, gitignored workspace from the committed templates.

    python scripts/init_private.py

Creates private/ with the career database templates, a fill-in copy of the
Claude prompt, your personal tracker, and folders for resumes and applications.
Existing files are never overwritten.
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT / "private"


def copy_if_missing(src, dest):
    if dest.exists():
        print(f"  keep   {dest.relative_to(ROOT)}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    print(f"  create {dest.relative_to(ROOT)}")


def main():
    print("Setting up private/ (gitignored)")
    for src in sorted((ROOT / "career-database" / "templates").glob("*.json")):
        copy_if_missing(src, PRIVATE / "career-database" / src.name)
    copy_if_missing(ROOT / "prompts" / "resume-tailoring-assistant.md",
                    PRIVATE / "claude-project-instructions.md")
    for folder in ("resumes/master", "resumes/base", "applications"):
        (PRIVATE / folder).mkdir(parents=True, exist_ok=True)

    tracker = PRIVATE / "application_tracker.xlsx"
    if tracker.exists():
        print(f"  keep   {tracker.relative_to(ROOT)}")
    else:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build_tracker.py"), str(tracker)], check=True)

    print("\nNext: put your master resume in private/resumes/master/, fill in the JSON files,")
    print("then run: python scripts/validate_database.py")


if __name__ == "__main__":
    main()
