const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

function stripOuterSvg(text) {
  const m = text.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  return m ? m[1] : text;
}

async function runNesting(binSvgPath, partSvgPath, outputSvg, multiplyCount) {
  let browser;

  try {
    console.log('🏁 Starting SVG nesting...');
    browser = await puppeteer.launch({
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
    page.on('console', m => console.log('[svg-nest]', m.text()));
    page.on('pageerror', err => console.error('[svg-nest] [pageerror]', err));

    const indexHtmlUrl = pathToFileURL(path.join(__dirname, 'svgnest', 'index.html')).href;
    console.log('🔗 Loading index.html from:', indexHtmlUrl);
    await page.goto(indexHtmlUrl, { waitUntil: 'load' });
    console.log('[svg-nest] ✅ index.html loaded successfully');

    // Prepare bin
    const binContent = stripOuterSvg(fs.readFileSync(binSvgPath, 'utf8'));

    // Prepare part, ensure viewBox uses spaces
    let partContentOriginalRaw = fs.readFileSync(partSvgPath, 'utf8');
    partContentOriginalRaw = partContentOriginalRaw.replace(/viewBox="([^"]+)"/, (match, p1) => {
      const fixed = p1.replace(/,/g, ' ');
      return `viewBox="${fixed}"`;
    });

    const partStripped = stripOuterSvg(partContentOriginalRaw);

    // Duplicate as groups
    const partsContent = [];
    for (let n = 0; n < multiplyCount; n++) {
      const withUniqueIds = partStripped.replace(/id="([^"]+)"/g, `id="$1_${n}"`);
      const wrapped = `<g id="part_${n}">${withUniqueIds}</g>`;
      partsContent.push(wrapped);
    }

    const allSvg = `<svg xmlns="http://www.w3.org/2000/svg">${binContent}${partsContent.join('')}</svg>`;
    console.log('[svg-nest] SVG string length:', allSvg.length);

    // Evaluate in browser
    await page.evaluate((svgString) => {
      console.log('[svg-nest] 📝 evaluate entered');

      if (!window.SvgNest) throw new Error('SvgNest not found');

      const wrap = document.getElementById('select');
      if (!wrap) throw new Error('#select div not found');

      wrap.innerHTML = '';
      const root = window.SvgNest.parsesvg(svgString);
      if (!root || !root.children.length) throw new Error('SVG has no children');
      wrap.appendChild(root);
      console.log('[svg-nest] ✅ SVG appended to DOM');

      const bin = root.firstElementChild;
      if (!bin) throw new Error('Bin not found');
      window.SvgNest.setbin(bin);

      window.SvgNest.config({
        spacing: 5,
        rotations: 16,
        populationSize: 40,
        mutationRate: 15,
        exploreConcave: true,
        useHoles: true,
        curveTolerance: 0.01
      });

      console.log('[svg-nest] ✅ SvgNest configured');
    }, allSvg);

    // Start nesting
    await page.evaluate(() => {
      console.log('[svg-nest] 🚀 Starting nesting algorithm');
      const TARGET_ITER = 100;
      const T_MAX_MS = 300000;
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

    await page.waitForFunction('window.finished === true', { timeout: 3600000 });
    console.log('[svg-nest] ✅ Nesting finished');

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

// CLI mode
if (require.main === module) {
  const [,, binSvg, partSvg, outputSvg, multiplyCountStr] = process.argv;
  const multiplyCount = parseInt(multiplyCountStr, 10);
  console.log(`🚀 Running nesting with copies: ${multiplyCount}`);
  runNesting(binSvg, partSvg, outputSvg, multiplyCount);
}

module.exports = { runNesting };
