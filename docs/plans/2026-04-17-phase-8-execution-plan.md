# Phase 8 — `acc init` CLI Wizard · Execution Plan

**Date:** 2026-04-17
**Status:** Ready to start (pending §0 confirmations)
**Driver doc:** [2026-04-16-phase-8-cli-wizard-structure.md](2026-04-16-phase-8-cli-wizard-structure.md)
**Scope:** `packages/cli/` only. No writes into `packages/connector/` except its existing env-var contract (`ACC_DATA_DIR`, `ACC_ENCRYPTION_KEY`, etc.).

---

## 0 · Pre-flight confirmations (BLOCKING)

From structure doc §G — these must be locked before any code is written. Defaults assumed unless vetoed:

| # | Decision | Assumed default |
|---|---|---|
| 1 | Prompt library | vanilla `node:readline` |
| 2 | `acc start` in Phase 8 | deferred to Phase 9 |
| 3 | Data dir default | `./acc-data` (project-scoped) |
| 4 | Encrypt `signer.key` at rest | opt-in `--encrypt-signer` flag only |
| 5 | Re-entrant `acc init` | detect + offer (a)/(b)/(c)/(d) |

**Action:** user signs off on the five above, or overrides. Plan proceeds as-is if silence.

---

## 1 · Phases & critical path

Sequential order (each phase = one commit, each leaf = test-first module). Phases 4–6 fan out in parallel once Phase 3 lands.

```
Phase 1 ── shared/* foundations (data-dir, keys, env-writer, config-store, prompts)
   │
Phase 2 ── acc dispatcher + help/version + bin wiring
   │
Phase 3 ── commands/init.ts  (8-step wizard)
   │
   ├── Phase 4 ── commands/shopify/connect.ts  (QR + install URL + poll)
   ├── Phase 5 ── commands/wallet/{show,new,import}.ts
   ├── Phase 6 ── commands/skill/* move under nested namespace + publish zero-arg defaults
   │
Phase 7 ── E2E acceptance (§H walkthrough on clean VPS or container)
   │
Phase 8 ── Docs + MERCHANT_ONBOARDING.md refresh + changelog
```

Single PR at the end. Reviewable target ≤ 45 min → wizard module stays < 400 lines by extracting each step into its own file under `shared/steps/`.

---

## 2 · Phase-by-phase breakdown

### Phase 1 — `shared/*` foundations

TDD order (RED → GREEN → refactor per module). Each module ≤ 150 lines, pure functions where possible.

| Module | Purpose | Test contract |
|---|---|---|
| `shared/data-dir.ts` | Resolve absolute path; create `acc-data/{keys,skill,db}` with 0700 perms; detect existing layout | rejects paths outside cwd unless absolute; idempotent re-run; returns resolved structure |
| `shared/keys.ts` | Generate 32-byte AES enc key (hex); generate secp256k1 signer key (viem); write at 0600; optional AES-256-GCM wrap with PBKDF2 (200k iters, random salt) when `--encrypt-signer` | key file perms == 0600; decrypt roundtrip; refuses to overwrite without `--force` |
| `shared/env-writer.ts` | Parse existing `.env`, upsert keys, preserve comments + ordering, emit 0600 file | idempotent on repeat run; comment preservation; does not touch unknown keys |
| `shared/config-store.ts` | Zod-validated load/save of `config.json` (v1 schema from §C); atomic write via tmp+rename | rejects unknown `dataVersion`; rejects malformed; survives torn-write via tmp swap |
| `shared/prompts.ts` | `ask(q, { default?, validate? })`, `askYesNo`, `askChoice`, `askSecret` (no echo) on `node:readline` | validator rejects bad input, re-asks; EOF returns default; secret input masked |
| `shared/open-browser.ts` | Platform detection → spawn `open` / `xdg-open` / `start`; returns bool on success | falls back silently on SSH/no-DISPLAY; no throw |
| `shared/qr.ts` | Thin wrapper over `qrcode-terminal` with small + large modes | renders deterministic ASCII for a known input string |
| `shared/data-version.ts` | Migration runner stub (dataVersion 1 → N); currently no-op for v1 | accepts v1 unchanged; throws on unsupported future version |

**Dep add:** `qrcode-terminal` (prod), `@types/node` already present, `zod` already transitively pulled — verify in `packages/cli/package.json`.

**Exit gate:** `vitest` green on all shared modules; coverage ≥ 85 % per file.

---

### Phase 2 — `acc` dispatcher + `bin` wiring

- New file `packages/cli/src/acc.ts` — pure string-routing, no business logic. Nested: `acc <domain> <verb> <flags>`.
- `packages/cli/package.json` → `"bin": { "acc": "./build/acc.js", "acc-skill": "./build/index.js" }`.
- `acc-skill` entry prints a one-line deprecation notice, then delegates; removal scheduled Phase 10+.
- New `commands/version.ts` reads `package.json#version`; `commands/help.ts` renders the full tree from §A verbatim.
- Unknown subcommand → exit 2 + print help (match existing ergonomics).

**Tests:** dispatch table unit tests (routes `acc shopify connect` → `shopify/connect#run`, etc.); help output snapshot; deprecation warning shows once.

**Exit gate:** `npx acc help`, `npx acc version`, `npx acc shopify connect --help` all work post-build.

---

### Phase 3 — `commands/init.ts` (the 8-step wizard)

Structure: `init.ts` is an orchestrator; each of the 8 steps is its own file under `shared/steps/stepN-<name>.ts` returning `{ applied: boolean, summary: string }`. Keeps `init.ts` < 150 lines.

Mapping (from structure doc §E):

1. `step1-preflight.ts` — Node ≥ 20 (`process.versions.node`); `better-sqlite3` resolvable; writable cwd.
2. `step2-data-dir.ts` — prompt → `shared/data-dir.ensure()`.
3. `step3-self-url.ts` — prompt, validate `https://` + no trailing slash, write `.env: SELF_URL`.
4. `step4-enc-key.ts` — `shared/keys.generateEncKey()`, write `keys/enc.key`, mirror into `.env: ACC_ENCRYPTION_KEY`.
5. `step5-signer.ts` — 3-way choice (generate / import / skip). Import reads hex from stdin via `askSecret`; never echoes. Optional encryption via `--encrypt-signer`.
6. `step6-shopify-partners.ts` — open Partners URL in browser (or print if headless), prompt `client_id`/`client_secret`, write `.env`.
7. `step7-sqlite.ts` — invoke existing `installation-store-sqlite` migration runner via a light shim; no schema duplicated in CLI.
8. `step8-skill-template.ts` — reuse existing `commands/init.ts` skill-md generator (rename to `commands/skill/init.ts` in Phase 6) and write under `acc-data/skill/`.

**Re-entrance:** before step 1, `config-store.load()` probes; on hit, show (a)/(b)/(c)/(d) menu from §E. (b) jumps straight to step 6. (c) writes `config.json.bak` + `.env.bak` then falls through.

**Finale:** prints a 10-line summary (data dir, SELF_URL, signer address, install URL, next-step command). No secrets printed.

**Tests:** each step in isolation with mocked `prompts` + temp dir; full wizard snapshot in `--non-interactive` mode (reserved flag — driven by `ACC_INIT_CONFIG` env pointing to a JSON seed; acceptable for tests even though interactive CLI use is Phase 9+).

**Exit gate:** `npx acc init` on a fresh temp dir completes all 8 steps and the resulting tree matches §C layout byte-for-byte (perms + files).

---

### Phase 4 — `commands/shopify/connect.ts`

- Inputs: `--shop=<X>.myshopify.com` (required), `--print-url-only` (optional, headless mode).
- Reuses connector's `adapters/shopify/oauth/state.ts` to produce a `state` nonce, persists it into SQLite via the same factory the connector uses — read-only path for CLI (CLI writes, connector reads).
- Prints large QR (via `shared/qr.ts`) + install URL + a poll note.
- Poll loop: every 2 s for up to 5 min, queries `config.json` path (or SQLite directly) for `shopify_installations` row matching `shop`; exits 0 on hit, 1 on timeout.

**Tests:** URL builder produces exact format expected by Shopify (unit); poll exits fast on mocked store hit; `--print-url-only` skips QR render.

**Exit gate:** manual smoke against a Shopify Partners dev store — install URL resolves, poll exits 0 after approve.

---

### Phase 5 — `commands/wallet/{show,new,import}.ts`

- `show` — loads `keys/signer.key`, prints **address only**. If encrypted, prompts passphrase.
- `new` — **destructive**. Requires `--yes`. Writes `keys/signer.key.bak` before overwrite. Updates `config.json.wallet.address`.
- `import` — `--key=0x<64hex>`; validates via viem; same write path as `new`.

**Tests:** `show` never logs the private key (scan stdout in test); `new` without `--yes` exits 2; `import` rejects malformed hex.

**Exit gate:** three commands round-trip: `new --yes` → `show` → `import --key=…` → `show` shows new address.

---

### Phase 6 — Skill namespace move + zero-arg `publish`

- Move `commands/init.ts` → `commands/skill/init.ts`; keep the old name as a one-line re-export under `acc-skill init` for back-compat.
- `commands/skill/edit.ts` — stub exits 0 with "Phase 9+ — edit `acc-data/skill/acc-skill.md` directly".
- `commands/skill/validate.ts` — stub re-uses existing `verify.ts` logic on the default skill path.
- `commands/publish.ts` — detect zero-arg mode: read `config.json` for `skillMdPath` + `registry` + `selfUrl`, load `keys/signer.key` for private key. Explicit flags still override. Error message when `config.json` missing points to `acc init`.

**Tests:** publish with no args on a fully-init'd fixture dir emits an EIP-712 payload identical to the explicit-flag invocation; missing config → friendly error.

**Exit gate:** `npx acc publish` (zero args) after `npx acc init` round-trips successfully against a local marketplace mock.

---

### Phase 7 — Acceptance walkthrough (§H)

Run the five-step scenario from structure doc §H in a clean container:

1. Clone + `npm install` + `npm run build`
2. `npx acc init` → all 8 steps complete
3. `npm --workspace packages/connector start` → boots, logs `Storage: SQLite (…)`
4. Laptop → install URL → Shopify OAuth approve → `/admin/shopify/installed` shows "Connected"
5. VPS → `npx acc publish` (zero args) → marketplace accepts

Capture terminal transcript into `docs/phase-8-acceptance.log` (stored in repo for posterity).

**Exit gate:** all 5 pass without manual `.env` edits, hex-key generation, or copy-paste beyond Partners creds.

---

### Phase 8 — Docs refresh

- Update [MERCHANT_ONBOARDING.md](../MERCHANT_ONBOARDING.md) step-by-step to match the actual wizard flow.
- Add `docs/CLI.md` with the full command tree + one example per command.
- Add row to repo-root CHANGELOG under `## Unreleased` (or create CHANGELOG if missing — confirm first).

**Exit gate:** docs reviewer reads `MERCHANT_ONBOARDING.md` top-to-bottom and can predict every prompt the wizard will show.

---

## 3 · Test matrix

From structure doc §J target (~20 new unit tests). Concrete breakdown:

| File | Tests | Focus |
|---|---|---|
| `shared/data-dir.test.ts` | 4 | resolve / create / idempotent / perms |
| `shared/keys.test.ts` | 5 | enc-key / signer-key / encrypt roundtrip / perms / no-overwrite |
| `shared/env-writer.test.ts` | 4 | upsert / comment-preserve / idempotent / unknown-key-untouched |
| `shared/config-store.test.ts` | 3 | schema / atomic write / bad `dataVersion` |
| `shared/prompts.test.ts` | 3 | validator-retry / default-on-EOF / secret-masked |
| `commands/init.test.ts` | 2 | full wizard snapshot / re-entrance menu |
| `commands/shopify/connect.test.ts` | 2 | URL builder / poll exit on store hit |
| `commands/wallet/*.test.ts` | 3 | show-never-leaks / new-needs-yes / import-validates |
| `commands/publish.test.ts` | 1 | zero-arg mode reads config |
| `acc.test.ts` | 2 | dispatch routing / help snapshot |

Coverage target: ≥ 85 % on new CLI code per structure doc §J.

---

## 4 · Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| SQLite migration path duplicates logic between CLI and connector | M | CLI imports connector's existing migration runner, does not redefine schema |
| `node:readline` UX feels cramped vs `@clack/prompts` | L | Escape hatch: single-file prompt lib swap in Phase 9; no deep coupling |
| Partners URL opening fails on SSH/headless and user gets stuck | M | `shared/open-browser.ts` always falls through to print URL + QR; test covers headless |
| Signer key stored plaintext by default | L (by decision §0.4) | Opt-in encryption flag; doc warns about disk-level encryption expectation |
| Zero-arg `publish` silently picks wrong registry after a config re-init | L | Print `registry` + `selfUrl` before signing; one-line confirm in interactive mode |
| SQLite missing on VPS (§E step 7) | M | Preflight check in step 1 catches before any writes; clear error + install hint |

---

## 5 · Explicit non-goals (same as §I)

Not touched in this phase:

- `acc start` / `stop` / `status` / `doctor` / `shopify status` / `shopify disconnect`
- `acc skill edit|validate` beyond stubs
- WalletConnect / MetaMask integration
- Cloud-deploy (Render) wizard
- Full `--non-interactive --config=yaml` pipeline — flag reserved, seed-via-env acceptable for tests only

---

## 6 · Deliverables checklist

- [ ] §0 decisions locked
- [ ] Phase 1: 8 shared modules + tests green
- [ ] Phase 2: `acc` dispatcher + bin wiring + help/version
- [ ] Phase 3: 8-step wizard with per-step file split
- [ ] Phase 4: `acc shopify connect` with QR + poll
- [ ] Phase 5: three wallet commands round-trip
- [ ] Phase 6: skill namespace move + zero-arg publish
- [ ] Phase 7: §H walkthrough transcript committed
- [ ] Phase 8: MERCHANT_ONBOARDING + CLI docs
- [ ] Single PR opened against `main`; review comments addressed; squash-merge
