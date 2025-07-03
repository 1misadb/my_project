import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M10,10 L90,10 L90,90 L10,90 Z" />
    </svg>
  `);
  const bbox = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    const path = svg.querySelector('path');
    const bb = path.getBBox();
    return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  });
  console.log(bbox);
  await browser.close();
})();
