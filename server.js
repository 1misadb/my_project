#!/usr/bin/env node
/*  REST-API: DXF → ( JSCAD | dxf2svg | Inkscape ) → SVG → SVG-Nest */

const express        = require('express');
const multer         = require('multer');
const fs             = require('fs');
const path           = require('path');
const { spawnSync }  = require('child_process');
const axios          = require('axios');
const cheerio        = require('cheerio');
const svgpath        = require('svgpath');

const { runNesting }  = require('./nesting');
const { deserialize } = require('@jscad/dxf-deserializer');
const { serialize }   = require('@jscad/svg-serializer');

/* ==== dxf2svg helper + fallback to Inkscape ========================= */
function dxf2svgPy(input, output) {
  const dir = path.dirname(output);
  const inName = path.basename(input);
  const produced = path.join(dir, inName.replace(/\.dxf$/i, '.svg'));

  [output, produced].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

  let r = spawnSync('python', ['-m', 'dxf2svg', inName], { cwd: dir, stdio: 'inherit' });

  if (!fs.existsSync(produced)) {
    console.warn('dxf2svg did not produce output. Trying Inkscape fallback...');
    const ink = spawnSync('inkscape', [inName, '--export-type=svg', '--export-filename', produced], { cwd: dir, stdio: 'inherit' });
    if (ink.error || ink.status) throw new Error('Inkscape DXF → SVG failed');
  }

  if (!fs.existsSync(produced)) throw new Error('No SVG produced by dxf2svg or Inkscape');

  if (produced !== output) fs.renameSync(produced, output);
}

/* ==== Center SVG after conversion ==================================== */
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

/* ==== Multer setup ================================================== */
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, __, cb) =>
    cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}.dxf`)
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const app = express();
const port = 3001;

/* ==== Disable cache ================================================= */
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/* ==== /nest ========================================================= */
app.post('/nest', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const dxf    = req.file.path;
  const svg    = dxf.replace(/\.dxf$/i, '.svg');
  const nested = svg.replace(/\.svg$/i, '.nested.svg');

  /* --- DXF → SVG --- */
  try {
    const obj = deserialize({ input: fs.readFileSync(dxf, 'utf8') });
    fs.writeFileSync(svg, serialize({}, obj));
    centerSvgFile(svg);
  } catch (e1) {
    console.warn('JSCAD failed:', e1.message, '→ dxf2svg + Inkscape');
    try {
      dxf2svgPy(dxf, svg);
      centerSvgFile(svg);
    } catch (e2) {
      console.error(e2.message);
      return res.status(500).send('DXF → SVG failed');
    }
  }

  /* --- SVG-Nest --- */
  try {
    await runNesting(svg, nested);
    res.download(nested, 'nested.svg', err => {
      if (err) console.error('Download error:', err);
      [dxf, svg, nested].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
    });
  } catch (err) {
    console.error('Nesting error:', err);
    res.status(500).send('Nesting failed');
  }
});
app.post('/nest-dxf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const dxf = req.file.path;
  const svg = dxf.replace(/\.dxf$/i, '.svg');
  const nestedSvg = svg.replace(/\.svg$/i, '.nested.svg');
  const nestedDxf = svg.replace(/\.svg$/i, '.nested.dxf');

  const py = spawnSync('python', ['dxf2svg_ezdxf.py', dxf, svg], { encoding: 'utf8' });
  if (py.error || py.status !== 0) return res.status(500).send('dxf2svg_ezdxf.py failed');

  try {
    await runNesting(svg, nestedSvg);
  } catch (err) {
    console.error('Nesting error:', err);
    return res.status(500).send('Nesting failed.');
  }

  const py2 = spawnSync('python', ['svg2dxf_ezdxf.py', nestedSvg, nestedDxf], { encoding: 'utf8' });
  if (py2.error || py2.status !== 0) return res.status(500).send('svg2dxf_ezdxf.py failed.');

  res.download(nestedDxf, 'nested.dxf', err => {
    if (err) console.error('Download error:', err);
    [dxf, svg, nestedSvg, nestedDxf].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
  });
});

/* ==== /convert-only ================================================= */
app.post('/convert-only', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const dxf = req.file.path;
  const svg = dxf.replace(/\.dxf$/i, '.svg');

  try {
    const model = deserialize({ input: fs.readFileSync(dxf, 'utf8') });
    fs.writeFileSync(svg, serialize({}, model));
    centerSvgFile(svg);
  } catch (e) {
    console.warn('JSCAD failed:', e.message, '→ dxf2svg + Inkscape');
    try {
      dxf2svgPy(dxf, svg);
      centerSvgFile(svg);
    } catch (err) {
      console.error(err.message);
      return res.status(500).send('DXF → SVG failed');
    }
  }

  res.download(svg, 'converted.svg', err => {
    if (err) console.error('Download error:', err);
    [dxf, svg].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
  });
});

/* ==== Global Error Handler ========================================== */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError)
    return res.status(400).send(err.message);
  if (err) return res.status(400).send(err.message);
  next();
});

app.listen(port,
  () => console.log(`DXF parser server running at http://localhost:${port}`));
