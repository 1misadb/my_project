const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

async function runNesting(binSvgPath, partSvgPath, outputSvg, multiplyCount = 1) {
  let browser;

  try {
    console.log('🏁 Starting SVG nesting...');
    browser = await puppeteer.launch({
      protocolTimeout: 3600000,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--disable-web-security',
        '--disable-features=site-per-process',
        '--disable-features=IsolateOrigins',
      ],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(3600000);
    page.on('console', m => console.log('[svg-nest]', m.text()));
    page.on('pageerror', err => console.error('[svg-nest] [pageerror]', err));

    const indexHtmlUrl = pathToFileURL(path.join(__dirname, 'svgnest', 'index.html')).href;
    console.log('🔗 Loading index.html from:', indexHtmlUrl);

    await page.goto(indexHtmlUrl, { waitUntil: 'load' });
    console.log('[svg-nest] ✅ index.html loaded successfully');

    // Проверка доступности SvgNest
    await page.waitForFunction(() => typeof window.SvgNest !== 'undefined', { timeout: 10_000 });
    console.log('[svg-nest] ✅ SvgNest loaded in page context');

    // Очистка body и favicon
    await page.evaluate(() => {
      document.body.innerHTML = '<div id="select"></div>';
      document.querySelectorAll('link[rel~="icon"]').forEach(f => f.remove());
    });

    // Добавление стилей
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

    let partContentOriginal = stripOuterSvg(fs.readFileSync(partSvgPath, 'utf8'));

    // Fix viewBox commas if needed
    partContentOriginal = partContentOriginal.replace(/viewBox="([^"]+)"/, (match, p1) => {
      const fixed = p1.replace(/,/g, ' ');
      return `viewBox="${fixed}"`;
    });

    // ✅ Обернуть весь контент в один <g>
    partContentOriginal = `<g id="part">${partContentOriginal}</g>`;

    const partsContent = [];
    for (let n = 0; n < multiplyCount; n++) {
      const textWithUniqueIds = partContentOriginal.replace(/id="([^"]+)"/g, `id="$1_${n}"`);
      partsContent.push(textWithUniqueIds);
    }

    const allSvg = `<svg xmlns="http://www.w3.org/2000/svg">${binContent}${partsContent.join('')}</svg>`;
    console.log('[svg-nest] SVG string length:', allSvg.length);

    // Передача SVG в браузерный контекст и настройка SvgNest
    await page.evaluate((svgString) => {
      console.log('[svg-nest] 📝 evaluate entered');
      if (!window.SvgNest) throw new Error('SvgNest not found');

      const wrap = document.getElementById('select');
      if (!wrap) throw new Error('#select div not found');

      const root = window.SvgNest.parsesvg(svgString);
      if (!root) throw new Error('parsed root is null');

      wrap.innerHTML = '';
      wrap.appendChild(root);
      console.log('[svg-nest] ✅ SVG appended to DOM');

      const bin = root.firstElementChild;
      if (!bin) throw new Error('Bin not found');
      window.SvgNest.setbin(bin);
      console.log('[svg-nest] ✅ Bin set');

      const binBox = bin.getBBox();
      console.log(`[svg-nest] 📏 Bin size: ${binBox.width.toFixed(2)} x ${binBox.height.toFixed(2)}`);

      const parts = Array.from(root.children).slice(1);
      parts.forEach((part, i) => {
        const box = part.getBBox();
        console.log(`[svg-nest] 📐 Part #${i} size: ${box.width.toFixed(2)} x ${box.height.toFixed(2)}`);
      });

      window.SvgNest.config({
        spacing: 5,
        rotations: 8,
        populationSize: 40,
        mutationRate: 5,
        exploreConcave: true,
        useHoles: true,
        curveTolerance: 0.0099999
      });

      console.log('[svg-nest] ✅ SvgNest configured');
    }, allSvg);

    // Запуск раскладки
    await page.evaluate(() => {
      console.log('[svg-nest] 🚀 Starting nesting algorithm');

      const TARGET_ITER = 200;
      const T_MAX_MS = 3000000;

      let iterations = 0;
      window.finished = false;

      const target = document.getElementById('select');
      window.SvgNest.start(() => { }, svglist => {
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

    await page.waitForFunction('window.finished === true', { timeout: 3600000 });
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

// ...весь твой код nesting.js выше...

module.exports = { runNesting };

// CLI-запуск через node nesting.js ...
if (require.main === module) {
  const [,, binSvg, partSvg, outputSvg, multiplyCountStr] = process.argv;

  if (!binSvg || !partSvg || !outputSvg || !multiplyCountStr) {
    console.log('Usage: node nesting.js <binSvg> <partSvg> <outputSvg> <multiplyCount>');
    process.exit(1);
  }

  const multiplyCount = parseInt(multiplyCountStr, 10);

  console.log(`🚀 Running nesting with params:
  Bin: ${binSvg}
  Part: ${partSvg}
  Output: ${outputSvg}
  Copies: ${multiplyCount}
  `);

  runNesting(binSvg, partSvg, outputSvg, multiplyCount);
}
