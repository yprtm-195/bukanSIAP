export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let targetHostname = 'dms.cimory.com';
    let targetUrl = '';

    if (url.pathname.startsWith('/gas/')) {
      targetHostname = 'script.google.com';
      const newPath = url.pathname.replace('/gas/', '/');
      targetUrl = `https://${targetHostname}${newPath}${url.search}`;
    } else {
      targetUrl = `https://${targetHostname}${url.pathname}${url.search}`;
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Bikin header baru agar server tujuan mengira ini request asli
    const newHeaders = new Headers();
    // Copy beberapa header penting jika ada
    ['accept', 'content-type', 'user-agent'].forEach(h => {
      if (request.headers.has(h)) newHeaders.set(h, request.headers.get(h));
    });
    
    newHeaders.set('Host', targetHostname);

    try {
      // Kita suruh Cloudflare follow redirect sampai dapet data final (maks 5x)
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'follow' 
      });

      // Kita ambil body-nya (bisa text/json)
      const body = await response.arrayBuffer();

      // Balikin dengan header CORS yang kita kontrol sendiri
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...corsHeaders,
          'Content-Type': response.headers.get('Content-Type') || 'application/json'
        }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  }
};