# `acc` CLI Reference

`acc` is the single entry point for merchant tooling — init wizard, Shopify
OAuth helper, wallet management, skill scaffold, marketplace publish.

The older `acc-skill` binary is retained as a deprecated alias and emits a
one-line warning. New workflows should use `acc`.

## Install

The CLI ships as `@acc/cli` inside the monorepo. After `npm install && npm
run build`, invoke via `npx acc …` or add `packages/cli/build` to `PATH`.

## Command tree

```
acc init [--data-dir=./acc-data] [--force] [--non-interactive]
acc shopify connect --shop=<X>.myshopify.com [--print-url-only]
acc skill init [--out=PATH] [--force]
acc skill edit                      (Phase 9+)
acc skill validate                  (Phase 9+)
acc publish [FILE] [--url=URL] [--registry=URL] [--private-key=HEX]
acc wallet show
acc wallet new --yes                (destructive)
acc wallet import --key=0x<64hex> [--encrypt-passphrase=...]
acc version
acc help [topic]

# Placeholders (Phase 9+):
acc start | stop | status
acc doctor
acc shopify status | disconnect
```

## `acc init`

10-step interactive wizard. Provisions `acc-data/` with sane defaults and
writes `.env` + `config.json` atomically.

```bash
acc init shopify         # explicit platform
acc init                 # pick platform from a menu
```

Steps (Shopify platform):

1. Preflight
2. Data directory
3. Public URL
4. Encryption key
5. Marketplace signer
6. **Payment methods** — asks which rails your storefront accepts. Phase 1 offers only **"No payment methods yet"**; writes `PAYMENT_PROVIDER=none` to `.env`. Nexus/PlatON, Stripe, x402 arrive later.
7. Shopify Partners creds
8. SQLite migration
9. **Categories (multi-select)** — Fashion, Electronics, Books, Home, Food, Services, Digital, Travel. Comma-separated letters.
10. Skill template (auto-served at `${SELF_URL}/.well-known/acc-skill.md`)

Re-running detects an existing `config.json` and offers:

| Key | Action |
|---|---|
| `a` | Keep as-is and exit |
| `b` | Re-run Shopify install (skip to step 8 — pick self-hosted or relayer) |
| `c` | Start over (backs up old config to `config.json.bak`) |
| `d` | Cancel |

### Non-interactive mode

For CI / automated deploy, set `ACC_INIT_CONFIG` to a JSON seed:

```bash
ACC_INIT_CONFIG='{"selfUrl":"https://acc.example.com","registry":"https://api.siliconretail.com","chainId":1,"shopifyClientId":"...","shopifyClientSecret":"...","signer":"generate"}' \
  npx acc init --data-dir=./acc-data
```

## `acc shopify connect`

Prints the install URL + a terminal QR, then polls SQLite until install completes.

```bash
npx acc shopify connect --shop=myshop.myshopify.com
```

Flags:
- `--print-url-only` — skip QR + polling (useful over SSH without a tty)
- `--data-dir=PATH` — override default `./acc-data`

## `acc publish`

Zero-arg mode reads `config.json` for `selfUrl` / `registry` / `skillMdPath`
and `keys/signer.key` for the signing key:

```bash
npx acc publish
```

Explicit mode overrides any or all of the above:

```bash
npx acc publish ./skill.md \
  --url=https://myshop.com/.well-known/acc-skill.md \
  --registry=https://api.siliconretail.com \
  --private-key=0x...
```

## `acc wallet`

| Command | What it does |
|---|---|
| `acc wallet show` | Prints the current signer address. Never prints the private key. Prompts for passphrase if `signer.key` is encrypted. |
| `acc wallet new --yes` | Regenerates `signer.key`. Destructive; writes `signer.key.bak` first. Requires `--yes` to confirm. |
| `acc wallet import --key=0x<64hex>` | Replaces `signer.key` with an imported key. Writes `signer.key.bak` first. |

Optional at-rest encryption for both `new` and `import`:

```bash
npx acc wallet new --yes --encrypt-passphrase='correct horse battery staple'
```

Encrypts with PBKDF2-SHA256 (200k iters) + AES-256-GCM. Decrypt prompt fires
automatically on `show` / `publish`.

## `acc-data/` layout

```
acc-data/
├── config.json        # registry, selfUrl, chainId, skillMdPath, wallet{address,encrypted}
├── .env               # SELF_URL, ACC_ENCRYPTION_KEY, SHOPIFY_CLIENT_ID/SECRET
├── keys/
│   ├── enc.key        # 32-byte AES-256 key (0600)
│   └── signer.key     # EIP-712 private key (0600), optionally PBKDF2+GCM wrapped
├── skill/
│   └── acc-skill.md   # skill package template
└── db/
    └── acc.sqlite     # Shopify installations
```

The connector reads from `acc-data/` via `ACC_DATA_DIR` env. The CLI writes
to it. Dependency direction is one-way — the connector never mutates CLI
state.
