"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");
const base = path.resolve(__dirname, "..");
const { KimaiClient, normalizeBase } = require(path.join(base, "lib/kimai"));

test("Kimai: cache separates complete bearer tokens and never embeds the token", async () => {
  const old = global.fetch;
  let calls = 0;
  global.fetch = async (_url, opts) => {
    calls++;
    return { ok: true, status: 200, headers: new Headers(),
      text: async () => JSON.stringify({ account: opts.headers.Authorization }) };
  };
  try {
    const cfg = { base_url: "https://api.example.invalid", cache_seconds: 60 };
    const a = new KimaiClient({ ...cfg, token: "A-01234567" });
    const b = new KimaiClient({ ...cfg, token: "B-01234567" });
    assert.notEqual(a.cachePrefix, b.cachePrefix);
    assert.ok(!a.cachePrefix.includes("A-01234567"));
    assert.notDeepEqual(await a.get("/me", {}, { ttl: 60 }), await b.get("/me", {}, { ttl: 60 }));
    await a.get("/me", {}, { ttl: 60 }); await b.get("/me", {}, { ttl: 60 });
    assert.equal(calls, 2);
  } finally { global.fetch = old; }
});


test("Kimai: URL credentials and ambiguous query/fragment rejected", () => {
  for (const u of ["https://user:pw@api.example.invalid", "https://api.example.invalid?x=y", "https://api.example.invalid/#x"])
    assert.throws(() => normalizeBase(u));
});


test("Kimai: no credential-bearing redirects", async () => {
  const old = global.fetch;
  global.fetch = async (_url, opts) => {
    assert.equal(opts.redirect, "manual");
    return { status: 302, headers: new Headers({ location: "https://other.example.invalid" }) };
  };
  try {
    await assert.rejects(() => new KimaiClient({ base_url: "https://redirect.example.invalid", token: "test-token" }).get("/me"), /Weiterleitungen/);
  } finally { global.fetch = old; }
});

