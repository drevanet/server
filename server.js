const express = require('express');
const http = require('http');
const https = require('https');
const URL = require('url').URL;

const app = express();
const PORT = process.env.PORT || 10000;

// Massive socket pool and keep-alive configuration
const agentOptions = { keepAlive: true, maxSockets: 1000, maxFreeSockets: 200, timeout: 10000 };
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

function resolveUrl(baseUrl, relativeUrl) {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) return relativeUrl;
  return new URL(relativeUrl, baseUrl).href;
}

app.get('/proxy', (req, res) => {
  const { url, referrer } = req.query;
  if (!url) return res.status(400).send('Missing url parameter');

  const isM3U8 = url.includes('.m3u8');
  const proxyHost = `${req.protocol}://${req.get('host')}/proxy`;
  const encodedReferrer = referrer ? encodeURIComponent(referrer) : '';

  const targetUrl = new URL(url);
  const client = targetUrl.protocol === 'https:' ? https : http;

  const options = {
    method: 'GET',
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    agent: targetUrl.protocol === 'https:' ? httpsAgent : httpAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
      'Referer': referrer || '',
      'Origin': referrer ? new URL(referrer).origin : '',
      'Accept-Encoding': 'gzip, deflate, br'
    }
  };

  const proxyReq = client.request(options, (targetRes) => {
    if (isM3U8) {
      let data = '';
      targetRes.setEncoding('utf8');
      targetRes.on('data', chunk => { data += chunk; });
      targetRes.on('end', () => {
        let rewrittenResult = data.replace(/^([^#\r\n].*)$/gm, (match) => {
          const line = match.trim();
          if (!line) return '';
          return `${proxyHost}?url=${encodeURIComponent(resolveUrl(url, line))}&encodedReferrer=${encodedReferrer}`;
        }).replace(/URI=["']([^"']+)["']/g, (_, p1) => {
          return `URI="${proxyHost}?url=${encodeURIComponent(resolveUrl(url, p1))}&referrer=${encodedReferrer}"`;
        });

        res.setHeader('Content-Type', 'application/x-mpegURL');
        res.setHeader('Cache-Control', 'public, max-age=2');
        res.send(rewrittenResult);
      });
      return;
    }

    res.setHeader('Content-Type', targetRes.headers['content-type'] || 'video/MP2T');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    
    targetRes.pipe(res);
    req.on('close', () => targetRes.destroy());
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.status(500).send(err.message);
  });

  proxyReq.end();
});

app.listen(PORT, () => console.log(`Ultra-fast proxy running on port ${PORT}`));
