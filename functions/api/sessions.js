// POST /api/sessions — create a new test-sheet session (Cloudflare Pages Function, KV-backed)
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return json({ error: 'items[] required' }, 400);
    }
    const kv = env.SESSIONS;
    if (!kv) return json({ error: 'KV namespace SESSIONS not bound (see README deploy steps)' }, 500);

    // unique 5-char code
    let code;
    do {
      code = makeCode();
      if (!(await kv.get('s:' + code))) break;
    } while (true);

    const session = {
      code,
      created: new Date().toISOString(),
      title: String(body.title || 'A4 Barcode Test Sheet').slice(0, 120),
      opts: body.opts || {},
      items: body.items
    };
    await kv.put('s:' + code, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 180 });
    return json({ code });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — unambiguous when typed
  let s = '';
  const rnd = new Uint32Array(5);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < 5; i++) s += chars[rnd[i] % chars.length];
  return s;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
