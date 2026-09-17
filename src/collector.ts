// A pass-through route for ordinary origins, or a Tail Worker for existing Workers.
const BOT_HINTS = /bot|crawler|spider|crawl|gpt|claude|perplexity|bing|applebot|bytespider|ccbot|amazon|amzn|meta-|duckassist|mistral|google|copilot|grok|kimi|qwen|cohere|msnbot/i;

// Standalone copy of the tracker's src/asset-paths.ts; the tracker's ingest filter is authoritative.
const ASSET_PATH = /\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav|m4[av]|mov|wasm)$|^\/(?:_next\/(?:static|image)|cdn-cgi)(?:\/|$)/i;

type Bindings = CollectorEnv & { TRACKER?: Fetcher };

function trackingFailure(error: unknown, env: Bindings) {
  const detail = error instanceof Error ? error.message : "Unknown tracking error";
  console.error(JSON.stringify({
    message: "tracking_failed",
    detail: (env.INGEST_TOKEN ? detail.replaceAll(env.INGEST_TOKEN, "[REDACTED]") : detail).slice(0, 200),
  }));
}

async function track(request: Pick<Request, "url" | "method" | "headers">, status: number | undefined, env: Bindings, source = "cloudflare-worker"): Promise<void> {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent") ?? "";
  // Pages and discovery files count; static subresources do not.
  if (
    url.hostname !== env.TRACKED_HOST || ASSET_PATH.test(url.pathname) || !env.INGEST_TOKEN || !env.AI_TRACKER_URL ||
    (request.method !== "GET" && request.method !== "HEAD") || !BOT_HINTS.test(userAgent)
  ) return;

  const tracker = new URL(env.AI_TRACKER_URL);
  if (tracker.protocol !== "https:" || tracker.hostname === url.hostname || tracker.username || tracker.password) return;
  const ip = request.headers.get("cf-connecting-ip");
  const event = new Request(new URL("/api/ingest", tracker), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.INGEST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      href: `${url.origin}${url.pathname}`,
      ai: { userAgent, ...(ip ? { ip } : {}), statusCode: status, source },
    }),
    // Workers rejects "error". Manual redirects never forward the ingest secret.
    redirect: "manual",
    signal: AbortSignal.timeout(1500),
  });
  const result = env.TRACKER ? await env.TRACKER.fetch(event) : await fetch(event);
  if (!result.ok) console.error(JSON.stringify({ message: "ingest_rejected", status: result.status }));
  await result.body?.cancel();
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    // Pass the original request and streaming response through, including redirects,
    // cookies, non-GET bodies and errors. Never retry an origin request.
    const response = await fetch(request);
    ctx.waitUntil(track(request, response.status, env).catch((error) => trackingFailure(error, env)));
    return response;
  },
  async tail(events: TraceItem[], env: Bindings) {
    await Promise.all(events.map(async ({ event }) => {
      try {
        if (!event || !("request" in event)) return;
        // Keep Cloudflare's redaction; ignore console logs, cookies and exceptions.
        const { url, method, headers } = event.request;
        await track({ url, method, headers: new Headers(headers) }, event.response?.status, env, "cloudflare-tail");
      } catch (error) {
        trackingFailure(error, env);
      }
    }));
  },
} satisfies ExportedHandler<Bindings>;
