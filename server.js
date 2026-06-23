const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000;

// CORS headers for your frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Proxy endpoint
app.get('/proxy/stream', async (req, res) => {
  const targetUrl = req.query.url; // The raw m3u8 URL
  const customReferer = req.query.referer || 'https://target-website.com';
  const customOrigin = req.query.origin || 'https://target-website.com';

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'Referer': customReferer,
        'Origin': customOrigin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    // Determine the base URL to resolve relative .ts segment paths
    const urlObj = new URL(targetUrl);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)}`;

    // Parse the M3U8 string
    const m3u8Data = response.data;
    const lines = m3u8Data.split('\n');
    
    // Rewrite .ts segment URLs
    const modifiedLines = lines.map(line => {
      if (line.trim() && !line.startsWith('#')) {
        // Absolute or relative path to the .ts file
        const segmentUrl = line.startsWith('http') ? line : `${baseUrl}${line}`;
        // Route the .ts file through our proxy
        return `/proxy/segment?url=${encodeURIComponent(segmentUrl)}&referer=${encodeURIComponent(customReferer)}&origin=${encodeURIComponent(customOrigin)}`;
      }
      return line;
    });

    res.type('application/vnd.apple.mpegurl');
    res.send(modifiedLines.join('\n'));
  } catch (error) {
    res.status(500).send('Error fetching stream');
  }
});

// Segment Proxy to attach headers
app.get('/proxy/segment', async (req, res) => {
  const targetUrl = req.query.url;
  const customReferer = req.query.referer;
  const customOrigin = req.query.origin;

  try {
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Referer': customReferer,
        'Origin': customOrigin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    res.type('video/mp2t');
    res.send(response.data);
  } catch (error) {
    res.status(500).send('Error fetching segment');
  }
});

app.listen(PORT, () => console.log(`Proxy running on http://localhost:${PORT}`));

