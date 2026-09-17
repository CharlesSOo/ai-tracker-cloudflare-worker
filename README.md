# AI Tracker Cloudflare Worker

See which AI crawlers (ChatGPT, Claude, Perplexity, Gemini and others) visit your website, in your [AI Tracker](https://ai-tracker.smol.capital) dashboard.

This Worker runs on a Cloudflare **Worker Route** in front of your existing site. It forwards every request to your site untouched and reports crawler visits in the background. Do not attach it as a Worker Custom Domain.

## Prerequisites

- Your AI Tracker site key
- A Cloudflare account with your domain configured and proxied
- Node.js 22+ installed

## Installation

Your AI Tracker dashboard shows these steps with your own hostname filled in (**Site settings → Installation**). Each site gets its own Worker, named after it; below, `example.com` becomes `ai-tracker-example-com`.

1. **Clone and install**
   ```bash
   git clone https://github.com/CharlesSOo/ai-tracker-cloudflare-worker.git
   cd ai-tracker-cloudflare-worker
   npm install
   ```

2. **Log in to Cloudflare**
   ```bash
   npx wrangler login
   ```

3. **Set your site key** (encrypted, never committed)
   ```bash
   npx wrangler secret put INGEST_TOKEN --name ai-tracker-example-com
   ```
   Paste your key when prompted and press Enter. Enter `Y` to create the Worker.

4. **Deploy**
   ```bash
   npm run deploy -- --name ai-tracker-example-com
   ```

5. **Configure the route** in the Cloudflare dashboard
   - Go to **Compute & AI** > **Workers & Pages** > **ai-tracker-example-com** > **Settings** > **Domains & Routes**
   - Select **Add** > **Route**. Never choose **Custom domain**: a form that asks for a subdomain is the wrong one, and would replace your site with this Worker.
   - Select your zone and enter `example.com/*`
   - Set **Failure mode** to **Fail Open**, then save

6. **Verify** in AI Tracker: open your site's **Installation** page and select **Verify installation**.

Your site key is for one exact hostname. `www.example.com` is a separate site with its own key. If Cloudflare says a route for your hostname already exists, stop and see [Sites that already run a Worker](#sites-that-already-run-a-worker).

## What this creates in Cloudflare

- One Worker per site: `ai-tracker-example-com`
- One encrypted secret: `INGEST_TOKEN`
- One Worker Route, added by you in step 5

DNS records, other Workers and other routes are never touched. The Worker has no public URL of its own.

## How it works

1. Receives the incoming request
2. Forwards it to your site and returns the response unchanged: status, headers, cookies, redirects and body
3. After the response is on its way, reports the visit to AI Tracker if the user agent looks like a crawler

Only crawler requests for pages, `robots.txt`, sitemaps and `llms.txt` are reported. Human visitors and static files (scripts, styles, images, fonts, media) are never sent anywhere. A report contains the URL without its query string, the user agent, the connecting IP, the response status and nothing else.

Static files are skipped for tracking, but the Worker still forwards them when your route matches them. To run the Worker on less of your traffic, scope the route to the paths you want measured, for example `example.com/blog/*`, and add more routes as needed.

**Safety.** Reporting runs in the background and times out after 1.5 seconds. Origin HTTP responses pass through unchanged; origin connection failures return 502 rather than replaying a potentially consumed request. Unexpected code exceptions can fall through to the origin, and **Fail Open** bypasses the Worker when its request limit is reached. This does not protect against every runtime/platform failure. The Worker has no runtime dependencies.

## Uninstall

1. Delete the route: **Workers & Pages** > **ai-tracker-example-com** > **Settings** > **Domains & Routes**. Traffic goes straight to your site again.
2. Check that your site loads.
3. Optionally delete the Worker: `npx wrangler delete --name ai-tracker-example-com`

## Rollback

```bash
npx wrangler deployments list --name ai-tracker-example-com
npx wrangler rollback <version-id> --name ai-tracker-example-com
```

## Troubleshooting

- **No visits showing?** Check the route exists and matches your hostname exactly, then run **Verify installation** in AI Tracker.
- **Check the key is set:** `npx wrangler secret list --name ai-tracker-example-com`
- **Changed or rotated your key?** `npx wrangler secret put INGEST_TOKEN --name ai-tracker-example-com`
- **View logs:** `npx wrangler tail ai-tracker-example-com`

## Sites that already run a Worker

A route pattern can only point at one Worker, so never replace an existing route. Follow steps 1-4, skip step 5, and add this Worker as a Tail consumer of the Worker that serves your site (Workers Paid plan):

```json
{ "tail_consumers": [{ "service": "ai-tracker-example-com" }] }
```

Keep any consumers already listed, and add it to every Worker that serves pages on that hostname. A Tail consumer only receives logs after each request and cannot affect your site.
