# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately to the repository owner through the contact on [github.com/khaneilcampbell](https://github.com/khaneilcampbell), with the affected files, steps to reproduce and the impact.

## Personal data

This system works with resumes, career history and application records.

- Real career data, resumes, the tracker and job analyses belong in `private/`, which `.gitignore` keeps out of the repository. Only data-free templates and examples are committed.
- Generated documents (`output/`, `*.docx`, `*.pdf`) are ignored too. Check `git status` before every commit.
- Redact names, contact details and employer details from screenshots and examples.

## Secrets

- Never commit API keys or tokens. Keep them in `.env` (ignored) or the n8n credential store.
- Use keys with the smallest scope and a spend limit, and rotate any key that was exposed.

## AI output

The AI may re-angle verified facts but must never invent them. Review every generated resume before it is sent.
