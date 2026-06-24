const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000;

// Enable wide CORS policies so your React client can access the proxy
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Helper function to resolve relative HLS URLs against a base URL
function resolveUrl(baseUrl, relativeUrl) {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  const urlObj = new URL(relativeUrl, baseUrl);
  return urlObj.href;
}

// Proxy endpoint
app.get('/proxy', async (req, res) => {
  const { url, headers: encodedHeaders } = req.query;

  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    // Decode custom headers if passed from front-end, otherwise set defaults
    let customHeaders = {};
    if (encodedHeaders) {
      try {
        customHeaders = JSON.parse(Buffer.from(encodedHeaders, 'base64').toString('ascii'));
      } catch (e) {
        console.error("Failed to parse custom headers", e);
      }
    }

    // Determine correct responseType (text for playlists, arraybuffer for media segments)
    const isM3u8 = url.includes('.m3u8');
    
    // Configuration matching standard "forbidden video" requirements
    const config = {
      method: 'get',
      url: url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': customHeaders.Referer || '',
        'Origin': customHeaders.Origin || '',
        ...customHeaders
      },
      responseType: isM3u8 ? 'text' : 'arraybuffer'
    };

    const response = await axios(config);

    // Handle Manifest File Parsing and URL Rewriting
    if (isM3u8) {
      const lines = response.data.split('\n');
      const rewrittenLines = lines.map(line => {
        line = line.trim();
        
        // Skip empty lines and comment lines unless they contain URI definitions
        if (!line) return '';

        if (line.startsWith('#')) {
          // Match URI tags inside attributes like #EXT-X-KEY:METHOD=AES-128,URI="keys.key"
          return line.replace(/URI=["']([^"']+)["']/g, (match, p1) => {
            const absoluteUri = resolveUrl(url, p1);
            const proxyUrl = `${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteUri)}&headers=${encodedHeaders || ''}`;
            return `URI="${proxyUrl}"`;
          });
        }

        // Rewrite media segments (.ts, .mp4, etc.) or nested variant playlists (.m3u8)
        const absoluteMediaUrl = resolveUrl(url, line);
        return `${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteMediaUrl)}&headers=${encodedHeaders || ''}`;
      });

      res.setHeader('Content-Type', 'application/x-mpegURL');
      return res.send(rewrittenLines.join('\n'));
    }

    // Handle standard video/binary chunk streaming (.ts files, keys, etc.)
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
    return res.send(Buffer.from(response.data));

  } catch (error) {
    console.error(`Proxy Error fetching URL: ${url}`, error.message);
    res.status(error.response?.status || 500).send(error.message);
  }
});

app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
