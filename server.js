const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 5000;

// ONLY ALLOW THIS DOMAIN (Change this to your target site)
const ALLOWED_DOMAIN = 'https://epl.betisports.com';

// Reuse TCP connections to vastly speed up chunk requests
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

// Optimized wide CORS policies
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// High-speed relative URL resolver avoiding heavy object creation
function resolveUrl(baseUrl, relativeUrl) {
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
        return relativeUrl;
    }
    return new URL(relativeUrl, baseUrl).href;
}

// Optimized Proxy endpoint
app.get('/proxy', async (req, res) => {
    const { url, referer } = req.query;

    if (!url) {
        return res.status(400).send('Missing url parameter');
    }

    // Security check: strictly enforce a single allowed domain
    try {
        const parsedTarget = new URL(url);
        if (parsedTarget.hostname !== ALLOWED_DOMAIN && parsedTarget.hostname !== `www.${ALLOWED_DOMAIN}`) {
            return res.status(403).send('Access denied: Target domain is not allowed');
        }
    } catch (e) {
        return res.status(400).send('Invalid URL');
    }

    const isM3U8 = url.includes('.m3u8');
    const proxyHost = `${req.protocol}://${req.get('host')}/proxy`;
    const encodedReferer = referer ? encodeURIComponent(referer) : '';

    try {
        const config = {
            method: 'get',
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
                'Referer': referer || '',
                'Origin': referer ? new URL(referer).origin : '',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            responseType: isM3U8 ? 'text' : 'stream',
            httpAgent,
            httpsAgent,
            timeout: 5000
        };

        const response = await axios(config);

        if (isM3U8) {
            const lines = response.data.split('\n');
            let rewrittenResult = '';
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (!line) continue;

                if (line[0] === '#') {
                    if (line.includes('URI=')) {
                        line = line.replace(/URI=["']([^"']+)["']/g, (_, p1) => {
                            const abs = resolveUrl(url, p1);
                            return `URI="${proxyHost}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}"`;
                        });
                    }
                    rewrittenResult += line + '\n';
                } else {
                    const abs = resolveUrl(url, line);
                    rewrittenResult += `${proxyHost}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}\n`;
                }
            }
            res.setHeader('Content-Type', 'application/x-mpegURL');
            res.setHeader('Cache-Control', 'public, max-age=2');
            return res.send(rewrittenResult);
        }

        res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        response.data.pipe(res);
        req.on('close', () => response.data.destroy());

    } catch (error) {
        if (!res.headersSent) {
            res.status(error.response?.status || 500).send(error.message);
        }
    }
});

app.listen(PORT, () => console.log(`Optimized single-domain proxy running on port ${PORT}`));
