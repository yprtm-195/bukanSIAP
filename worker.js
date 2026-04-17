export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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

    // Ambil Origin & Requested Headers
    const origin = request.headers.get('Origin') || '*';
    const reqHeaders = request.headers.get('Access-Control-Request-Headers') || 'Content-Type, Authorization, X-Requested-With, Cookie, Referer, Accept, x-cookie';

    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': reqHeaders,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Set-Cookie, X-Proxy-Version',
      'X-Proxy-Version': '3.3-Ultra-CORS',
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


    // MANUAL SESSION: Jika ada X-Cookie dari browser, gunakan sebagai Cookie
    if (request.headers.has('X-Cookie')) {
        newHeaders.set('Cookie', request.headers.get('X-Cookie'));
    }
    
    newHeaders.set('Host', targetHostname);
    
    // Khusus SIAP, kasih referer biar gak curiga
    if (targetHostname === 'siap.cimory.com') {
        const ref = url.pathname.includes('fetch') ? 'https://siap.cimory.com/siap/Visitmds' : 'https://siap.cimory.com/siap/Login';
        newHeaders.set('Referer', ref);
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

      // Loop over all headers
      for (const [key, value] of response.headers.entries()) {
        const k = key.toLowerCase();
        if (k === 'set-cookie') {
          // Normal handling
          let newCookie = value.replace(/Domain=[^;]+;?/i, '');
          if (!newCookie.includes('SameSite')) newCookie += '; SameSite=None; Secure';
          cleanHeaders.append('Set-Cookie', newCookie);
          
          // Manual session tracking
          const cookieNameValue = value.split(';')[0];
          allCookies.push(cookieNameValue);
        } else if (!k.startsWith('access-control-') && k !== 'content-security-policy') {
          cleanHeaders.set(key, value);
        }
      }

      // X-Set-Cookie: Mirror cookies in a custom header so browser JS can read it
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