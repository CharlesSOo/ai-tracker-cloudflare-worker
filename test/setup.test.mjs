import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hostname, trackerOrigin, siteConfig, main } from "../scripts/setup.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("setup validates exact DNS hostnames and HTTPS origins", () => {
  assert.equal(hostname("WWW.Example.com"), "www.example.com");
  assert.equal(hostname("xn--bcher-kva.example"), "xn--bcher-kva.example");
  for (const host of [undefined, "", "localhost", "*.example.com", "https://example.com", "example.com/", "example.com:443", "example.com.", " example.com", "example..com", "-a.example", "a-.example", "a_b.example", "127.0.0.1", "0x7f.1", "a".repeat(64) + ".com", ("a".repeat(63) + ".").repeat(4) + "com"]) {
    assert.throws(() => hostname(host), undefined, String(host));
  }
  assert.equal(trackerOrigin("https://TRACKER.example:443/"), "https://tracker.example");
  assert.equal(trackerOrigin("https://tracker.example:8443"), "https://tracker.example:8443");
  for (const url of [undefined, "", "http://tracker.example", "https://tracker.example/api", "https://tracker.example/a/..", "https://tracker.example?x", "https://tracker.example#", "https://user:pass@tracker.example", "https://tracker.example\\evil", "https://tracker.example\n", "https://localhost", "https://127.0.0.1"]) {
    assert.throws(() => trackerOrigin(url), undefined, String(url));
  }
  assert.throws(() => siteConfig("tracker.example", "https://tracker.example:8443"), /different hostnames/);
});

test("setup writes deterministic per-domain config and check refuses unconfigured or mismatched config", (t) => {
  mkdirSync(join(root, ".wrangler"), { recursive: true });
  const dir = mkdtempSync(join(root, ".wrangler/setup-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "wrangler.jsonc");
  const template = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  // Tests still run after a user configures their checkout.
  const base = { ...JSON.parse(template), name: "ai-tracker-unconfigured", vars: { TRACKED_HOST: "", AI_TRACKER_URL: "" } };
  writeFileSync(path, JSON.stringify(base));
  assert.throws(() => main(["--check"], path), /npm run setup/);
  assert.throws(() => main(["--domain", "*.example.com", "--tracker-url", "https://tracker.example"], path));
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), base);
  assert.throws(() => main(["--unknown"], path));
  assert.throws(() => main(["--domain", "example.com"], path), /npm run setup/);
  main(["--domain", "Example.com", "--tracker-url", "https://ai-tracker.smol.capital/"], path);
  const config = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(config.name, `ai-tracker-${createHash("sha256").update("example.com").digest("hex").slice(0, 16)}`);
  assert.equal(config.name, "ai-tracker-a379a6f6eeafb9a5");
  assert.deepEqual(config.vars, { TRACKED_HOST: "example.com", AI_TRACKER_URL: "https://ai-tracker.smol.capital" });
  // The shipped placeholder host must never pass the predeploy check.
  writeFileSync(path, JSON.stringify({ ...config, vars: { ...config.vars, TRACKED_HOST: "your-site.example" } }));
  assert.throws(() => main(["--check"], path), /npm run setup/);
  writeFileSync(path, JSON.stringify(config));
  assert.equal(config.routes, undefined);
  assert.equal(config.vars.INGEST_TOKEN, undefined);
  assert.notEqual(siteConfig("www.example.com", "https://tracker.example").name, config.name);
  assert.doesNotThrow(() => main(["--check"], path));
  writeFileSync(path, JSON.stringify({ ...config, name: 'my-cloudflare-button-worker' }));
  assert.doesNotThrow(() => main(['--check'], path));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.cloudflare.bindings.TRACKED_HOST.description);
  assert.match(readFileSync(join(root, '.dev.vars.example'), 'utf8'), /^INGEST_TOKEN=paste-your-site-key$/m);
  for (const changed of [
    { ...config, name: "invalid name" },
    { ...config, vars: { ...config.vars, TRACKED_HOST: "EXAMPLE.COM" } },
    { ...config, vars: { ...config.vars, AI_TRACKER_URL: "https://ai-tracker.smol.capital/" } },
  ]) {
    writeFileSync(path, JSON.stringify(changed));
    assert.throws(() => main(["--check"], path), /npm run setup/);
  }
});
