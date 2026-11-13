// Custom Cloudflare Worker entry for OpenNext + Cron Triggers (§6.1)
// Re-exports the OpenNext fetch handler and Durable Object exports, and adds a scheduled() handler
// that triggers `/api/cron/tick` every minute.

// @ts-expect-error `.open-next/worker.js` is generated at build time by `opennextjs-cloudflare build`
import handler from "./.open-next/worker.js";

// @ts-expect-error `.open-next/worker.js` is generated at build time
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

interface WorkerEnv {
  CRON_SECRET?: string;
  FEED_API_TOKEN?: string;
  [key: string]: unknown;
}

const worker = {
  fetch: handler.fetch,

  async scheduled(
    _controller: unknown,
    env: WorkerEnv,
    ctx: { waitUntil: (promise: Promise<unknown>) => void }
  ): Promise<void> {
    const headers = new Headers({
      "Content-Type": "application/json"
    });
    if (env.CRON_SECRET) {
      headers.set("x-cron-secret", env.CRON_SECRET);
    } else if (env.FEED_API_TOKEN) {
      headers.set("x-feed-token", env.FEED_API_TOKEN);
    }

    const req = new Request("https://internal.cron/api/cron/tick", {
      method: "POST",
      headers
    });

    ctx.waitUntil(
      Promise.resolve(handler.fetch(req, env, ctx)).catch((err) => {
        console.error("Scheduled cron tick error:", err);
      })
    );
  }
};

export default worker;

