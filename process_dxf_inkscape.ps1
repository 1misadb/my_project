param (
    [string]$input_dxf
)

$TEMP_SVG = "temp.svg"
$NESTED_SVG = "nested.svg"
$OUTPUT_DXF = "nested_output.dxf"

Write-Host "🔧 [1/4] Converting DXF to SVG using Node.js"

# Convert DXF → SVG
node -e "
const fs = require('fs');
const { deserialize } = require('@jscad/dxf-deserializer');
const { serialize } = require('@jscad/svg-serializer');

const input = fs.readFileSync('$input_dxf', 'utf8');
const objects = deserialize({ input });
const svg = serialize({}, objects);
fs.writeFileSync('$TEMP_SVG', svg);
console.log('✅ DXF converted to SVG: $TEMP_SVG');
"

Write-Host "🚀 [2/4] Running nesting using nesting.js"

# Run nesting.js
node nesting.js $TEMP_SVG $NESTED_SVG

Write-Host "✅ Nesting complete: $NESTED_SVG"

Write-Host "🔄 [3/4] Converting nested SVG back to DXF using Inkscape"

# Convert SVG → DXF using Inkscape
inkscape $NESTED_SVG --export-type="dxf" --export-filename=$OUTPUT_DXF

Write-Host "✅ [4/4] Conversion complete: $OUTPUT_DXF"

# Cleanup temp files
Remove-Item $TEMP_SVG
Remove-Item $NESTED_SVG

Write-Host "🎉 All done. Final nested DXF: $OUTPUT_DXF"
