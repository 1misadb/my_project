const path = require('path');
const { execSync } = require('child_process');
const { runNesting } = require('./nesting');

(async()=>{
  console.log('🏁 starting');

  const bin = path.join(__dirname,'bin.svg');          // лист материала
  const src = [
    'Engineering_Sign.svg',
    'GdHd5.svg',
    'example01.svg',
  ].map(f=>path.join(__dirname,'converted',f));

  // ① нормализуем координаты
  const ok = src.map(s=>{
    const out=s.replace(/\.svg$/,'_shift.svg');
    execSync(`python shift_svg_bbox.py "${s}" "${out}"`,{stdio:'inherit'});
    return out;
  });

  // ② запускаем SVG-Nest-через-Puppeteer
  const outSvg = path.join(__dirname,'nested-output.svg');
  await runNesting(bin,ok,outSvg);
})();
