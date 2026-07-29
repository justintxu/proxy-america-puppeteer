const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

let cachedStreamUrl = null;
let lastFetchTime = 0;
const CACHE_DURATION = 10 * 60 * 1000;

async function getFreshStreamUrl() {
  const now = Date.now();
  if (cachedStreamUrl && (now - lastFetchTime < CACHE_DURATION)) {
    console.log('Usando URL guardada en cache...');
    return cachedStreamUrl;
  }

  console.log('Iniciando Chromium con inspección de iFrames...');

  let browser = null;
  let streamUrl = null;

  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--autoplay-policy=no-user-gesture-required',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ],
      defaultViewport: { width: 1280, height: 720 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    // User Agent completo para evitar bloqueos
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    // Escuchar todas las peticiones m3u8 de la red
    page.on('request', req => {
      const url = req.url();
      if (url.includes('.m3u8')) {
        console.log('Filtro interceptó m3u8:', url);
        if (!streamUrl && !url.includes('dummy')) {
          streamUrl = url;
          console.log('¡URL manifest HLS obtenida con éxito!');
        }
      }
    });

    // Navegar a la web de América TV
    await page.goto('https://tvgo.americatv.com.pe/', {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    console.log('Buscando frames del reproductor...');
    await new Promise(r => setTimeout(r, 3000));

    // Iterar sobre todos los frames e intentar hacer click en el botón play dentro de cada uno
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const frameUrl = frame.url();
        console.log('Frame detectado:', frameUrl);
        
        // Simular clicks en posibles botones de play dentro del frame
        await frame.evaluate(() => {
          const playBtn = document.querySelector('.vjs-big-play-button') || 
                          document.querySelector('button[aria-label="Play"]') ||
                          document.querySelector('video') ||
                          document.querySelector('.play-icon');
          if (playBtn) playBtn.click();
        });
      } catch (e) {
        // Ignorar si el frame no es accesible por cross-origin
      }
    }

    // Clic global por respaldo
    await page.mouse.click(640, 360);

    let attempts = 0;
    while (!streamUrl && attempts < 15) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }

  } catch (err) {
    console.error('Error durante la navegación:', err.message);
  } finally {
    if (browser) await browser.close();
  }

  if (streamUrl) {
    cachedStreamUrl = streamUrl;
    lastFetchTime = now;
    return streamUrl;
  } else {
    throw new Error('No se pudo interceptar la señal m3u8 tras revisar los iFrames.');
  }
}

app.get('/americatv.m3u8', async (req, res) => {
  try {
    const liveUrl = await getFreshStreamUrl();
    
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
    console.error('Error manifiesto:', error.message);
    res.status(500).send('Error obteniendo la señal: ' + error.message);
  }
});

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
  console.log(`Proxy listo en puerto ${PORT}`);
});