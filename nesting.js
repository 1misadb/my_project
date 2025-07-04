const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');

async function runNesting(binSvgPath, partSvgPaths, outputSvg) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--disable-web-security',
      ],
    });
  } catch (err) {
    console.error('Failed to launch browser:', err);
    return;
  }

  const page = await browser.newPage();
  page.on('console', m => console.log('[svg-nest]', m.text()));
  page.on('pageerror', err => console.error('[pageerror]', err));

  const basePath = 'file://' + path.join(__dirname, 'svgnest') + '/';
  await page.goto(basePath + 'index.html');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="select"></div>';
  });

  // scripts are loaded by svgnest/index.html

  await page.addStyleTag({ content: `
    #select{width:100%!important;height:auto!important;margin-top:2em;}
    #select svg{position:static!important;width:100%!important;height:auto!important;}
    html,body{margin:0;height:100%;}
  `});

  function stripOuterSvg(text){
    const m = text.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    return m ? m[1] : text;
  }

  const binContent = stripOuterSvg(fs.readFileSync(binSvgPath,'utf8'));
  const partsContent = partSvgPaths.map(p => stripOuterSvg(fs.readFileSync(p,'utf8')));
  const allSvg = `<svg xmlns="http://www.w3.org/2000/svg">${[binContent, ...partsContent].join('')}</svg>`;

  await page.evaluate((svgString) => {
    const wrap = document.getElementById('select');
    wrap.innerHTML = '';

    const root = window.SvgNest.parsesvg(svgString);
    wrap.appendChild(root);

    root.querySelectorAll('path').forEach(p => {
      const bb = p.getBBox();
      if (bb.width === 0 || bb.height === 0) {
        console.log('⚠️ Ignoring path with zero dimension');
        p.remove();
      } else {
        console.log('   ➜ detail bbox:', bb.width.toFixed(1), '×', bb.height.toFixed(1));
      }
    });

    const bin = root.firstElementChild;
    if (bin) {
      window.SvgNest.setbin(bin);
      const bb = bin.getBBox();
      console.log('✅ BIN bbox:', bb.width.toFixed(1), '×', bb.height.toFixed(1));
    }

    window.SvgNest.config({
      spacing:         2,
      rotations:       8,
      populationSize: 25,
      mutationRate:   15,
      exploreConcave: true,
      useHoles:       true
    });

  }, allSvg);


  /* --- старт поиска раскладки --- */
  await page.evaluate(() => {
    const TARGET_ITER = 120;
    const T_MAX_MS    = 90_000;

    let iterations = 0;
    window.finished = false;

    const target = document.getElementById('select');
    window.SvgNest.start(() => {}, svglist => {
      iterations++;
      if (iterations % 10 === 0)
        console.log(`🔁 Iteration ${iterations}`);
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

  const inner = await page.evaluate(() =>
    document.getElementById('select').innerHTML
  );

  fs.writeFileSync(
    outputSvg,
    `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
  );
  console.log('✅ nested SVG saved →', outputSvg);

  await browser.close();
}

module.exports = { runNesting };