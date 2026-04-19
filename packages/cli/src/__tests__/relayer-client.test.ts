import { describe, expect, it, vi } from "vitest";
import {
  InstallInterruptedError,
  pollUntilReady,
  RelayerClient,
} from "../shared/relayer-client.js";

function makeFetchStub(
  handler: (req: { url: string; init?: RequestInit }) => Response | Promise<Response>,
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler({ url, init });
  }) as unknown as typeof fetch;
}

describe("RelayerClient.pairNew", () => {
  it("POSTs shop_domain + connector_url and returns the pair payload", async () => {
    const fetchImpl = makeFetchStub(({ url, init }) => {
      expect(url).toBe("https://r.test/relayer/pair/new");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        shop_domain: "foo.myshopify.com",
        connector_url: "https://acc.foo.com",
      });
      return new Response(
        JSON.stringify({
          pair_code: "abc",
          install_url: "https://foo.myshopify.com/admin/oauth/authorize?...",
          poll_url: "https://r.test/relayer/pair/poll?code=abc",
          expires_in: 600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    const res = await client.pairNew({
      shopDomain: "foo.myshopify.com",
      connectorUrl: "https://acc.foo.com",
    });
    expect(res.pair_code).toBe("abc");
  });

  it("strips a trailing slash from the relay URL", async () => {
    const fetchImpl = makeFetchStub(({ url }) => {
      // Must not have `//pair/new`.
      expect(url).toBe("https://r.test/relayer/pair/new");
      return new Response(
        JSON.stringify({
          pair_code: "abc",
          install_url: "x",
          poll_url: "y",
          expires_in: 600,
        }),
        { status: 200 },
      );
    });
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer/",
      fetchImpl,
    });
    await client.pairNew({
      shopDomain: "foo.myshopify.com",
      connectorUrl: "https://acc.foo.com",
    });
  });

  it("throws on non-2xx with the upstream body in the message", async () => {
    const fetchImpl = makeFetchStub(
      () =>
        new Response(JSON.stringify({ error: "invalid_shop" }), {
          status: 400,
        }),
    );
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    await expect(
      client.pairNew({
        shopDomain: "bogus",
        connectorUrl: "https://acc.foo.com",
      }),
    ).rejects.toThrow(/pair\/new returned 400.*invalid_shop/);
  });
});

describe("RelayerClient.pairPoll", () => {
  it("maps 404 to status:unknown without throwing", async () => {
    const fetchImpl = makeFetchStub(() => new Response("", { status: 404 }));
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    const res = await client.pairPoll("never");
    expect(res).toEqual({ status: "unknown" });
  });

  it("maps 410 to status:expired without throwing", async () => {
    const fetchImpl = makeFetchStub(() => new Response("", { status: 410 }));
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    const res = await client.pairPoll("expired");
    expect(res).toEqual({ status: "expired" });
  });

  it("passes through the ready payload verbatim", async () => {
    const fetchImpl = makeFetchStub(
      () =>
        new Response(
          JSON.stringify({
            status: "ready",
            shop_domain: "foo.myshopify.com",
            access_token: "shpat_x",
            storefront_token: "sf_x",
            scopes: ["read_products"],
            refresh_token: null,
            token_expires_at: null,
          }),
          { status: 200 },
        ),
    );
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    const res = await client.pairPoll("abc");
    expect(res).toMatchObject({
      status: "ready",
      access_token: "shpat_x",
    });
  });
});

describe("pollUntilReady loop", () => {
  it("returns the ready payload on the first ready response", async () => {
    let calls = 0;
    const fetchImpl = makeFetchStub(() => {
      calls++;
      if (calls < 3) {
        return new Response(
          JSON.stringify({ status: "pending", expires_in: 500 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          status: "ready",
          shop_domain: "foo.myshopify.com",
          access_token: "shpat_x",
          storefront_token: null,
          scopes: [],
          refresh_token: null,
          token_expires_at: null,
        }),
        { status: 200 },
      );
    });
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    let virtualNow = 0;
    const ready = await pollUntilReady(client, "abc", {
      intervalMs: 100,
      deadlineMs: 10_000,
      now: () => virtualNow,
      sleep: async (ms) => {
        virtualNow += ms;
      },
    });
    expect(ready.status).toBe("ready");
    expect(calls).toBe(3);
  });

  it("throws InstallInterruptedError when the pair expires mid-poll", async () => {
    const fetchImpl = makeFetchStub(
      () => new Response("", { status: 410 }),
    );
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    await expect(
      pollUntilReady(client, "abc", {
        intervalMs: 10,
        deadlineMs: 1_000,
        now: () => 0,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(InstallInterruptedError);
  });

  it("throws InstallInterruptedError when the deadline passes without ready", async () => {
    const fetchImpl = makeFetchStub(
      () =>
        new Response(
          JSON.stringify({ status: "pending", expires_in: 10 }),
          { status: 200 },
        ),
    );
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    let virtualNow = 0;
    await expect(
      pollUntilReady(client, "abc", {
        intervalMs: 100,
        deadlineMs: 200,
        now: () => virtualNow,
        sleep: async (ms) => {
          virtualNow += ms;
        },
      }),
    ).rejects.toBeInstanceOf(InstallInterruptedError);
  });
});

describe("RelayerClient.pairConsume", () => {
  it("POSTs pair_code and tolerates idempotent success", async () => {
    const fetchImpl = makeFetchStub(({ url, init }) => {
      expect(url).toBe("https://r.test/relayer/pair/consume");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({ pair_code: "abc" });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const client = new RelayerClient({
      relayUrl: "https://r.test/relayer",
      fetchImpl,
    });
    await expect(client.pairConsume("abc")).resolves.toBeUndefined();
  });
});
