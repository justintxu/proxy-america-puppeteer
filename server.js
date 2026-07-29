const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

let cachedStreamUrl = null;
let lastFetchTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // Reciclar la URL cada 15 minutos

// Función para obtener la URL del stream en vivo usando un navegador 
invisible
async function getFreshStreamUrl() {
  const now = Date.now();
  if (cachedStreamUrl && (now - lastFetchTime < CACHE_DURATION)) {
    console.log('Usando URL de stream guardada en cache...');
    return cachedStreamUrl;
  }

  console.log('Iniciando Puppeteer para extraer token fresco de America 
TV...');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  
  // Establecer User-Agent de navegador real
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) 
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  let streamUrl = null;

  // Escuchar todas las peticiones de red para capturar el .m3u8 de 
Mediastream
  page.on('request', request => {
    const url = request.url();
    if (url.includes('mdstrm.com/live-stream-secure') && 
url.includes('.m3u8')) {
      if (!streamUrl) {
        streamUrl = url;
        console.log('¡URL de stream capturada con exito!');
      }
    }
  });

  try {
    // Visitar la web oficial para que cargue la señal y genere 
cookies/tokens
    await page.goto('https://tvgo.americatv.com.pe/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Esperar unos segundos por si el reproductor tarda en arrancar
    let attempts = 0;
    while (!streamUrl && attempts < 10) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }
  } catch (err) {
    console.error('Error durante la navegacion con Puppeteer:', 
err.message);
  } finally {
    await browser.close();
  }

  if (streamUrl) {
    cachedStreamUrl = streamUrl;
    lastFetchTime = now;
    return streamUrl;
  } else {
    throw new Error('No se pudo interceptar la URL del stream de America 
TV.');
  }
}

// Ruta principal para tu lista IPTV / VLC
app.get('/americatv.m3u8', async (req, res) => {
  try {
    const liveUrl = await getFreshStreamUrl();
    
    // Obtener el manifiesto usando la URL recién generada
    const response = await axios.get(liveUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) 
AppleWebKit/537.36',
        'Referer': 'https://tvgo.americatv.com.pe/',
        'Origin': 'https://tvgo.americatv.com.pe'
      },
      responseType: 'text'
    });

    let manifest = response.data;
    const baseUrl = liveUrl.substring(0, liveUrl.lastIndexOf('/') + 1);
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';

    // Reescribir los fragmentos para reenviarlos por el proxy
    manifest = manifest.split('\n').map(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return line;
      
      let segmentUrl = line;
      if (!line.startsWith('http')) {
        segmentUrl = baseUrl + line;
      }
      return 
`${protocol}://${host}/segment?url=${encodeURIComponent(segmentUrl)}`;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(manifest);
  } catch (error) {
    console.error('Error al entregar el manifiesto:', error.message);
    res.status(500).send('Error obteniendo la senal de America TV');
  }
});

// Ruta intermediaria para descargar los segmentos de video (.ts)
app.get('/segment', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Falta parametro url');

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) 
AppleWebKit/537.36',
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
  console.log(`Proxy Puppeteer de America TV listo en puerto ${PORT}`);
});
