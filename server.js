const express = require('express');
const axios = require('axios');
const cors = require('cors'); // Import the cors package
const app = express();
const PORT = process.env.PORT || 5000;

// Whitelist your specific domain
const allowedOrigins = ['https://betisports.com'];

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true, // Allow cookies and authorization headers to pass through
  optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

const http = require('http');
const https = require('https');
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

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
              return `URI="${proxyHost}?url=${encodeURIComponent(abs)}&referer=${theReferer}"`;
            });
          }
          rewrittenResult += line + '\n';
        } else {
          const abs = resolveUrl(url, line);
          rewrittenResult += `${proxyHost}?url=${encodeURIComponent(abs)}&referer=${theReferer}\n`;
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

app.listen(PORT, () => console.log(`Optimized proxy running on port ${PORT}`));
