/**
 * Делает верхний-левый угол viewBox'а (0;0).
 * Работает с любыми SVG, ничего не ломает: если координаты
 * уже положительные — просто возвращает исходный текст.
 */
const fs      = require('fs');
const cheerio = require('cheerio');

function fixSvgBBox(inFile, outFile = inFile) {
  const xml = fs.readFileSync(inFile, 'utf8');
  const $   = cheerio.load(xml, { xmlMode: true });

  const $svg = $('svg').first();
  if (!$svg.length) return;                              // не SVG

  /* --- берём viewBox или строим его из width/height --- */
  let v = ($svg.attr('viewBox') || '').trim().split(/\s+/).map(Number);
  if (v.length !== 4 || v.some(isNaN)) {
    const w = parseFloat($svg.attr('width'))  || 0;
    const h = parseFloat($svg.attr('height')) || 0;
    v = [0, 0, w, h];
  }
  let [x, y, w, h] = v;

  /* --- если всё уже положительно, — просто сохраняем --- */
  if (x >= 0 && y >= 0) { fs.writeFileSync(outFile, $.xml()); return; }

  /* --- оборачиваем контент в <g translate()> --- */
  const dx = x < 0 ? -x : 0;
  const dy = y < 0 ? -y : 0;

  const $g = $('<g/>').attr('transform', `translate(${dx} ${dy})`);
  $svg.children().appendTo($g);      // переносим ВСЁ внутрь группы
  $svg.empty().append($g);

  /* --- viewBox теперь от (0;0) --- */
  $svg.attr('viewBox', `0 0 ${w + dx} ${h + dy}`);

  fs.writeFileSync(outFile, $.xml());
}
module.exports = { fixSvgBBox };
