const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { deserialize } = require('@jscad/dxf-deserializer');
const { serialize } = require('@jscad/svg-serializer');
const svgpath = require('svgpath');
const cheerio = require('cheerio');

/* ==== DXF Cleaner ==================================================== */
function cleanDxfFile(inputFile) {
  const lines = fs.readFileSync(inputFile, 'utf8').split(/\r?\n/);
  const cleanLines = [];
  let skip = false;
  let currentEntity = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === '0' && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      currentEntity = nextLine.toUpperCase();

      if (['DIMENSION', 'HATCH', 'INSERT', 'MTEXT', 'TEXT', 'SOLID'].includes(currentEntity)) {
        skip = true;
      } else {
        skip = false;
      }
    }

    if (!skip) {
      cleanLines.push(lines[i]);
    }
  }

  fs.writeFileSync(inputFile, cleanLines.join('\n'), 'utf8');
  console.log(`✅ Cleaned DXF saved as ${inputFile}`);
}

/* ==== Center SVG ==================================================== */
function centerSvgFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(content, { xmlMode: true });

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  $('path').each((i, el) => {
    const d = $(el).attr('d');
    if (!d) return;

    const sp = svgpath(d);
    const segments = sp.segments;

    segments.forEach(seg => {
      for (let i = 1; i < seg.length; i += 2) {
        const x = seg[i];
        const y = seg[i + 1];
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    });
  });

  if (minX === Infinity || minY === Infinity) {
    console.warn('❌ No valid path data found in SVG.');
    return;
  }

  const shiftX = -minX;
  const shiftY = -minY;

  $('path').each((i, el) => {
    const d = $(el).attr('d');
    if (!d) return;
    const transformed = svgpath(d).translate(shiftX, shiftY).toString();
    $(el).attr('d', transformed);
  });

  const width = maxX - minX;
  const height = maxY - minY;
  $('svg').attr('viewBox', `0 0 ${width} ${height}`);

  fs.writeFileSync(filePath, $.xml());
  console.log(`✅ Centered SVG saved: ${filePath}`);
}

/* ==== Cleanup SVG ==================================================== */
function cleanupSvgFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(content, { xmlMode: true });

  $('g, rect, circle, ellipse, text, polygon, polyline, line, image, defs, style').remove();

  $('g').each((i, el) => {
    if ($(el).find('path').length === 0) $(el).remove();
  });

  $('[id]').each((i, el) => {
    if ($(el).children().length === 0) $(el).remove();
  });

  $('path').each((i, el) => {
    $(el).attr('fill', 'none');
    $(el).attr('stroke', 'black');
  });

  fs.writeFileSync(filePath, $.xml());
  console.log(`✅ Cleaned up SVG saved: ${filePath}`);
}

/* ==== ODA Converter ================================================== */
function convertWithODA(input) {
  const dir = path.dirname(input);
  const inName = path.basename(input);
  const outputDir = path.join(dir, 'oda_out');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const r = spawnSync(
    '"C:\\Program Files\\ODA\\ODAFileConverter 26.4.0\\ODAFileConverter.exe"',
    [dir, outputDir, 'ACAD12', 'DXF', '1', '1', '*.dxf'],
    { stdio: 'inherit', shell: true }
  );

  if (r.error || r.status) throw new Error('ODA File Converter failed');

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.dxf'));
  if (!files.length) throw new Error('ODA did not produce output');

  const converted = path.join(outputDir, files[0]);
  fs.unlinkSync(input);
  fs.renameSync(converted, input);
  return input;
}

/* ==== dxf2svg + Inkscape fallback ===================================== */
function dxf2svgPy(input, output) {
  const dir = path.dirname(output);
  const inName = path.basename(input);
  const produced = path.join(dir, inName.replace(/\.dxf$/i, '.svg'));

  [output, produced].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });

  let r = spawnSync('python', ['-m', 'dxf2svg', inName], { cwd: dir, stdio: 'inherit' });

  if (!fs.existsSync(produced)) {
    console.warn('dxf2svg failed. Trying Inkscape fallback...');
    r = spawnSync('inkscape', [inName, '--export-type=svg', '--export-filename', produced], { cwd: dir, stdio: 'inherit' });
    if (r.error || r.status) throw new Error('Inkscape DXF → SVG failed');
  }

  if (!fs.existsSync(produced)) throw new Error('No SVG produced by dxf2svg or Inkscape');

  if (produced !== output) fs.renameSync(produced, output);
}

/* ==== Main convert function =========================================== */
function convertDxfToSvg(dxfFile, svgFile) {
  try {
    cleanDxfFile(dxfFile);

    const dxfData = fs.readFileSync(dxfFile, 'utf8');
    const obj = deserialize({ input: dxfData });
    fs.writeFileSync(svgFile, serialize({}, obj));
    centerSvgFile(svgFile);
    cleanupSvgFile(svgFile);
    console.log(`✅ Converted ${dxfFile} via JSCAD → ${svgFile}`);
  } catch (e1) {
    console.warn(`JSCAD failed on ${dxfFile}: ${e1.message} → trying ODA fallback`);
    try {
      convertWithODA(dxfFile);
      dxf2svgPy(dxfFile, svgFile);
      centerSvgFile(svgFile);
      cleanupSvgFile(svgFile);
      console.log(`✅ Converted ${dxfFile} via ODA + dxf2svg/Inkscape → ${svgFile}`);
    } catch (e2) {
      console.error(`❌ Full conversion failed for ${dxfFile}: ${e2.message}`);
    }
  }
}

module.exports = { convertDxfToSvg };

/* === CLI TEST === */
if (require.main === module) {
  const [, , dxfFile, svgFile] = process.argv;
  if (!dxfFile || !svgFile) {
    console.error('Usage: node convert_full.js input.dxf output.svg');
    process.exit(1);
  }
  convertDxfToSvg(dxfFile, svgFile);
}
