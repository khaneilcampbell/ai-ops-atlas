# Contributing

## Workflow

1. Create a branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>` or `docs/<short-name>`.
2. Make focused commits using [Conventional Commits](https://www.conventionalcommits.org/).
3. Open a pull request and fill in the template.
4. All checks (CI, CodeQL, secret scan) must pass and at least one review is required before merge.
5. Squash-merge, then delete the branch.

## Code standards

- Keep pull requests small and single-purpose.
- Add or update tests with every behaviour change.
- Run linters and tests locally before pushing.

## Security rules

- Never commit secrets, tokens, `.env` files, or real ticket exports. Use `.env.example` for documenting variables.
- Use synthetic or anonymized data in fixtures, screenshots and demos.
- New dependencies must be actively maintained; review Dependabot alerts promptly.
- If you accidentally commit a secret, rotate it immediately. Removing it from history is not enough.

## Reporting issues

Use the issue templates. For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
