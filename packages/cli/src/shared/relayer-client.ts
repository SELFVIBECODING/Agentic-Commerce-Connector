// ---------------------------------------------------------------------------
// HTTP client for the ACC install relay.
//
// Speaks the relay-protocol/1.0.0 contract documented in
// docs/spec/relayer-protocol.md. Used by step 7 (Shopify install
// method) when the merchant picks the Silicon Retail relayer option
// instead of pasting their own Partners credentials.
//
// Runtime has no dependency on the relay: once /pair/consume returns,
// the tokens live in the merchant's SQLite + .env and the relay is out
// of the data path until token refresh (M4) / GDPR webhook forwarding
// (M5) land.
// ---------------------------------------------------------------------------

export interface PairNewResponse {
  readonly pair_code: string;
  readonly install_url: string;
  readonly poll_url: string;
  readonly expires_in: number;
}

export type PairPollResponse =
  | PairPollPending
  | PairPollReady
  | PairPollExpired
  | PairPollUnknown;

export interface PairPollPending {
  readonly status: "pending";
  readonly expires_in: number;
}

export interface PairPollReady {
  readonly status: "ready";
  readonly shop_domain: string;
  readonly access_token: string;
  readonly storefront_token: string | null;
  readonly scopes: readonly string[];
  readonly refresh_token: string | null;
  readonly token_expires_at: number | null;
  /** M3+ only — per-shop HMAC key for GDPR forward verification. May be absent against M1 relays. */
  readonly relay_secret?: string;
}

export interface PairPollExpired {
  readonly status: "expired";
}

export interface PairPollUnknown {
  readonly status: "unknown";
}

export interface RelayerClientOptions {
  readonly relayUrl: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class RelayerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RelayerClientOptions) {
    // Strip trailing slash once at construction so the append-path sites
    // below don't each guard the same case.
    this.baseUrl = opts.relayUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async pairNew(input: {
    readonly shopDomain: string;
    readonly connectorUrl: string;
  }): Promise<PairNewResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/pair/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_domain: input.shopDomain,
        connector_url: input.connectorUrl,
      }),
    });
    if (!res.ok) {
      throw await relayError(res, "pair/new");
    }
    return (await res.json()) as PairNewResponse;
  }

  async pairPoll(pairCode: string): Promise<PairPollResponse> {
    const url = `${this.baseUrl}/pair/poll?code=${encodeURIComponent(pairCode)}`;
    const res = await this.fetchImpl(url, { method: "GET" });
    // 404 is an expected terminal state for /pair/poll, not an HTTP-level
    // failure — surface it as {status: "unknown"} so the caller's state
    // machine has one code path for every outcome.
    if (res.status === 404) {
      return { status: "unknown" };
    }
    if (res.status === 410) {
      return { status: "expired" };
    }
    if (!res.ok) {
      throw await relayError(res, "pair/poll");
    }
    return (await res.json()) as PairPollResponse;
  }

  async pairConsume(pairCode: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/pair/consume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair_code: pairCode }),
    });
    if (!res.ok) {
      throw await relayError(res, "pair/consume");
    }
  }
}

async function relayError(res: Response, op: string): Promise<Error> {
  const bodyText = await res.text().catch(() => "");
  return new Error(
    `[Relay] ${op} returned ${res.status}${
      bodyText ? `: ${bodyText.slice(0, 200)}` : ""
    }`,
  );
}

/**
 * Poll the relay until the pair session terminates. Returns the
 * `ready` payload or throws an InstallInterruptedError on any other
 * terminal state (expired, unknown, or the caller-supplied deadline).
 *
 * Interval + deadline are caller-controlled so the init wizard can use
 * 2s/600s (the spec's recommended cadence) while tests can compress
 * the loop to millisecond scale.
 */
export async function pollUntilReady(
  client: RelayerClient,
  pairCode: string,
  opts: {
    readonly intervalMs: number;
    readonly deadlineMs: number;
    readonly now?: () => number;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly onPending?: (remainingMs: number) => void;
  },
): Promise<PairPollReady> {
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + opts.deadlineMs;

  while (true) {
    const res = await client.pairPoll(pairCode);
    if (res.status === "ready") return res;
    if (res.status === "expired") {
      throw new InstallInterruptedError(
        "The install link expired before you approved it on Shopify. Re-run `acc init shopify` to start again.",
      );
    }
    if (res.status === "unknown") {
      throw new InstallInterruptedError(
        "The relay no longer recognises this pair code (it may have been consumed already or never existed). Re-run `acc init shopify`.",
      );
    }
    // status === "pending" — keep polling.
    if (opts.onPending) opts.onPending(Math.max(0, deadline - now()));
    if (now() + opts.intervalMs >= deadline) {
      throw new InstallInterruptedError(
        "Timed out waiting for you to approve the install on Shopify. Re-run `acc init shopify` if you need more time.",
      );
    }
    await sleep(opts.intervalMs);
  }
}

export class InstallInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallInterruptedError";
  }
}
