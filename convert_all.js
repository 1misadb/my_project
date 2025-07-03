const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const cheerio = require('cheerio');
const svgpath = require('svgpath');
const { deserialize } = require('@jscad/dxf-deserializer');
const { serialize } = require('@jscad/svg-serializer');

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

function convertWithODA(input) {
  const dir = path.dirname(input);
  const inName = path.basename(input);
  const outputDir = path.join(dir, 'oda_out');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const r = spawnSync(
    '"C:\\Program Files\\ODA\\ODAFileConverter 26.4.0\\ODAFileConverter.exe"',
    [dir, outputDir, 'ACAD2018', 'R12', '1', '1', '*.dxf'],
    { stdio: 'inherit', shell: true }
  );

  if (r.error || r.status) throw new Error('ODA File Converter failed');

  const converted = path.join(outputDir, inName);
  if (!fs.existsSync(converted)) throw new Error('ODA did not produce output');

  fs.unlinkSync(input);
  fs.renameSync(converted, input);
}

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

function convertDxfToSvg(dxfFile, svgFile) {
  try {
    const dxfData = fs.readFileSync(dxfFile, 'utf8');
    const obj = deserialize({ input: dxfData });
    fs.writeFileSync(svgFile, serialize({}, obj));
    centerSvgFile(svgFile);
    console.log(`✅ Converted ${dxfFile} via JSCAD → ${svgFile}`);
    } catch (e1) {
    console.warn(`JSCAD failed on ${dxfFile}: ${e1.message} → trying ODA fallback`);
    try {
        convertWithODA(dxfFile);   // ODA Converter here
        dxf2svgPy(dxfFile, svgFile); // Then dxf2svg + Inkscape fallback inside it
        centerSvgFile(svgFile);
        console.log(`✅ Converted ${dxfFile} via ODA + dxf2svg/Inkscape → ${svgFile}`);
    } catch (e2) {
        console.error(`❌ Full conversion failed for ${dxfFile}: ${e2.message}`);
    }
  }
}

const dir = './converted';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.dxf'));

files.forEach(file => {
  const inputDxf = path.join(dir, file);
  const outputSvg = path.join(dir, file.replace(/\.dxf$/i, '.svg'));
  convertDxfToSvg(inputDxf, outputSvg);
});
