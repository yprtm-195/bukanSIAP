export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 1. Ambil cookie dari query param (Alternatif No-Header Proxy)
    let proxyCookie = url.searchParams.get('_cookie');
    
    // 2. Hapus parameter _cookie biar gak ikut dikirim ke server tujuan (Cimory)
    url.searchParams.delete('_cookie');

    let targetHostname = 'dms.cimory.com';
    let targetUrl = '';

    // Deteksi target berdasarkan path
    if (url.pathname.startsWith('/siap/')) {
      targetHostname = 'siap.cimory.com';
    }

    // NEW: Alfagift Image Proxy to solve CORS
    if (url.pathname.startsWith('/img-alfagift/')) {
      const realUrl = url.searchParams.get('url');
      if (realUrl) {
          targetUrl = realUrl;
          targetHostname = new URL(realUrl).hostname;
      }
    } else if (url.pathname.startsWith('/gas/')) {
      targetHostname = 'script.google.com';
      const newPath = url.pathname.replace('/gas/', '/');
      targetUrl = `https://${targetHostname}${newPath}${url.search}`;
    } else {
      targetUrl = `https://${targetHostname}${url.pathname}${url.search}`;
    }

    // NUCLEAR PERMISSIVE CORS - Echo whatever the browser requests
    const origin = request.headers.get('Origin') || '*';
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    
    // Use requested headers if available, otherwise fallback to our comprehensive list
    const allowedHeaders = requestedHeaders || 'Content-Type, Authorization, X-Requested-With, Cookie, Referer, Accept, x-cookie, x-set-cookie, X-Cookie';

    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': allowedHeaders,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Set-Cookie, X-Proxy-Version, X-Set-Cookie, x-set-cookie, content-type',
      'Access-Control-Max-Age': '86400', // Cache preflight response for 24 hours
      'X-Proxy-Version': '3.7-Turbo-Exposed',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { 
        status: 204,
        headers: corsHeaders 
      });
    }

    // WHITELIST HEADERS: Teruskan semua header penting + x-cookie & x-requested-with
    const newHeaders = new Headers();
    const headersToForward = ['accept', 'content-type', 'user-agent', 'referer', 'cookie', 'x-requested-with', 'x-cookie'];
    headersToForward.forEach(h => {
      if (request.headers.has(h)) newHeaders.set(h, request.headers.get(h));
    });


    // MANUAL SESSION: Prioritaskan cookie dari URL (_cookie), kalo gak ada baru dari X-Cookie
    const finalCookie = proxyCookie || request.headers.get('X-Cookie');
    
    if (finalCookie) {
        newHeaders.set('Cookie', finalCookie);
    }
    
    newHeaders.set('Host', targetHostname);
    
    // Khusus SIAP, kasih referer & User-Agent Mobile biar gak curiga
    if (targetHostname === 'siap.cimory.com') {
        const ref = url.pathname.includes('fetch') ? 'https://siap.cimory.com/siap/Visitmds' : 'https://siap.cimory.com/siap/Login';
        newHeaders.set('Referer', ref);
        newHeaders.set('User-Agent', 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36');
    }

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'follow' 
      });

      // Ambil body-nya
      const body = await response.arrayBuffer();

      const cleanHeaders = new Headers();
      let allCookies = [];

      // 1. Ambil semua header kecuali CORS bawaan & security policy
      for (const [key, value] of response.headers.entries()) {
        const k = key.toLowerCase();
        if (k !== 'set-cookie' && !k.startsWith('access-control-') && k !== 'content-security-policy') {
          cleanHeaders.set(key, value);
        }
      }

      // 2. Ambil SEMUA Cookie pake getSetCookie (biar gak cuma dapet satu)
      const setCookies = response.headers.getSetCookie();
      setCookies.forEach(cookie => {
        // Normalisasi cookie buat browser
        let newCookie = cookie.replace(/Domain=[^;]+;?/i, '');
        if (!newCookie.includes('SameSite')) newCookie += '; SameSite=None; Secure';
        cleanHeaders.append('Set-Cookie', newCookie);
        
        // Simpan buat X-Set-Cookie (Manual tracking)
        const cookieNameValue = cookie.split(';')[0];
        allCookies.push(cookieNameValue);
      });

      // X-Set-Cookie: Gabungin semua cookie biar frontend bisa simpan manual
      if (allCookies.length > 0) {
          cleanHeaders.set('X-Set-Cookie', allCookies.join('; '));
      }

      // Tambahkan/Timpa header CORS
      Object.keys(corsHeaders).forEach(key => {
        cleanHeaders.set(key, corsHeaders[key]);
      });

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: cleanHeaders
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  }
};