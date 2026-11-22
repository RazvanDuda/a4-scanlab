// GET /api/config — on Cloudflare Pages the site is always HTTPS, camera works directly
export async function onRequestGet() {
  return new Response(JSON.stringify({ https: true, httpsPort: 443, cloudflare: true }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
