const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000;

// Enable wide CORS policies
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Helper function to resolve relative HLS URLs
function resolveUrl(baseUrl, relativeUrl) {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  const urlObj = new URL(relativeUrl, baseUrl);
  return urlObj.href;
}

// Proxy endpoint
app.get('/proxy', async (req, res) => {
  const { url, referer } = req.query;

  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const config = {
      method: 'get',
      url: url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': referer || '',
        'Origin': referer ? new URL(referer).origin : '',
      },
      responseType: url.includes('.m3u8') ? 'text' : 'stream'
    };

    const response = await axios(config);

    if (url.includes('.m3u8')) {
      const lines = response.data.split('\n');
      const rewrittenLines = lines.map(line => {
        line = line.trim();
        if (!line) return '';
        
        if (line.startsWith('#')) {
          return line.replace(/URI=["']([^"']+)["']/g, (match, p1) => {
            const absoluteUri = resolveUrl(url, p1);
            const proxyUrl = `${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteUri)}&referer=${encodeURIComponent(referer || '')}`;
            return `URI="${proxyUrl}"`;
          });
        }
        
        const absoluteMediaUrl = resolveUrl(url, line);
        return `${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteMediaUrl)}&referer=${encodeURIComponent(referer || '')}`;
      });

      res.setHeader('Content-Type', 'application/x-mpegURL');
      return res.send(rewrittenLines.join('\n'));
    }

    res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
    response.data.pipe(res);
  } catch (error) {
    console.error(`Proxy Error fetching URL: ${url}`, error.message);
    res.status(error.response?.status || 500).send(error.message);
  }
});

app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
