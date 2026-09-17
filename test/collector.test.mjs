import assert from "node:assert/strict";
import test from "node:test";
import collector from "../src/collector.ts";

const env = { TRACKED_HOST: "example.com", AI_TRACKER_URL: "https://tracker.example", INGEST_TOKEN: "test-only-private-key" };
const request = (url = "https://example.com/", method = "GET", userAgent = "GPTBot") => new Request(url, {
  method, headers: { "user-agent": userAgent, "cf-connecting-ip": "192.0.2.1", cookie: "private=cookie" },
});

test("fetch preserves request and streaming response while ingestion stays in waitUntil", async (t) => {
  const original = request("https://example.com/pricing?private=yes");
  const response = new Response("original bytes", { status: 302, headers: { location: "/next", "set-cookie": "a=b" } });
  const origin = t.mock.method(globalThis, "fetch", async (req) => { assert.equal(req, original); return response; });
  let event;
  let finish;
  const binding = { ...env, TRACKER: { fetch: (req) => { event = req; return new Promise((resolve) => { finish = resolve; }); } } };
  const pending = [];
  const result = await collector.fetch(original, binding, { waitUntil: (promise) => pending.push(promise), passThroughOnException() {} });
  assert.equal(result, response);
  assert.equal(result.bodyUsed, false);
  assert.equal(origin.mock.callCount(), 1);
  assert.equal(pending.length, 1);
  assert.equal(event.url, "https://tracker.example/api/ingest");
  assert.equal(event.headers.get("Authorization"), `Bearer ${env.INGEST_TOKEN}`);
  assert.equal(event.headers.get("cookie"), null);
  assert.equal(event.redirect, "manual");
  assert.deepEqual(await event.json(), {
    href: "https://example.com/pricing",
    ai: { userAgent: "GPTBot", ip: "192.0.2.1", statusCode: 302, source: "cloudflare-worker" },
  });
  finish(new Response(null, { status: 204 }));
  await Promise.all(pending);
});

test("exact-host and method guards apply to pages and discovery files; static subresources are skipped", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  const events = [];
  const binding = { ...env, TRACKER: { fetch: async (req) => { events.push(await req.json()); return new Response(null, { status: 204 }); } } };
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise), passThroughOnException() {} };
  for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt", "/article", "/pricing", "/blog/v1.2", "/style.css", "/asset.js", "/image.webp", "/_next/image", "/favicon.ico"]) {
    await collector.fetch(request(`https://example.com${path}`, "HEAD"), binding, ctx);
  }
  for (const req of [request("https://www.example.com/"), request("https://example.com.evil.test/"), request("https://other.example/"), request(undefined, "POST"), request(undefined, "GET", "Mozilla/5.0")]) {
    await collector.fetch(req, binding, ctx);
  }
  for (const vars of [{ INGEST_TOKEN: "" }, { AI_TRACKER_URL: "" }, { AI_TRACKER_URL: "http://tracker.example" }, { AI_TRACKER_URL: "https://example.com" }, { AI_TRACKER_URL: "https://user:pass@tracker.example" }]) {
    await collector.fetch(request(), { ...binding, ...vars }, ctx);
  }
  await Promise.all(pending);
  // Pages and discovery files only; the five static subresources are skipped.
  assert.equal(events.length, 6);
  assert.deepEqual(events.map((e) => new URL(e.href).pathname), ["/robots.txt", "/sitemap.xml", "/llms.txt", "/article", "/pricing", "/blog/v1.2"]);
});

test("native fetch ingestion uses secret binding and tracking errors cannot alter origin response", async (t) => {
  const response = new Response("ok");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (req) => {
    if (++calls === 1) return response;
    assert.equal(req.url, "https://tracker.example/api/ingest");
    assert.equal(req.headers.get("authorization"), `Bearer ${env.INGEST_TOKEN}`);
    throw new Error(`failed ${env.INGEST_TOKEN}`);
  });
  const logs = t.mock.method(console, "error", () => {});
  const pending = [];
  assert.equal(await collector.fetch(request(), env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} }), response);
  await Promise.all(pending);
  assert.equal(calls, 2);
  assert.match(logs.mock.calls[0].arguments[0], /tracking_failed/);
  assert.match(logs.mock.calls[0].arguments[0], /\[REDACTED\]/);
  assert.ok(!logs.mock.calls[0].arguments[0].includes(env.INGEST_TOKEN));
});

test("origin errors are not retried or replaced", async (t) => {
  const error = new Error("origin down");
  const origin = t.mock.method(globalThis, "fetch", async () => { throw error; });
  await assert.rejects(collector.fetch(request(), env, { waitUntil() { assert.fail("no response to track"); }, passThroughOnException() {} }), (caught) => caught === error);
  assert.equal(origin.mock.callCount(), 1);
});

test("tail filters exact host, uses redacted request fields, ignores non-request events and isolates errors", async (t) => {
  const events = [];
  const logs = t.mock.method(console, "error", () => {});
  const binding = { ...env, TRACKER: { fetch: async (req) => { events.push(await req.json()); return new Response("rejected", { status: 401 }); } } };
  const trace = (url) => ({ event: { request: { url, method: "GET", headers: { "user-agent": "ClaudeBot", "cf-connecting-ip": "[REDACTED]", cookie: "secret" } }, response: { status: 404 } } });
  await collector.tail([{ event: null }, { event: { scheduledTime: 1 } }, trace("bad-url"), trace("https://www.example.com/"), trace("https://example.com/robots.txt?private=1")], binding);
  assert.deepEqual(events, [{ href: "https://example.com/robots.txt", ai: { userAgent: "ClaudeBot", ip: "[REDACTED]", statusCode: 404, source: "cloudflare-tail" } }]);
  assert.ok(logs.mock.calls.some(({ arguments: [line] }) => line.includes("ingest_rejected")));
  assert.ok(logs.mock.calls.some(({ arguments: [line] }) => line.includes("tracking_failed")));
});
