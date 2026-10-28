# Runbooks: Project Intelligence Hub

Repository: [khaneilcampbell/project-intelligence-hub](https://github.com/khaneilcampbell/project-intelligence-hub).

## Docs Builder

`10 — System Administration/Automation Scripts/build_docs.py`.

- **Needs:** pandoc 2.9 or newer and `pip install python-docx`.
- **Run it:** `python3 "10 — System Administration/Automation Scripts/build_docs.py" "<project folder>"`. The folder must hold `Source/project.json` and `Source/*.md`; one DOCX per Markdown file is written beside `Source/`.
- **When it fails:** a missing pandoc or python-docx stops it at once. Check `project.json` is valid JSON with `id`, `name`, `category`, `status`, `repo` and `last_verified`, and that the five source files exist (CI checks the same).
- **Undo it:** the DOCX files are committed, so `git checkout -- "<project folder>"/*.docx` restores them.

## Hub CI

`.github/workflows/ci.yml`. Checks every project's sources, then renders every project in the runner.

- **When it fails:** the `::error::` lines name the project and the missing field or file. Rendering errors reproduce with the Docs Builder command above.
- **Rendered documents:** run the workflow by hand with **documents** ticked and download the artifact.
- **Stop it:** disable the workflow in Actions.
