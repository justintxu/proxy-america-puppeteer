const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ID de transmisión en vivo de América TV en Mediastream
const MEDIASTREAM_ID = '6013233842323708233b8a8b';

app.get('/americatv.m3u8', async (req, res) => {
  try {
    // 1. Pedir el player config a la API oficial de Mediastream (mdstrm.com)
    const apiUrl = `https://platform.mdstrm.com/api/player?id=${MEDIASTREAM_ID}`;
    const apiRes = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://tvgo.americatv.com.pe/',
        'Origin': 'https://tvgo.americatv.com.pe'
      }
    });

    const srcList = apiRes.data?.data?.src;
    let liveUrl = null;

    if (Array.isArray(srcList)) {
      const hlsObj = srcList.find(s => 
        s.type === 'application/x-mpegURL' || 
        s.type === 'application/vnd.apple.mpegurl' || 
        (s.src && s.src.includes('.m3u8'))
      );
      if (hlsObj) liveUrl = hlsObj.src;
    }

    if (!liveUrl) {
      throw new Error('No se encontro la fuente m3u8 en la respuesta de Mediastream');
    }

    // 2. Obtener el manifiesto m3u8 real pasándole las cabeceras requeridas
    const response = await axios.get(liveUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://tvgo.americatv.com.pe/',
        'Origin': 'https://tvgo.americatv.com.pe'
      },
      responseType: 'text'
    });

    let manifest = response.data;
    const baseUrl = liveUrl.substring(0, liveUrl.lastIndexOf('/') + 1);
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';

    // 3. Reescribir fragmentos/segmentos para pasarlos por el proxy
    manifest = manifest.split('\n').map(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return line;
      
      let segmentUrl = line;
      if (!line.startsWith('http')) {
        segmentUrl = baseUrl + line;
      }
      return `${protocol}://${host}/segment?url=${encodeURIComponent(segmentUrl)}`;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(manifest);

  } catch (error) {
    console.error('Error al obtener la senal:', error.message);
    res.status(500).send('Error obteniendo la senal de America TV: ' + error.message);
  }
});

// Ruta intermediaria para procesar los fragmentos de video
app.get('/segment', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Falta parametro url');

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://tvgo.americatv.com.pe/',
        'Origin': 'https://tvgo.americatv.com.pe'
      },
      responseType: 'arraybuffer'
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (targetUrl.includes('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    res.send(response.data);
  } catch (error) {
    res.status(500).send('Error cargando segmento');
  }
});

app.listen(PORT, () => {
  console.log(`Proxy API listo en puerto ${PORT}`);
});