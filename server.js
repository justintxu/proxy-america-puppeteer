const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/debug', async (req, res) => {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    await page.goto('https://tvgo.americatv.com.pe/', { waitUntil: 'networkidle2', timeout: 30000 });

    const title = await page.title();
    const content = await page.content();

    res.json({
      title: title,
      isBlocked: content.includes('Access Denied') || content.includes('Cloudflare') || content.includes('403'),
      htmlSnippet: content.substring(0, 500)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => console.log(`Debug server listo en puerto ${PORT}`));