const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

async function runNesting(binSvgPath, partSvgPaths, outputSvg) {
  let browser;

  try {
    console.log('🏁 Starting SVG nesting...');
    browser = await puppeteer.launch({
      headless: true, // Используй false для диагностики в окне
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--disable-web-security',
        '--disable-features=site-per-process', // важно для file://
        '--disable-features=IsolateOrigins',
      ],
    });

    const page = await browser.newPage();
    page.on('console', m => console.log('[svg-nest]', m.text()));
    page.on('pageerror', err => console.error('[svg-nest] [pageerror]', err));

    const indexHtmlUrl = pathToFileURL(path.join(__dirname, 'svgnest', 'index.html')).href;
    console.log('🔗 Loading index.html from:', indexHtmlUrl);

    await page.goto(indexHtmlUrl, { waitUntil: 'load' });
    console.log('[svg-nest] ✅ index.html loaded successfully');

    // Проверка доступности SvgNest
    await page.waitForFunction(() => typeof window.SvgNest !== 'undefined', { timeout: 10_000 });
    console.log('[svg-nest] ✅ SvgNest loaded in page context');

    // Очищаем body и удаляем favicon
    await page.evaluate(() => {
      document.body.innerHTML = '<div id="select"></div>';
      const favicons = document.querySelectorAll('link[rel~="icon"]');
      favicons.forEach(f => f.remove());
    });

    // Добавляем стили
    await page.addStyleTag({
      content: `
        #select { width:100%!important; height:auto!important; margin-top:2em; }
        #select svg { position:static!important; width:100%!important; height:auto!important; }
        html,body { margin:0; height:100%; }
      `,
    });

    // Чтение и подготовка SVG строк
    function stripOuterSvg(text) {
      const m = text.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
      return m ? m[1] : text;
    }

    const binContent = stripOuterSvg(fs.readFileSync(binSvgPath, 'utf8'));
    const partsContent = partSvgPaths.map(p => stripOuterSvg(fs.readFileSync(p, 'utf8')));
    const allSvg = `<svg xmlns="http://www.w3.org/2000/svg">${[binContent, ...partsContent].join('')}</svg>`;

    console.log('[svg-nest] SVG string length:', allSvg.length);

    // Передача SVG в браузерный контекст
    await page.evaluate((svgString) => {
      console.log('[svg-nest] 📝 evaluate entered');

      if (!window.SvgNest) throw new Error('SvgNest not found');

      const wrap = document.getElementById('select');
      if (!wrap) throw new Error('#select div not found');

      console.log('[svg-nest] ✅ DOM ready, parsing SVG');
      const root = window.SvgNest.parsesvg(svgString);
      if (!root) throw new Error('parsed root is null');

      wrap.innerHTML = '';
      wrap.appendChild(root);
      console.log('[svg-nest] ✅ SVG appended to DOM');

      const bin = root.firstElementChild;
      if (!bin) throw new Error('Bin not found');

      window.SvgNest.setbin(bin);
      console.log('[svg-nest] ✅ Bin set');

      // ✅ Минимальный spacing здесь
      window.SvgNest.config({
        spacing: 2, 
        rotations: 36,
        populationSize: 50,
        mutationRate: 45,
        exploreConcave: true,
        useHoles: true
      });

      console.log('[svg-nest] ✅ SvgNest configured');
    }, allSvg);

    // Запуск раскладки
    await page.evaluate(() => {
      console.log('[svg-nest] 🚀 Starting nesting algorithm');

      const TARGET_ITER = 360;
      const T_MAX_MS = 90_000;

      let iterations = 0;
      window.finished = false;

      const target = document.getElementById('select');
      window.SvgNest.start(() => {}, svglist => {
        iterations++;
        if (iterations % 10 === 0) console.log(`🔁 Iteration ${iterations}`);

        if (svglist && svglist.length) {
          target.innerHTML = '';
          svglist.forEach(s => target.appendChild(s));
        }

        if (iterations >= TARGET_ITER) window.finished = true;
      });

      setTimeout(() => {
        console.log(`⏰ Timeout after ${iterations} iterations`);
        window.finished = true;
      }, T_MAX_MS);
    });

    await page.waitForFunction('window.finished === true', { timeout: 120_000 });
    console.log('[svg-nest] ✅ Nesting finished');

    // Сохраняем результат
    const inner = await page.evaluate(() => document.getElementById('select').innerHTML);

    fs.writeFileSync(outputSvg, `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);
    console.log('✅ nested SVG saved →', outputSvg);

  } catch (err) {
    console.error('[svg-nest] ❌ Fatal error:', err);
  } finally {
    if (browser) await browser.close();
    console.log('👋 Browser closed');
  }
}

module.exports = { runNesting };
