# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately to the repository owner through the contact on [github.com/khaneilcampbell](https://github.com/khaneilcampbell), with the affected files, steps to reproduce and the impact.

## Secrets

- Never commit passwords, API tokens or private keys. Keep them in environment variables or the service's own secret store.
- The `Checks` workflow blocks private key material on every push and pull request.

## Scope

Skyline holds district plans and Skyline-specific code for AI Ops Atlas. The Atlas app itself, including its building models, is covered by the [AI Ops Atlas](https://github.com/khaneilcampbell/ai-ops-atlas) repository.
