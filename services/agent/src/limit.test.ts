import assert from "node:assert/strict";
import { test } from "node:test";
import { clientAddress } from "./limit.ts";

const req = (headers: Record<string, string>, ip = "10.0.0.2") => ({ ip, get: (name: string) => headers[name.toLowerCase()] });

test("the limits count the client's address: req.ip, or the edge's header when CLIENT_IP_HEADER names one", () => {
  delete process.env.CLIENT_IP_HEADER;
  assert.equal(clientAddress(req({ "x-real-ip": "203.0.113.9" })), "10.0.0.2"); // a header nobody vouches for is ignored
  process.env.CLIENT_IP_HEADER = "x-real-ip";
  try {
    assert.equal(clientAddress(req({ "x-real-ip": " 203.0.113.9 " })), "203.0.113.9");
    assert.equal(clientAddress(req({})), "10.0.0.2"); // no header, as on a request that skipped the edge
  } finally {
    delete process.env.CLIENT_IP_HEADER;
  }
});
