// Pins the DoS-fix contract: readBody MUST reject bodies over the cap
// with a typed error rather than accumulating unbounded chunks.

import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import {
  BodyTooLargeError,
  MAX_BODY_JSON_API,
  readBody,
} from "../http-utils.js";

function makeFakeReq(): IncomingMessage & {
  emitChunk(buf: Buffer): void;
  emitEnd(): void;
  destroyed: boolean;
} {
  const ee = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    destroy: () => void;
    emitChunk: (buf: Buffer) => void;
    emitEnd: () => void;
  };
  ee.destroyed = false;
  ee.destroy = () => {
    ee.destroyed = true;
  };
  ee.emitChunk = (buf: Buffer) => ee.emit("data", buf);
  ee.emitEnd = () => ee.emit("end");
  return ee as unknown as IncomingMessage & {
    emitChunk(buf: Buffer): void;
    emitEnd(): void;
    destroyed: boolean;
  };
}

describe("readBody", () => {
  it("resolves with the concatenated body when under the cap", async () => {
    const req = makeFakeReq();
    const p = readBody(req, MAX_BODY_JSON_API);
    req.emitChunk(Buffer.from("hello "));
    req.emitChunk(Buffer.from("world"));
    req.emitEnd();
    await expect(p).resolves.toBe("hello world");
  });

  it("rejects with BodyTooLargeError exactly once, even if more chunks arrive", async () => {
    const req = makeFakeReq();
    const p = readBody(req, 4);
    req.emitChunk(Buffer.from("aa"));
    req.emitChunk(Buffer.from("bbbb")); // crosses the cap → reject
    req.emitChunk(Buffer.from("cccccc")); // must be ignored after abort
    await expect(p).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(req.destroyed).toBe(true);
  });

  it("BodyTooLargeError carries the configured limit on its message", async () => {
    const req = makeFakeReq();
    const p = readBody(req, 8);
    req.emitChunk(Buffer.from("x".repeat(16)));
    await p.catch((err) => {
      expect(err).toBeInstanceOf(BodyTooLargeError);
      expect((err as BodyTooLargeError).status).toBe(413);
      expect((err as Error).message).toContain("8");
    });
  });
});
