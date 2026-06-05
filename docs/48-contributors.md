# Contributors

This section is for people contributing to Svelar itself, not for developers using Svelar inside an application.

User-facing guides should stay focused on building apps with Svelar. Contributor documentation should cover repository workflows, release gates, local certification, package publishing, and project-maintenance rules.

## Working on Svelar

Before changing core behavior, prefer a small, production-shaped test that proves the framework works in a generated app. Unit tests are still useful, but release confidence comes from testing the package the way users will consume it.

Use the sibling `svelar-testing-area` folder for generated apps and external-service smoke tests. Service-backed smoke commands start Docker containers on random localhost ports so they do not require default ports to be free.

## Documentation Sync

When documentation changes in this repository, mirror the equivalent changes in:

```bash
/Users/rzeradev/projects/beeblock/svelar-docs/
```

Keep the docs search registry in sync too:

```bash
/Users/rzeradev/projects/beeblock/svelar-docs/src/lib/doc-registry.ts
```

## Contributor Guides

- [Release Certification](./47-release-certification.md) — pre-publish gates and generated-app certification coverage.
