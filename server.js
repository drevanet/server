const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const referer = req.query.referer || 'https://google.com';

  if (!targetUrl) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'Referer': referer,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      responseType: 'arraybuffer' // Necessary for video/binary streaming
    });

    res.set(response.headers);
    res.send(Buffer.from(response.data, 'binary'));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
