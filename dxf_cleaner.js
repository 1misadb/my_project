const fs = require('fs');

function cleanDxfFile(inputFile, outputFile) {
  const lines = fs.readFileSync(inputFile, 'utf8').split(/\r?\n/);
  const cleanLines = [];
  let skip = false;
  let currentEntity = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect entity start
    if (line === '0' && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      currentEntity = nextLine.toUpperCase();

      // Skip these entity types
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

  fs.writeFileSync(outputFile, cleanLines.join('\n'), 'utf8');
  console.log(`✅ Cleaned DXF saved as ${outputFile}`);
}

/* === CLI TEST === */
if (require.main === module) {
  const [, , inputFile, outputFile] = process.argv;
  if (!inputFile || !outputFile) {
    console.error('Usage: node dxf_cleaner.js input.dxf output.dxf');
    process.exit(1);
  }
  cleanDxfFile(inputFile, outputFile);
}

module.exports = { cleanDxfFile };
