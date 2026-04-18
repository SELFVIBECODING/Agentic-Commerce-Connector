# Contributing to Agentic Commerce Connector

Thanks for your interest. ACC is a small-ish TypeScript monorepo —
`connector`, `cli`, and `skill-spec` — with a bias toward pure
functions, injectable dependencies, and high test coverage on the
parts that touch crypto, payments, or merchant tokens.

## Ground Rules

1. **Security first.** If your change touches authentication, HMAC,
   EIP-712, token storage, or HTTP routing, please flag it in the PR
   description. See [SECURITY.md](SECURITY.md) for disclosure policy.
2. **Add tests.** We target meaningful coverage on anything in the
   cryptographic path or request flow. New routes without tests will
   be asked to grow some.
3. **Keep side effects out of module scope.** `server.ts` bootstraps
   inside `main()`; config loading, DB pool init, and background
   tasks must not run at import time so tests can import modules in
   isolation.
4. **Immutability by default.** Return new objects instead of mutating
   inputs. See `.claude/rules/typescript/coding-style.md` if you use
   Claude Code.

## Getting Set Up

```bash
# Node 20+ required (uses fetch, AbortController, and WebCrypto)
npm install
npm run build --workspaces --if-present
npm run test --workspaces --if-present
```

There is no separate test runner step per package — vitest is wired
into each workspace and run together from the root.

## Workspace Map

| Package | Purpose |
|---|---|
| [packages/connector](packages/connector) | Express-based UCP/1.0 server, adapters (Shopify, WooCommerce), Shopify OAuth install flow, webhook handlers, persistence stores |
| [packages/cli](packages/cli) | `acc` CLI — init wizard, wallet keystore, Shopify OAuth helper, EIP-712 marketplace publish |
| [packages/skill-spec](packages/skill-spec) | Canonical JSON, EIP-712 `MarketplaceSubmission`, markdown skill parser, JSON Schemas |

Dependency direction is one-way: `connector` and `cli` can depend on
`skill-spec`, but not on each other.

## Branches, Commits, PRs

- Branch from `main`. Name branches `type/short-summary`
  (`feat/shopify-webhook-queue`, `fix/cart-token-expiry`).
- Commit messages follow Conventional Commits:
  `feat(scope): summary` / `fix(scope): summary` / `docs: …`.
- Before opening a PR:
  - `npm run build --workspaces --if-present` — clean.
  - `npm run test --workspaces --if-present` — all tests pass.
  - If you touched any route, add or update a test that pins the
    new behaviour.
- PR description should name the affected subsystem and briefly
  explain the "why" — reviewers benefit from the context that isn't
  in the diff.

## What We Don't Merge

- Changes that disable or loosen HMAC / signature verification,
  constant-time comparison, or body-size caps without a clear
  replacement control and an explicit rationale.
- New module-level side effects (top-level `await`, singleton
  construction at import, environment reads outside `config/*`).
- Dead code or exported symbols with no callers — run
  `refactor-cleaner` or its equivalent before proposing removal.
- Anything that introduces a hardcoded secret, even in an example.
  Use `.env.example` placeholders.

## Talking to the Maintainers

- Bugs & feature requests: open an issue.
- Security: **do not** open a public issue — see
  [SECURITY.md](SECURITY.md).
- Questions about architecture direction: check `docs/plans/` first,
  then open a discussion.

Welcome, and thanks for reading this far.
