# AI Tracker Cloudflare Worker

A standalone collector for [AI Tracker](https://ai-tracker.smol.capital). Use it as a pass-through Worker route for an ordinary origin, **or** as a Tail Worker for an existing Worker. No dashboard deployment is included.

## Deploy in your browser

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CharlesSOo/ai-tracker-cloudflare-worker)

1. [Add your site in AI Tracker](https://ai-tracker.smol.capital) and copy its site key.
2. Click **Deploy to Cloudflare**, connect your GitHub account, and choose a distinct Worker name for this site.
3. Set **TRACKED_HOST** to that exact lowercase hostname. Keep **AI_TRACKER_URL** as your dashboard origin. Paste the site key into the **INGEST_TOKEN** secret field.
4. Keep the detected deployment command (`npm run deploy`) and deploy. Blank or invalid host configuration is rejected rather than silently collecting nothing.
5. Attach the exact-host route with **Fail Open**, or add a Tail consumer if the site already has a Worker (instructions below). The button does not configure site routes or overwrite existing Workers.

Cloudflare clones this public repository into your own GitHub account and deploys through Workers Builds. No local Node.js or tar download is needed. If configuration fields are not exposed by the setup screen, set the two public `vars` in the cloned `wrangler.jsonc` before retrying the build; add `INGEST_TOKEN` as an encrypted Worker secret, never commit it.

## Install and deploy with the CLI

Requires Node.js **22.18+**, npm, a Cloudflare account, and a private **site ingest key** created for your exact hostname in the tracker dashboard. This is not your Cloudflare API key. Wrangler is pinned to `4.129.0`.

```sh
git clone https://github.com/CharlesSOo/ai-tracker-cloudflare-worker.git
cd ai-tracker-cloudflare-worker
npm install
npm run setup -- --domain example.com --tracker-url https://ai-tracker.smol.capital
npx wrangler login
npx wrangler secret put INGEST_TOKEN
npm run deploy
```

Replace `example.com` with your real hostname. Paste its private site key only at Wrangler's secret prompt. On a new installation, accept Wrangler's prompt to create the missing Worker; this creates a placeholder Worker before storing the secret. Run `npm run deploy` next to replace the placeholder with this collector. **Do not attach a route or Tail consumer until deployment succeeds.** For multiple Cloudflare accounts, select the intended account with Wrangler (or set `CLOUDFLARE_ACCOUNT_ID`) consistently for secret and deploy commands.

Setup only writes public configuration to root `wrangler.jsonc`: the exact lowercase `TRACKED_HOST`, HTTPS-origin `AI_TRACKER_URL`, and Worker name `ai-tracker-<first 16 hex characters of SHA-256(hostname)>`. For `example.com`, the name is `ai-tracker-a379a6f6eeafb9a5`, matching the main AI Tracker deploy script. The tracker and tracked host must differ. Schemes, wildcards, paths, ports and IP addresses are not accepted as a tracked domain. Use ASCII/punycode DNS hostnames.

The shipped configuration has an empty tracked hostname; `npm run deploy` refuses to run until CLI setup or the browser deployment flow supplies valid bindings. Its `predeploy` check accepts the custom Worker name chosen in the browser, while rejecting invalid names/bindings. `deploy` runs native `wrangler deploy`, which preserves the stored `INGEST_TOKEN`; required-secret validation prevents deployment without it. There is no custom deployment API, token file, `.env` file, route provisioning or DNS automation. Do not bypass the setup check by deploying the default configuration directly with Wrangler. Keep `wrangler.jsonc` as strict JSON (no comments/trailing commas) for the setup script.

The name is deterministic: if that Worker already exists in your account, inspect it before proceeding. Native Wrangler can update it; this package does not perform an ownership check. Setup does not upload code or migrate stored secrets.

## Attach to an ordinary origin: exact-host route, Fail Open

1. Ensure the hostname already has the correct **proxied** DNS record in your Cloudflare zone. This package does not change DNS.
2. Check all existing Worker routes for that host, including wildcard and path routes. **Do not replace another Worker's route.** Use the Tail option below if a Worker already serves the site.
3. After deploying the collector, add a Worker **route** in Cloudflare for exactly `example.com/*`, selecting the generated Worker name. Do not use `*.example.com/*`, `*example.com/*`, or a Worker Custom Domain. The route without a scheme covers HTTP and HTTPS for this one host.
4. Set the route's request-limit failure mode to **Fail Open (proceed)** and verify it is saved. This lets requests reach the origin when the applicable Worker request limit is exceeded; it is not a guarantee against every runtime/origin failure.

`example.com` and `www.example.com` are separate hosts. The exact-host guard deliberately ignores other hosts. Both `workers.dev` and preview URLs are disabled. No `routes` field is declared: attaching and maintaining routes is a separate, manual operation. When redeploying, review any Wrangler route/configuration prompts and do not approve removal or replacement of existing routes.

Rollback: remove only this collector's route to restore direct origin handling. Do not delete unrelated routes or DNS records.

## Existing Worker: use a Tail consumer (Workers Paid plan)

Do not put this pass-through Worker in place of your application's Worker. Deploy this collector first, then append its generated name to the **existing producer Worker's** `tail_consumers` configuration. Preserve every existing consumer and all producer code, bindings, routes and other configuration. If there are no existing consumers, the producer fragment is:

```json
{
  "tail_consumers": [
    { "service": "ai-tracker-a379a6f6eeafb9a5" }
  ]
}
```

If consumers already exist, add only the new object to their array—do not replace the array with this example. Redeploy the producer through its normal deployment process. Producer and collector must be in the intended Cloudflare account. Tail Workers require a **Workers Paid or Enterprise plan** and may incur CPU charges. Use either a route or Tail attachment for a given traffic stream, not both, to avoid duplicate tracking.

Tail tracks matching-host request events emitted by that producer, not traffic bypassing it. Cloudflare's redaction is retained. Rollback: remove only this collector's entry from the producer's `tail_consumers`, preserving the rest, and redeploy the producer.

## More than one domain

Use a distinct Worker and the matching private site key for each exact hostname. Either clone into separate checkout directories, or rerun setup in this checkout with another domain, then run `npx wrangler secret put INGEST_TOKEN` and `npm run deploy` for the newly selected Worker. Setup changes this checkout's target; it does not remove the previous Worker or move its secret. Rerun setup for the desired host before any later secret update or deployment. Never reuse another site's key.

## What is collected

The collector forwards the original request to the origin once and returns the original streaming response unchanged (status, redirects, headers, cookies and body). Ingestion runs in `waitUntil` after the origin responds; it is not awaited by the response path, but Worker routing still has overhead—this is **not zero-latency tracking**. Tracking failures do not replace the origin response. Origin failures propagate without retry.

GET and HEAD requests with known crawler/bot user-agent hints are sent to `/api/ingest`. **Pages and discovery files count**: any page path (`/pricing`, `/blog/post`), `robots.txt`, sitemaps and `llms.txt`. Static subresources (scripts, styles, images, fonts, media, `/_next/static`, `/_next/image`, `/cdn-cgi`) are skipped. The tracker determines final bot classification. User-agent hints can be spoofed and are not proof of bot identity.

Events contain origin + pathname (not query/fragment), user agent, connecting IP when available, response status, and source. Cookies and request bodies are not ingested. The native `INGEST_TOKEN` secret binding authenticates requests; redirects are manual so the secret is never followed to a redirect destination. Tracking requests time out after 1.5 seconds. Observe applicable privacy/notice requirements for IP and request metadata. Diagnostic logs and sampled traces are enabled; invocation logs are disabled.

## Checks and maintenance

```sh
npm test
# After setup; packaging only, no deployment:
npm run deploy -- --dry-run
```

Tests use only Node's built-in test runner and TypeScript stripping: setup validation/naming, exact-host/method filtering, static/discovery paths, original response identity, background ingestion, secret redaction and Tail handling. No live ingestion is performed by the tests. Dry run checks Wrangler packaging, not Cloudflare permissions, route conflicts, stored remote secrets or live ingestion. After actual attachment, verify a known crawler request to your own site appears in the tracker.

`src/collector.ts` and `src/collector-env.d.ts` are copied unchanged from the main AI Tracker project. Keep both in sync when updating the collector. This package has no TypeScript compiler dependency; Wrangler bundles the Worker. Never commit private keys or local credentials. `.dev.vars`, `.env*`, `.wrangler`, `.cloudflare` and `node_modules` are ignored; they are not required for installation or deployment.

References: [Wrangler secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/), [Tail Workers](https://developers.cloudflare.com/workers/observability/logs/tail-workers/).
