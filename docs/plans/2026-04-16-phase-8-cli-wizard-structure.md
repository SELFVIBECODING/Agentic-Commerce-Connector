# Phase 8 — `acc init` CLI Wizard · Structure Design

**Date:** 2026-04-16
**Status:** Draft — pending user confirmation on §G decisions before implementation starts
**Depends on:** Phases 1–7 (OAuth flow + SQLite persistence + `/admin/shopify` + `/.well-known/acc-skill.md`)
**Consumes:** Merchant onboarding doc at [../MERCHANT_ONBOARDING.md](../MERCHANT_ONBOARDING.md); design doc at [2026-04-16-shopify-oauth-design.md](2026-04-16-shopify-oauth-design.md)

---

## A · Command tree (final shape)

```
acc init [--data-dir=./acc-data] [--non-interactive]
acc shopify connect --shop=<X>.myshopify.com [--print-url-only]
acc skill init [--out=PATH] [--force]
acc skill edit               # opens $EDITOR
acc skill validate           # validates frontmatter
acc publish [FILE] [--url] [--registry] [--private-key]
acc wallet show              # prints address only, never the private key
acc wallet new               # regenerate (destructive; requires --yes)
acc wallet import --key=0x...
acc version
acc help [command]

# Placeholder stubs in Phase 8 (not implemented yet):
acc start / stop / status    # connector lifecycle
acc doctor                   # diagnostics
acc shopify status|disconnect
```

Design: **nested subcommands** (`acc shopify connect`, `acc skill init`, `acc wallet show`). Scales when we add other platforms (`acc woocommerce …`) or domains (`acc marketplace …`). Flat naming would collide the moment a third platform shows up.

---

## B · File layout (`packages/cli/`)

```
packages/cli/
├── package.json            # bin: { acc, acc-skill (deprecated alias) }
├── src/
│   ├── acc.ts              # NEW — `acc` dispatcher (nested routing)
│   ├── index.ts            # EXISTING — `acc-skill` entry; emits deprecation warning
│   ├── commands/
│   │   ├── init.ts                     # NEW — 8-step wizard (the heavy lift)
│   │   ├── publish.ts                  # EXISTING — enhanced with zero-arg defaults
│   │   ├── skill/
│   │   │   ├── init.ts                 # EXISTING — moved under `acc skill init`
│   │   │   ├── edit.ts                 # STUB — placeholder for Phase 9+
│   │   │   └── validate.ts             # STUB
│   │   ├── shopify/
│   │   │   └── connect.ts              # NEW — QR print + install-URL + poll
│   │   ├── wallet/
│   │   │   ├── show.ts                 # NEW
│   │   │   ├── new.ts                  # NEW (destructive, requires --yes)
│   │   │   └── import.ts               # NEW
│   │   ├── version.ts                  # NEW
│   │   └── help.ts                     # NEW
│   ├── shared/
│   │   ├── config-store.ts             # read/write acc-data/config.json
│   │   ├── env-writer.ts               # idempotent .env merge (preserves comments)
│   │   ├── keys.ts                     # generate signer + enc key; chmod 600
│   │   ├── data-dir.ts                 # resolve + create acc-data/* layout
│   │   ├── prompts.ts                  # readline-based input helpers
│   │   ├── open-browser.ts             # open / xdg-open / start detection
│   │   └── qr.ts                       # qrcode-terminal wrapper
│   └── verify.ts                       # EXISTING — retained
└── build/                              # tsc output
```

**Boundary rule:** the CLI package writes into `acc-data/` and reads from env + flags. The connector package reads `acc-data/` (via `ACC_DATA_DIR` env and the Phase 4 factory) and never mutates it. Clean unidirectional dependency, and `@acc/connector` stays unaware of the CLI.

---

## C · `acc-data/` layout (produced by `acc init`)

```
acc-data/
├── config.json        # { registry, selfUrl, chainId, skillMdPath, dataVersion: 1 }
├── .env               # Shopify creds + ACC_ENCRYPTION_KEY + PORTAL_TOKEN + DATABASE_URL (optional)
├── keys/
│   ├── enc.key        # 32 bytes hex, 0600 — token encryption at rest (Phase 4)
│   └── signer.key     # EIP-712 wallet private key, 0600 — marketplace submissions
├── skill/
│   └── acc-skill.md   # exposed at /.well-known/acc-skill.md (Phase 7)
└── db/
    └── acc.sqlite     # SQLite installation store (Phase 4)
```

`config.json` schema (strict, versioned):

```json
{
  "dataVersion": 1,
  "registry": "https://api.siliconretail.com",
  "chainId": 1,
  "selfUrl": "https://acc.myshop.com",
  "skillMdPath": "./acc-data/skill/acc-skill.md",
  "wallet": {
    "address": "0x1234abcd…",
    "encrypted": false
  }
}
```

Every CLI subcommand loads `config.json` + `.env` from the resolved data dir. Single source of truth across the tree.

---

## D · New dependencies (one)

- **`qrcode-terminal`** — pure JS, ~10 KB. SSH-without-DISPLAY scenario uses this to let a phone or local browser scan the OAuth install URL.

Interactive prompts: **vanilla `node:readline`** (zero new deps). Keeps the supply-chain surface small, matches the self-host-first OSS stance, loses only minor UI polish vs `@clack/prompts`.

---

## E · `acc init` wizard — 8 steps

Each step is a self-contained function under `src/shared/` + `src/commands/init.ts`. Validation fails fast; already-configured states are detected and offered for update.

| Step | Prompt / action | Writes |
|---|---|---|
| 1 | Dependency check (Node ≥ 20, SQLite available) | — |
| 2 | Data directory path (default `./acc-data`) | Creates `acc-data/{keys,skill,db}` |
| 3 | Public HTTPS URL for this machine | `.env: SELF_URL` |
| 4 | Generate AES-256 encryption key | `keys/enc.key` (0600), `.env: ACC_ENCRYPTION_KEY` |
| 5 | Marketplace signer wallet (generate / import / skip) | `keys/signer.key` (0600), `config.json.wallet.address` |
| 6 | Shopify Partners app (open browser + collect client_id/secret, or `m` to switch to manual mode) | `.env: SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET` |
| 7 | SQLite migration | `db/acc.sqlite` with `shopify_installations` table |
| 8 | Skill template | `skill/acc-skill.md` |

Finale: prints `config.json` summary, the install link, and a "run `npm --workspace packages/connector start` next" pointer.

**Re-entrance:** detecting a pre-existing `config.json` prompts the operator:

```
Found existing config at ./acc-data/config.json.
  (a) keep as-is (exit)
  (b) update Shopify credentials only
  (c) start over (destructive; backs up current as config.json.bak)
  (d) cancel
```

Option (c) writes a `.bak` suffix so no state is irretrievably lost.

---

## F · `acc start` decision

**Deferred to Phase 9.** Reasons:

- Cross-package binary resolution (`@acc/cli` spawning `@acc/connector`'s `build/server.js`) needs care for monorepo dev vs global-install deploy paths.
- Env-var propagation + child-process signalling is a chunk of work that adds no user value over `npm --workspace packages/connector start`.
- `acc init` finishing with a printed **Next: run `npm --workspace packages/connector start`** is honest about the shape; OSS users who clone the repo know the workflow.

If Phase 8 lands and the extra step feels wrong, Phase 9 adds `acc start` as a ~50-line spawn wrapper — easy retrofit.

---

## G · Pre-flight decisions — awaiting confirmation

The five choices below need an answer before coding starts. Defaults that match the self-host-first stance are marked ✅; the user can veto any individually.

| # | Decision | Default | Alternative |
|---|---|---|---|
| 1 | Prompt library | ✅ vanilla `node:readline` (0 new deps, simple UI) | `@clack/prompts` (+20 KB, modern UX) |
| 2 | `acc start` in Phase 8 | ✅ defer to Phase 9 | include now |
| 3 | Data dir default | ✅ `./acc-data` (project-scoped; per-cwd) | `~/.acc/` (user-global) |
| 4 | Encrypt `signer.key` at rest | ✅ add `--encrypt-signer` opt-in flag using `ACC_SIGNER_PASSPHRASE` + PBKDF2 + AES-256-GCM | leave plaintext on disk (0600 only) |
| 5 | Re-entrant `acc init` behaviour | ✅ detect existing `config.json` and offer (a)/(b)/(c)/(d) as described in §E | overwrite without prompt (destructive) |

---

## H · Acceptance criteria for Phase 8

A clean VPS running Node 20 should complete the following in one terminal session:

1. `git clone <repo> && cd Agentic-Commerce-Connector && npm install && npm run build`
2. `npx acc init` → wizard completes 8 steps, writes `acc-data/*`, prints install link
3. `npm --workspace packages/connector start` → connector boots, logs `Storage: SQLite (…)`, exposes `/admin/shopify` (bearer-gated) + `/.well-known/acc-skill.md`
4. From a laptop: open the install link, approve scopes on Shopify, land on `/admin/shopify/installed` with "Connected"
5. Back on the VPS: `npx acc publish` (zero args) → reads `acc-data/skill/acc-skill.md`, derives URL + registry from `config.json`, signs with `keys/signer.key`, POSTs, prints success

No manual `.env` editing. No manual token copy-paste between Shopify admin and the connector beyond the Partners `client_id` / `client_secret`. No manual hex-key generation.

---

## I · Out of scope for Phase 8 (explicit deferrals)

- `acc start` / `stop` / `status` — connector lifecycle as CLI command (Phase 9)
- `acc doctor` — diagnostics (Phase 9)
- `acc shopify status` / `disconnect` — the `/admin/shopify` web page already covers observation; disconnect is uncommon (Phase 9+)
- `acc skill edit` / `validate` — nice-to-have but a text editor already works (Phase 9+)
- WalletConnect / MetaMask external wallet integration — Phase 8 only supports "generate" + "paste 0x hex" (Phase 10+)
- Render / cloud deployment wizard — separate `docs/DEPLOY_RENDER.md` path (not Phase 8)
- Non-interactive CI mode (`--non-interactive --config=yaml`) — flag reserved in signature but implementation deferred

---

## J · Estimated shape

- ~8 new modules under `src/shared/`
- ~12 new/updated command files under `src/commands/`
- ~20 new unit tests covering wizard steps + env-writer idempotency + key generation + prompt helpers
- 1 new dependency (`qrcode-terminal`)
- Single PR, reviewable in ~45 minutes if the wizard module is kept < 400 lines by extracting steps

Critical path: `data-dir.ts` → `keys.ts` → `env-writer.ts` → `config-store.ts` → `init.ts` → `acc.ts` dispatcher. `shopify/connect.ts` and `wallet/*` land in parallel after the shared modules exist.
