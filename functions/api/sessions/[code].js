// GET /api/sessions/:code — read a session (Cloudflare Pages Function, KV-backed)
export async function onRequestGet(context) {
  const { params, env } = context;
  const code = String(params.code || '').toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(code)) {
    return json({ error: 'Bad code' }, 400);
  }
  const kv = env.SESSIONS;
  if (!kv) return json({ error: 'KV namespace SESSIONS not bound (see README deploy steps)' }, 500);
  const raw = await kv.get('s:' + code);
  if (!raw) return json({ error: 'Unknown session code' }, 404);
  return new Response(raw, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
