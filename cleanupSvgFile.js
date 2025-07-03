const fs = require('fs');
const cheerio = require('cheerio');

function cleanupSvgFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(content, { xmlMode: true });

  // Удаляем все элементы кроме path
  $('g, rect, circle, ellipse, text, polygon, polyline, line, image, defs, style').remove();

  // Удаляем группы без path внутри
  $('g').each((i, el) => {
    if ($(el).find('path').length === 0) $(el).remove();
  });

  // Удаляем пустые слои
  $('[id]').each((i, el) => {
    if ($(el).children().length === 0) $(el).remove();
  });

  // Обновляем стили path (fill:none; stroke:black)
  $('path').each((i, el) => {
    $(el).attr('fill', 'none');
    $(el).attr('stroke', 'black');
  });

  // Сохраняем очищенный SVG
  fs.writeFileSync(filePath, $.xml());
  console.log(`✅ Cleaned up SVG saved: ${filePath}`);
}

module.exports = { cleanupSvgFile };
