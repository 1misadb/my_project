#!/usr/bin/env node

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const cheerio = require('cheerio');
const svgpath = require('svgpath');
const { runNesting } = require('./nesting');
const { deserialize } = require('@jscad/dxf-deserializer');
const { serialize } = require('@jscad/svg-serializer');

/* ==== dxf2svg helper using dxf2svg_ezdxf.py ========================= */
function dxf2svgPy(input, output) {
  const py = spawnSync('python', ['dxf2svg_ezdxf.py', input, output], { encoding: 'utf8', stdio: 'inherit' });
  if (py.error || py.status !== 0 || !fs.existsSync(output))
    throw new Error('dxf2svg_ezdxf.py failed for ' + input);
}

/* ==== Center SVG after conversion ==================================== */
function centerSvgFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(content, { xmlMode: true });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  $('path').each((i, el) => {
    const d = $(el).attr('d');
    if (!d) return;
    const sp = svgpath(d).abs();
    sp.segments.forEach(seg => {
      for (let i = 1; i < seg.length; i += 2) {
        const x = seg[i], y = seg[i + 1];
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

  const shiftX = -minX, shiftY = -minY;

  $('path').each((i, el) => {
    const d = $(el).attr('d');
    if (!d) return;
    $(el).attr('d', svgpath(d).translate(shiftX, shiftY).toString());
  });

  $('svg').attr('viewBox', `0 0 ${maxX - minX} ${maxY - minY}`);
  fs.writeFileSync(filePath, $.xml());
  console.log(`✅ Centered SVG saved: ${filePath}`);
}

/* ==== Multer setup ================================================== */
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, __, cb) => cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}.dxf`)
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const app = express();
const port = 3001;

/* ==== Disable cache ================================================= */
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/* ==== /convert-only ================================================= */
app.post('/convert-only', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const dxf = req.file.path;
  const svg = dxf.replace(/\.dxf$/i, '.svg');

  try {
    dxf2svgPy(dxf, svg);
    centerSvgFile(svg);
  } catch (err) {
    console.error(err.message);
    return res.status(500).send('DXF → SVG failed');
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

/* ==== Startup: Convert DXF -> SVG, Shift, Nest ====================== */
app.listen(port, async () => {
  console.log(`DXF parser server running at http://localhost:${port}`);

  const convertedDir = path.join(__dirname, 'converted');
  const bin = path.join(__dirname, 'bin.svg');
  const outSvg = path.join(__dirname, 'nested-output.svg');

  if (!fs.existsSync(convertedDir)) {
    console.log('⚠️ Folder "converted" does not exist.');
    return;
  }

  const files = fs.readdirSync(convertedDir).filter(f => f.endsWith('.dxf'));
  console.log(`\n📏 Converting ${files.length} DXF files to SVG:`);

  const svgFiles = [];

  for (const f of files) {
    const dxfPath = path.join(convertedDir, f);
    const svgPath = dxfPath.replace(/\.dxf$/i, '.svg');
    try {
      dxf2svgPy(dxfPath, svgPath);
      svgFiles.push(svgPath);
    } catch (err) {
      console.error(`❌ Failed to convert ${f}: ${err.message}`);
    }
  }

  console.log(`\n🔧 Shifting ${svgFiles.length} SVG files:`);

  const shiftedFiles = svgFiles.map(s => {
    const out = s.replace(/\.svg$/, '_shift.svg');
    console.log(`⚙️ Shifting bbox: ${path.basename(s)}`);
    execSync(`python shift_svg_bbox.py "${s}" "${out}"`, { stdio: 'inherit' });
    return out;
  });

  console.log('\n🚀 Running SVG nesting...');
  await runNesting(bin, shiftedFiles, outSvg);
  console.log(`✅ Nesting finished. Output saved to ${outSvg}`);
});
