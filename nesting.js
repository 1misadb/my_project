const fs        = require('fs');
const path      = require('path');
const express   = require('express');
const puppeteer = require('puppeteer');

async function runNesting(binSvgPath, partSvgPaths, outputSvg) {
  const staticServer = express()
    .use(express.static(path.join(__dirname, 'svgnest')))
    .listen(0);
  const url = `http://localhost:${staticServer.address().port}/index.html`;

  const browser = await puppeteer.launch({ headless: true });
  const page    = await browser.newPage();
  page.on('console', m => console.log('[svg-nest]', m.text()));
  await page.goto(url, { waitUntil: 'networkidle0' });

  await page.addStyleTag({ content: `
    #select{width:100%!important;height:auto!important;margin-top:2em;}
    #select svg{position:static!important;width:100%!important;height:auto!important;}
    html,body{margin:0;height:100%;}
  `});

  const binText   = fs.readFileSync(binSvgPath , 'utf8');
  const partsText = partSvgPaths.map(p => fs.readFileSync(p,'utf8'));

  await page.evaluate((binSVG, partsSVG) => {

    const wrap = document.getElementById('select');
    wrap.innerHTML = '';

    /* ---------- BIN ---------- */
    const bin = window.SvgNest.parsesvg(binSVG);
    bin.removeAttribute('width');
    bin.removeAttribute('height');

    if (!bin.hasAttribute('viewBox')) {
      const w = parseFloat(bin.getAttribute('width'))  || 3000;
      const h = parseFloat(bin.getAttribute('height')) || 1500;
      bin.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    wrap.appendChild(bin);
    window.SvgNest.setbin(bin);

    console.log('✅ BIN bbox:',
                bin.viewBox.baseVal.width,
                '×',
                bin.viewBox.baseVal.height);

    /* ---------- DETAILS ---------- */
    partsSVG.forEach(txt => {
      const svgElem = window.SvgNest.parsesvg(txt);
      svgElem.removeAttribute('width');
      svgElem.removeAttribute('height');

      // DEBUG
      console.log('🛠 svgElem.outerHTML:', svgElem.outerHTML);

      /* кладём во временный DOM, чтобы getBBox работал */
      svgElem.style.visibility = 'hidden';
      wrap.appendChild(svgElem);

      svgElem.querySelectorAll('path').forEach(path => {
        const bb = path.getBBox();

        console.log('   ➜ detail bbox:',
                    bb.width.toFixed(1),'×',bb.height.toFixed(1));

        const g = document.createElementNS(path.namespaceURI,'g');
        g.setAttribute('class','nestable');
        g.appendChild(path);         // path внутрь g
        svgElem.appendChild(g);      // g остался в svgElem
      });
    });

    window.SvgNest.config({
      spacing:         2,
      rotations:       8,
      populationSize: 25,
      mutationRate:   15,
      exploreConcave: true,
      useHoles:       true
    });

  }, binText, partsText);

  /* --- старт поиска раскладки --- */
  await page.evaluate(() => {
    const TARGET_ITER = 120;
    const T_MAX_MS    = 90_000;

    let iterations = 0;
    window.finished = false;

    const origRender = window.SvgNest.renderSvg;
    window.SvgNest.renderSvg = (...args) => {
      iterations++;
      if (iterations % 10 === 0)
        console.log(`🔁 Iteration ${iterations}`);
      origRender(...args);
      if (iterations >= TARGET_ITER) window.finished = true;
    };

    document.querySelector('#start').classList.remove('disabled');
    document.querySelector('#start').click();

    setTimeout(() => {
      console.log(`⏰ Timeout after ${iterations} iterations`);
      window.finished = true;
    }, T_MAX_MS);
  });

  await page.waitForFunction('window.finished === true', { timeout: 12_000 });

  const inner = await page.evaluate(() =>
    document.getElementById('select').innerHTML
  );

  fs.writeFileSync(
    outputSvg,
    `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
  );
  console.log('✅ nested SVG saved →', outputSvg);

  await browser.close();
  staticServer.close();
}

module.exports = { runNesting };
