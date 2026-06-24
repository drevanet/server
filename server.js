const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000;

// Helper to safely encode data to pass via URLs safely
const safeBtoa = (str) => Buffer.from(str, 'utf-8').toString('base64url');
const safeAtob = (str) => Buffer.from(str, 'base64url').toString('utf-8');

// Enable CORS so web players (hls.js, Video.js) can read the stream
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

/**
 * Endpoint to generate a proxied playback URL
 * Example: http://localhost:3000/get-playlist?url=https://target.com
 */
app.get('/get-playlist', (req, res) => {
    const { url, referer } = req.query;
    if (!url) return res.status(400).send('Missing "url" parameter.');

    const encodedUrl = safeBtoa(url);
    const encodedReferer = referer ? safeBtoa(referer) : '';

    // Direct the player to our manifest processor endpoint
    const proxyUrl = `http://localhost:${PORT}/live.m3u8?s=${encodedUrl}&r=${encodedReferer}`;
    res.json({ proxyUrl });
});

/**
 * Manifest Processor Endpoint
 * Fetches the M3U8 manifest, parses it, and rewrites URLs
 */
app.get('/live.m3u8', async (req, res) => {
    const { s, r } = req.query;
    if (!s) return res.status(400).send('Missing stream identifier.');

    try {
        const targetUrl = safeAtob(s);
        const refererHeader = r ? safeAtob(r) : '';

        // Prepare request configuration
        const config = {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            responseType: 'text'
        };
        if (refererHeader) config.headers['Referer'] = refererHeader;

        // Fetch original manifest
        const response = await axios.get(targetUrl, config);
        const manifestText = response.data;

        // Parse target URL base directory to handle relative paths in the manifest
        const parsedUrl = new URL(targetUrl);
        const baseUrl = parsedUrl.origin + parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1);

        // Process manifest line-by-line
        const lines = manifestText.split(/\r?\n/);
        const rewrittenLines = lines.map(line => {
            const trimmed = line.trim();
            
            // Ignore metadata/comments
            if (!trimmed || trimmed.startsWith('#')) {
                return line;
            }

            // Resolve full path for the segment or sub-manifest file
            let absoluteUrl = trimmed;
            if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
                absoluteUrl = trimmed.startsWith('/') ? `${parsedUrl.origin}${trimmed}` : `${baseUrl}${trimmed}`;
            }

            // Rewrite the URL to route back through our segment proxy
            const encodedSegmentUrl = safeBtoa(absoluteUrl);
            if (absoluteUrl.includes('.m3u8')) {
                // If it links to a sub-playlist (variant stream), route back here
                return `http://localhost:${PORT}/live.m3u8?s=${encodedSegmentUrl}&r=${r || ''}`;
            } else {
                // If it is a video segment (.ts, .m4s), route to the segment proxy
                return `http://localhost:${PORT}/segment?s=${encodedSegmentUrl}&r=${r || ''}`;
            }
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenLines.join('\n'));

    } catch (error) {
        console.error('Manifest processing error:', error.message);
        res.status(500).send('Failed to proxy manifest.');
    }
});

/**
 * Segment Proxy Endpoint
 * Streams the actual video chunks directly to the player with requested headers
 */
app.get('/segment', async (req, res) => {
    const { s, r } = req.query;
    if (!s) return res.status(400).send('Missing segment identifier.');

    try {
        const targetUrl = safeAtob(s);
        const refererHeader = r ? safeAtob(r) : '';

        const config = {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            responseType: 'stream' // Pipe stream directly to minimize memory footprint
        };
        if (refererHeader) config.headers['Referer'] = refererHeader;

        const response = await axios.get(targetUrl, config);
        
        // Pass through essential headers
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }

        response.data.pipe(res);

    } catch (error) {
        console.error('Segment streaming error:', error.message);
        res.status(500).end();
    }
});

app.listen(PORT, () => {
    console.log(`M3U8 Proxy running on http://localhost:${PORT}`);
});
