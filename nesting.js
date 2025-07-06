const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

function stripOuterSvg(text) {
  const m = text.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  return m ? m[1] : text;
}

function escapeReg(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeUnique(svg, idx) {
  const foundIds = [];
  let out = svg.replace(/id="([^"]+)"/g, (_, id) => {
    foundIds.push(id);
    return `id="${id}_${idx}"`;
  });

  for (const id of foundIds) {
    const safe = escapeReg(id);
    const target = `${id}_${idx}`;
    out = out.replace(new RegExp(`url\\(#${safe}\\)`, 'g'), `url(#${target})`);
    out = out.replace(new RegExp(`href="#${safe}"`, 'g'), `href="#${target}"`);
    out = out.replace(new RegExp(`xlink:href="#${safe}"`, 'g'), `xlink:href="#${target}"`);
  }
  return out;
}

async function runNesting(binSvgPath, partSvgArray, outputSvg, multiplyCounts) {
  let browser;

  try {
    console.log('🏁 Starting SVG nesting...');
    browser = await puppeteer.launch({
      protocolTimeout: 3600000, // 1 hour
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

    // Prepare all parts
    const partsContent = [];
    for (let i = 0; i < partSvgArray.length; i++) {
      const partPath = partSvgArray[i];
      const count = multiplyCounts[i];

      let partContent = fs.readFileSync(partPath, 'utf8');
      partContent = partContent.replace(/viewBox="([^"]+)"/, (match, p1) => {
        return `viewBox="${p1.replace(/,/g, ' ')}"`;
      });

      const stripped = stripOuterSvg(partContent);

      for (let n = 0; n < count; n++) {
        const copy = makeUnique(stripped, `${i}_${n}`);
        const wrapped = `<g id="part_${i}_${n}">${copy}</g>`;
        partsContent.push(wrapped);
      }
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
        rotations: 8,
        populationSize: 2,
        mutationRate: 15,
        exploreConcave: true,
        useHoles: true,
        curveTolerance: 0.00999
      });

      console.log('[svg-nest] ✅ SvgNest configured');
    }, allSvg);

    // Start nesting
    await page.evaluate(() => {
      console.log('[svg-nest] 🚀 Starting nesting algorithm');
      const TARGET_ITER = 20;
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
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log('Usage: node nesting.js bin.svg part1.svg part2.svg ... output.svg count1 count2 ...');
    process.exit(1);
  }

  const binSvg = args.shift();
  const counts = args.splice(-args.length / 2).map(x => parseInt(x,10));
  const outputSvg = args.pop();
  const partSvgs = args;

  console.log(`🚀 Running nesting
  Bin: ${binSvg}
  Parts: ${partSvgs.join(', ')}
  Output: ${outputSvg}
  Copies: ${counts.join(', ')}
  `);

  runNesting(binSvg, partSvgs, outputSvg, counts);
}

module.exports = { runNesting };
