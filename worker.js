/**
 * Cimory SIAP Worker Proxy V5.0 - Bot Automation Mode
 * --------------------------------------------------
 * Memindahkan logika scraping dan session management ke server.
 * Frontend (app.js) jadi jauh lebih ringan.
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin') || '*';
        const browserReqHeaders = request.headers.get('Access-Control-Request-Headers') || '';

        // --- Standard CORS Headers ---
        const corsHeaders = {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PATCH, PUT',
            'Access-Control-Allow-Headers': browserReqHeaders || 'Content-Type, X-Cookie, X-Cimory-Session',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Expose-Headers': '*',
            'X-Proxy-Version': '5.0-Bot-Automaton'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // ============================================
        // 1. API: INTERNAL GOOGLE SYNC (Anti-CORS)
        // ============================================
        if (url.pathname.startsWith('/api/sync-rkm')) {
            const gasUrl = "https://script.google.com/macros/s/AKfycbwCGmVNAIXN6gbRAMh4REPmtojiSErXHezAAifiy43Umm1SP2U6AahJjniZLQX-jEpqyw/exec";
            try {
                // INTERNAL FOLLOW: Worker yang masuk ke Google, bukan browser.
                const response = await fetch(gasUrl, { redirect: 'follow' });
                const data = await response.json();
                return new Response(JSON.stringify(data), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            } catch (e) {
                return new Response(JSON.stringify({ status: 'error', message: e.message }), {
                    status: 500, headers: corsHeaders
                });
            }
        }

        // ============================================
        // 2. API: INTERNAL SIAP VERIFIER (The Bot)
        // ============================================
        if (url.pathname.startsWith('/api/verify-server')) {
            const user = url.searchParams.get('u') || 'RIKI';
            const pass = url.searchParams.get('p') || '1234';

            try {
                console.log("[Bot] Memulai verifikasi internal...");
                
                // STEP A: Scrape Login Page for Session & IP
                const res1 = await fetch("https://siap.cimory.com/siap/Login");
                const html1 = await res1.text();
                
                // Ambil Cookie ci_session
                const setCookie1 = res1.headers.get('Set-Cookie') || "";
                const sessionCookie = setCookie1.split(';')[0];
                
                // Scrape Hidden IP
                const ipMatch = html1.match(/name=["']ip["']\s+value=["']([^"']+)["']/i);
                const ipValue = ipMatch ? ipMatch[1] : "172.71.81.27";

                // STEP B: POST Login
                const payload = new URLSearchParams();
                payload.append('ip', ipValue);
                payload.append('username', user);
                payload.append('password', pass);

                const res2 = await fetch("https://siap.cimory.com/siap/Login/logincek", {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cookie': sessionCookie,
                        'Referer': 'https://siap.cimory.com/siap/Login',
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7)'
                    },
                    body: payload,
                    redirect: 'follow'
                });

                // Get final session cookie dari redirect
                let finalCookie = sessionCookie;
                const setCookie2 = res2.headers.get('Set-Cookie');
                if (setCookie2) finalCookie = setCookie2.split(';')[0];

                // STEP C: Tarik Data Visit (POST request)
                const today = url.searchParams.get('d') || new Date().toISOString().split('T')[0];
                const mds = url.searchParams.get('m') || 'MDSSATMND01';
                
                const fetchPayload = new URLSearchParams();
                fetchPayload.append('limit', '100');
                fetchPayload.append('start', '0');
                fetchPayload.append('kode_mds', mds);
                fetchPayload.append('tanggal_rkm', today);
                fetchPayload.append('asiscode', 'ASIS_SIAP_JKT');

                const res3 = await fetch("https://siap.cimory.com/siap/visitmds/fetch", {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Cookie': finalCookie,
                        'Referer': 'https://siap.cimory.com/siap/Visitmds',
                        'X-Requested-With': 'XMLHttpRequest',
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7)'
                    },
                    body: fetchPayload
                });

                const htmlData = await res3.text();
                
                // --- REGEX PARSER (Gantinya BeautifulSoup) ---
                const visits = [];
                // Split berdasarkan blok row customer
                const blocks = htmlData.split(/Customer Name&nbsp;:&nbsp;/i).slice(1);
                
                blocks.forEach(block => {
                    // 1. Ekstrak Kode Customer dari data-kode_cus
                    const codeMatch = block.match(/data-kode_cus\s*=\s*["']([^"']+)["']/i);
                    // 2. Ekstrak Time Out
                    const timeOutMatch = block.match(/Time Out&nbsp;:&nbsp;([\s\S]*?)<\/td>/i);
                    
                    if (codeMatch) {
                        const code = codeMatch[1].trim();
                        const timeOutRaw = timeOutMatch ? timeOutMatch[1].replace(/&nbsp;/g, '').trim() : "N/A";
                        
                        visits.push({
                            KodeCustomer: code,
                            time_out: timeOutRaw
                        });
                    }
                });

                console.log(`[Bot] Parsing Berhasil: ${visits.length} toko ditemukan.`);

                return new Response(JSON.stringify({
                    status: 'success',
                    data: visits,
                    debug: { ip: ipValue, user: user, date: today }
                }), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });

            } catch (e) {
                console.error("[Bot Crash]", e);
                return new Response(JSON.stringify({ 
                    status: 'error', 
                    message: "Eror Bot Internal: " + e.message 
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
        }

        // ============================================
        // 3. LEGACY PROXY (Fallback)
        // ============================================
        let targetHostname = 'dms.cimory.com';
        let targetUrl = '';

        if (url.pathname.startsWith('/siap/')) targetHostname = 'siap.cimory.com';

        if (url.pathname.startsWith('/img-alfagift/')) {
            const realUrl = url.searchParams.get('url');
            if (realUrl) { targetUrl = realUrl; targetHostname = new URL(realUrl).hostname; }
        } else {
            targetUrl = `https://${targetHostname}${url.pathname}${url.search}`;
        }

        const newHeaders = new Headers();
        ['accept', 'content-type', 'user-agent', 'referer', 'cookie', 'x-requested-with', 'x-cookie'].forEach(h => {
            if (request.headers.has(h)) newHeaders.set(h, request.headers.get(h));
        });

        const queryCookie = url.searchParams.get('_cookie');
        const finalCookie = queryCookie || request.headers.get('X-Cookie');
        if (finalCookie) newHeaders.set('Cookie', finalCookie);
        
        newHeaders.set('Host', targetHostname);

        try {
            const response = await fetch(targetUrl, {
                method: request.method,
                headers: newHeaders,
                body: request.body,
                redirect: 'manual'
            });

            const cleanHeaders = new Headers();
            for (const [key, value] of response.headers.entries()) {
                if (!key.toLowerCase().startsWith('access-control-')) cleanHeaders.set(key, value);
            }

            Object.keys(corsHeaders).forEach(key => cleanHeaders.set(key, corsHeaders[key]));

            const body = (response.status >= 300 && response.status < 400) ? null : await response.arrayBuffer();
            return new Response(body, { status: response.status, headers: cleanHeaders });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
        }
    }
};