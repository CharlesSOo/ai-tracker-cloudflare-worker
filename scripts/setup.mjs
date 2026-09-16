import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const configPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const guidance = "Run npm run setup -- --domain YOUR_DOMAIN --tracker-url https://ai-tracker.smol.capital first.";

export function hostname(value = "") {
  const host = value.toLowerCase();
  if (host.length > 253 || !host.includes(".") || !host.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || /^\d+(\.\d+){3}$/.test(host)) {
    throw new Error("Use one DNS hostname, without a scheme, path, port or wildcard.");
  }
  // Reject numeric/encoded IP addresses and other URL-normalized hostnames.
  if (new URL(`https://${host}`).hostname !== host) throw new Error("Use a canonical DNS hostname.");
  return host;
}

export function trackerOrigin(value = "") {
  if (!/^https:\/\/[^/?#\\\s]+\/?$/.test(value)) throw new Error("Tracker URL must be an HTTPS origin without credentials, path, query or fragment.");
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Tracker URL must not contain credentials.");
  hostname(url.hostname);
  return url.origin;
}

export function siteConfig(domain, trackerUrl) {
  const host = hostname(domain);
  const origin = trackerOrigin(trackerUrl);
  if (new URL(origin).hostname === host) throw new Error("Tracker and tracked site must use different hostnames.");
  return {
    name: `ai-tracker-${createHash("sha256").update(host).digest("hex").slice(0, 16)}`,
    vars: { TRACKED_HOST: host, AI_TRACKER_URL: origin },
  };
}

export function main(argv = process.argv.slice(2), path = configPath) {
  const { values } = parseArgs({ args: argv, options: {
    domain: { type: "string" }, "tracker-url": { type: "string" }, check: { type: "boolean" },
  } });
  // Keep this JSONC file in strict JSON format so no parser dependency is needed.
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (values.check) {
    try {
      if (values.domain || values["tracker-url"]) throw new Error("Check does not accept setup options.");
      const expected = siteConfig(config.vars?.TRACKED_HOST, config.vars?.AI_TRACKER_URL);
      // Deploy to Cloudflare lets the user choose a Worker name independently of CLI setup.
      if (typeof config.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(config.name) || config.name === 'ai-tracker-unconfigured' || config.vars.TRACKED_HOST !== expected.vars.TRACKED_HOST || config.vars.AI_TRACKER_URL !== expected.vars.AI_TRACKER_URL) {
        throw new Error("Worker name or bindings are invalid.");
      }
    } catch {
      throw new Error(`Collector is not configured correctly. ${guidance}`);
    }
    return;
  }
  if (!values.domain || !values["tracker-url"]) throw new Error(guidance);
  const configured = siteConfig(values.domain, values["tracker-url"]);
  writeFileSync(path, `${JSON.stringify({ ...config, ...configured }, null, 2)}\n`);
  console.log(`Configured ${configured.name} for ${configured.vars.TRACKED_HOST}. No deployment, routes or DNS changed.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
