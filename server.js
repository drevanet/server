const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Keep-Alive Agents to reuse TCP connections
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

// 2. Cache manifest files (.m3u8) for 5 seconds to reduce origin hits
const manifestCache = new NodeCache({ stdTTL: 5, checkperiod: 10 });

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

function resolveUrl(baseUrl, relativeUrl) {
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
        return relativeUrl;
    }
    return new URL(relativeUrl, baseUrl).href;
}

app.get('/proxy', async (req, res) => {
    const { url, referer } = req.query;

    if (!url) {
        return res.status(400).send('Missing url parameter');
    }

    const isM3U8 = url.includes('.m3u8');
    const proxyHost = `${req.protocol}://${req.get('host')}/proxy`;

    // 3. Serve .m3u8 from cache if available
    if (isM3U8) {
        const cachedManifest = manifestCache.get(url);
        if (cachedManifest) {
            res.setHeader('Content-Type', 'application/x-mpegURL');
            return res.send(cachedManifest);
        }
    }

    try {
        const config = {
            method: 'get',
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
                'Referer': referer || '',
                'Origin': referer ? new URL(referer).origin : ''
            },
            // Optimize networking profiles
            httpAgent,
            httpsAgent,
            responseType: isM3U8 ? 'text' : 'stream',
            timeout: isM3U8 ? 3000 : 10000 // Drop dead connections quickly
        };

        const response = await axios(config);

        if (isM3U8) {
            const lines = response.data.split('\n');
            const refererParam = referer ? `&referer=${encodeURIComponent(referer)}` : '';
            
            // 4. Pre-allocated loop optimization for fast parsing
            const rewrittenLines = new Array(lines.length);
            
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();

                if (!line) {
                    rewrittenLines[i] = '';
                    continue;
                }

                if (line.startsWith('#')) {
                    rewrittenLines[i] = line.replace(/URI=["']([^"']+)["']/g, (match, p1) => {
                        const absoluteUri = resolveUrl(url, p1);
                        return `URI="${proxyHost}?url=${encodeURIComponent(absoluteUri)}${refererParam}"`;
                    });
                    continue;
                }

                const absoluteMediaUrl = resolveUrl(url, line);
                rewrittenLines[i] = `${proxyHost}?url=${encodeURIComponent(absoluteMediaUrl)}${refererParam}`;
            }

            const finalManifest = rewrittenLines.join('\n');
            
            // Store manifest in cache
            manifestCache.set(url, finalManifest);

            res.setHeader('Content-Type', 'application/x-mpegURL');
            return res.send(finalManifest);
        }

        // 5. Instantly pipe TS chunks with buffer configurations
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Tell client player to cache video chunks
        response.data.pipe(res);

    } catch (error) {
        console.error(`Proxy Error: ${url}`, error.message);
        if (!res.headersSent) {
            res.status(error.response?.status || 500).send(error.message);
        }
    }
});

app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
