// Public re-export surface for `@acc/connector/shopify-oauth`.
//
// The CLI consumes this entry when it needs to write a completed
// Shopify installation into the merchant's local SQLite store — in
// particular, the install-relay flow (M2) where tokens come back from
// the relay's /pair/poll response and must be persisted alongside
// any tokens the connector's own OAuth routes would write.
//
// Keep this file a thin re-export only. Internal modules (state store,
// token-cipher, HMAC helpers) remain reachable via deep imports for
// tests but are NOT part of the supported public surface.

export {
  createSqliteInstallationStore,
  type SqliteInstallationStore,
  type SqliteInstallationStoreOptions,
} from "./installation-store-sqlite.js";
export type { InstallationStore } from "./installation-store.js";
export type { ShopInstallation } from "./types.js";
