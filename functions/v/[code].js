// GET /v/:code — short link: redirect to the validator with the session code
export async function onRequestGet(context) {
  const { params } = context;
  const code = String(params.code || '').toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(code)) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(null, { status: 302, headers: { location: '/validate#' + code } });
}
