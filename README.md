# AI Tracker Cloudflare Worker

A standalone collector for [AI Tracker](https://ai-tracker.smol.capital). Use it as a pass-through Worker route for an ordinary origin, **or** as a Tail Worker for an existing Worker. No dashboard deployment is included.

The easiest install is **Connect Cloudflare** in your AI Tracker dashboard (Site settings → Installation), when your dashboard offers it. Otherwise use the CLI below.

## Prerequisites

- Your AI Tracker site key (created for your exact hostname in the dashboard; not a Cloudflare API key)
- A Cloudflare account with your domain configured and proxied
- Node.js 22+ installed locally

## Installation

1. **Clone and install**
   ```sh
   git clone https://github.com/CharlesSOo/ai-tracker-cloudflare-worker.git
   cd ai-tracker-cloudflare-worker
   npm install
   ```

2. **Authenticate with Cloudflare**
   ```sh
   npx wrangler login
   ```

3. **Store your site key** (encrypted, never committed)
   ```sh
   npx wrangler secret put INGEST_TOKEN
   ```
   Paste your key when prompted and press Enter. Confirm creating the Worker named `ai-tracker-cloudflare-worker` with `Y`.

4. **Deploy**
   ```sh
   npm run deploy
   ```

5. **Configure routes** in the Cloudflare dashboard
   - Go to **Compute & AI** > **Workers & Pages**
   - Select **ai-tracker-cloudflare-worker** > **Settings** > **Domains & Routes** > **Add** > **Route**
   - Select your zone and enter `example.com/*`
   - Set **Failure mode** to **Fail Open**
   - Save

Use a Worker Route, not a Worker Custom Domain. Details and safety notes for this step are in the next section.

### Optional configuration

The site key already binds visits to one hostname, so the clone deploys as is. Run `npm run setup -- --tracker-url https://your-dashboard.example [--domain example.com]` after `npm install` if you host your own AI Tracker dashboard, run more than one site in the same Cloudflare account (each needs its own Worker name), or use a route that also covers other hostnames.

Setup only writes public configuration to root `wrangler.jsonc`: HTTPS-origin `AI_TRACKER_URL` and, with `--domain`, the exact lowercase `TRACKED_HOST` and Worker name `ai-tracker-<first 16 hex characters of SHA-256(hostname)>`. No secret is written. `npm run deploy` first runs a `predeploy` check that rejects invalid names or bindings, then native `wrangler deploy`.

With `--domain` the name is deterministic: if that Worker already exists in your account, inspect it before proceeding. Native Wrangler can update it; this package does not perform an ownership check.

## Attach to an ordinary origin: exact-host route, Fail Open

1. Ensure the hostname already has the correct **proxied** DNS record in your Cloudflare zone. This package does not change DNS.
2. Check all existing Worker routes for that host, including wildcard and path routes. **Do not replace another Worker's route.** Use the Tail option below if a Worker already serves the site.
3. After deploying the collector, add a Worker **route** in Cloudflare for exactly `example.com/*`, selecting this Worker. Do not use `*.example.com/*`, `*example.com/*`, or a Worker Custom Domain. The route without a scheme covers HTTP and HTTPS for this one host.
4. Set the route's request-limit failure mode to **Fail Open (proceed)** and verify it is saved. This lets requests reach the origin when the applicable Worker request limit is exceeded; it is not a guarantee against every runtime/origin failure.

`example.com` and `www.example.com` are separate hosts. The tracker rejects hosts that do not belong to the site key; with `--domain` configured the collector also skips them. Both `workers.dev` and preview URLs are disabled. No `routes` field is declared: attaching and maintaining routes is a separate, manual operation. When redeploying, review any Wrangler route/configuration prompts and do not approve removal or replacement of existing routes.

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
