// A4 ScanLab — Cloudflare Worker: API routes + static assets from ./public
// Replace the Node server when running on Cloudflare.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — unambiguous when typed
  const rnd = new Uint32Array(5);
  crypto.getRandomValues(rnd);
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[rnd[i] % chars.length];
  return s;
}

async function createSession(request, env) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return json({ error: 'items[] required' }, 400);
    }
    if (!env.SESSIONS) return json({ error: 'KV namespace SESSIONS not bound — see README deploy steps' }, 500);

    let code;
    do {
      code = makeCode();
      if (!(await env.SESSIONS.get('s:' + code))) break;
    } while (true);

    const session = {
      code,
      created: new Date().toISOString(),
      title: String(body.title || 'A4 Barcode Test Sheet').slice(0, 120),
      opts: body.opts || {},
      items: body.items
    };
    await env.SESSIONS.put('s:' + code, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 180 });
    return json({ code });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function getSession(code, env) {
  code = String(code || '').toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(code)) return json({ error: 'Bad code' }, 400);
  if (!env.SESSIONS) return json({ error: 'KV namespace SESSIONS not bound — see README deploy steps' }, 500);
  const raw = await env.SESSIONS.get('s:' + code);
  if (!raw) return json({ error: 'Unknown session code' }, 404);
  return new Response(raw, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (request.method === 'POST' && p === '/api/sessions') return createSession(request, env);

    if (request.method === 'GET' && p === '/api/config') {
      return json({ https: true, httpsPort: 443, cloudflare: true });
    }

    let m = p.match(/^\/api\/sessions\/([A-Z0-9]{3,8})$/i);
    if (m && request.method === 'GET') return getSession(m[1], env);

    // short link: /v/CODE -> /validate#CODE
    m = p.match(/^\/v\/([A-Z0-9]{3,8})$/i);
    if (m && request.method === 'GET') {
      return Response.redirect(url.origin + '/validate#' + m[1].toUpperCase(), 302);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Method not allowed' }, 405);
    }
    return env.ASSETS.fetch(request);
  }
};
