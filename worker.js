export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Ganti base URL proxy kita jadi URL server Cimory
    url.hostname = 'dms.cimory.com';
    url.protocol = 'https:'; // Pastiin selalu pake HTTPS
    url.port = '';           // Bersihin port kalo ada sisa dari localhost

    // Headers buat ngakalin CORS biar browser HP lu ga protes
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Kalau browser ngecek izin dulu (Preflight / OPTIONS), langsung kita ACC
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Copy headers lama, tapi ubah Host-nya biar server Cimory ga bingung (bypass security check)
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', 'dms.cimory.com');
    newHeaders.set('Origin', 'https://dms.cimory.com');
    newHeaders.set('Referer', 'https://dms.cimory.com/');

    // Terusin kirim data utama dari Web Tool lu ke Server Cimory
    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'follow'
    });

    const response = await fetch(newRequest);

    // Bikin response baru lalu tempelin tiket izin CORS-nya biar diterima browser HP lu
    const newResponse = new Response(response.body, response);
    Object.keys(corsHeaders).forEach(header => {
      newResponse.headers.set(header, corsHeaders[header]);
    });

    return newResponse;
  }
};