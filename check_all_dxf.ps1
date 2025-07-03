# Requires Node.js, @jscad/dxf-deserializer, @jscad/svg-serializer, Inkscape

"File,Node.js,Inkscape" | Out-File convert_report.csv

$nodeCheck = {
    param($file)
    try {
        $result = node -e "
        const fs=require('fs');
        const{deserialize}=require('@jscad/dxf-deserializer');
        const{serialize}=require('@jscad/svg-serializer');
        const input=fs.readFileSync('$file','utf8');
        const objects=deserialize({input});
        const objects2d=(objects.children||[]).filter(obj=>['path2','geom2','line','circle','arc','polyline'].includes(obj.type));
        if(objects2d.length===0){console.log('NO2D')}else{
        const svg=serialize({},objects2d);fs.writeFileSync('temp.svg',svg);
        console.log('OK');}"
        return $result.Trim()
    } catch {
        return "ERROR"
    }
}

$inkscapeCheck = {
    param($file)
    try {
        $svg = "$file.svg"
        & "C:\Program Files\Inkscape\inkscape.exe" "$file" --export-type="svg" --export-filename="$svg"
        if (Test-Path $svg) {
            Remove-Item $svg
            return "OK"
        } else {
            return "FAIL"
        }
    } catch {
        return "ERROR"
    }
}

Get-ChildItem *.dxf | ForEach-Object {
    $f = $_.FullName
    Write-Host "🔍 Checking $f..."
    $node = & $nodeCheck $f
    if ($node -eq "OK") {
        $ink = "-"
    } else {
        $ink = & $inkscapeCheck $f
    }
    "$($_.Name),$node,$ink" | Out-File convert_report.csv -Append
    Write-Host "✔️ $($_.Name) | Node.js: $node | Inkscape: $ink"
}
