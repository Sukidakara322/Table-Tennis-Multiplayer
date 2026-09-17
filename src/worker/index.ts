/**
 * Cloudflare Worker entry. Static game files are served straight from the asset store;
 * only /api/* reaches this code. Session rooms (Durable Objects) are added in the multiplayer step.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'linked-player' });
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
