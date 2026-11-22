# Contributors

This section is for people contributing to Svelar itself, not for developers using Svelar inside an application.

User-facing guides should stay focused on building apps with Svelar. Contributor documentation should cover repository workflows, release gates, local certification, package publishing, and project-maintenance rules.

## Root Toolchain And CI Setup

Svelar source builds require Node.js `^22.18.0 || ^24.11.0 || >=26.0.0`. Use the root's pinned `npm@11.21.3` package manager and keep TypeScript 6.0.3 with Node 22 ambient types. These are contributor-tooling requirements: core's installed Kit 2 runtime floor remains Node.js `>=22.12.0`, and new Kit 3 apps declare `^22.17.0 || ^24.0.0 || >=26.0.0`. Do not add the root npm requirement to consumer apps or core's production package.

CI installs npm 11.21.3 globally only inside its ephemeral runner. Locally, use a verified isolated npm CLI or invoke the pinned package through `npm exec`; do not replace the machine's global npm just to run this repository's checks.

Run from the monorepo root to reproduce the checkout-visible CI graph:

```bash
npm exec --yes --package=npm@11.21.3 -- npm --version
npm exec --yes --package=npm@11.21.3 -- npm ci --workspace=packages/svelar --workspace=packages/svelar-stripe --workspace=packages/svelar-social-auth --include-workspace-root --no-audit --no-fund
npm exec --yes --package=npm@11.21.3 -- npm ls --all
npm exec --yes --package=npm@11.21.3 -- npm run lint -w packages/svelar
npm exec --yes --package=npm@11.21.3 -- npm run build
npm exec --yes --package=npm@11.21.3 -- npm run test -w packages/svelar -- --maxWorkers=1 --no-file-parallelism
npm exec --yes --package=npm@11.21.3 -- npm run security:audit
```

The three workspace filters plus `--include-workspace-root` are intentional. Local ignored plugin checkouts and the nested datatable repository are not part of a normal GitHub checkout. Do not copy their manifests, fabricate placeholder workspaces or borrow an existing `node_modules` tree to make CI pass. A local unfiltered install with additional plugin checkouts is not equivalent evidence.

Keep install scripts enabled. Do not use `--ignore-scripts`, `--legacy-peer-deps` or `--force` to bypass dependency failures, and do not edit lockfile entries by hand. Preserve logs from `npm ci`, `npm ls`, audit, lint, build and tests. A successful install does not prove a clean dependency tree; the `npm ls --all` and audit guards must pass independently.

The root cookie override qualifies the child dependency: `@sveltejs/kit` -> `cookie@^0.6.0` -> `^0.7.2`. It repairs the legacy branch without forcing Kit 3's cookie 2 branch backward. Preserve that qualification rather than restoring an unqualified cookie override.

## Working on Svelar

Before changing core behavior, prefer a small, production-shaped test that proves the framework works in a generated app. Unit tests are still useful, but release confidence comes from testing the package the way users will consume it.

Use the sibling `svelar-testing-area` folder for generated apps and external-service smoke tests. Service-backed smoke commands start Docker containers on random localhost ports so they do not require default ports to be free.

Keep repository and generated-app agent instructions aligned with public runtime contracts. HTTP generators require an explicit capability decision (`--capability` or a reviewed `--public` exemption); neither choice disables authentication, model policies, schema validation or CSRF. Seed capability catalogs and profiles instead of hardcoding user grants. Operator controls must use public named queue adapters and persistent scheduler requests, and realtime must remain a signal over durable background state.

Svelar-specific skills take precedence over generic Svelte examples: thin routes, controllers, shared-schema Superforms/FormRequests, DTOs, actions/services, repositories and resources remain required. Maintain ESM import paths, Tailwind 4 configuration, custom-primary-key auth identity, awaited global exception reporting and isolated asynchronous factories in the generated instructions. Regenerate packaged Claude skills when their source/references change, and prove fresh installed apps receive the current instructions. Worker recovery claims require owned native processes and public adapters; cache/realtime readiness is not proof of distributed delivery.

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
