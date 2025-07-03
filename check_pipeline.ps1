# pipeline.ps1 – проверка DXF ➜ SVG ➜ JS ➜ DXF
"File,DXFtoSVG,SVGtoJS,JStoDXF" |
    Set-Content -Path 'convert_pipeline_report.csv' -Encoding UTF8

function Convert-DxfToSvg {
    param([string]$DxfPath)

    $svgPath = [IO.Path]::ChangeExtension($DxfPath,'svg')

    try {
        & 'C:\Program Files\Inkscape\inkscape.exe' `
          "$DxfPath" --export-type=svg --export-filename="$svgPath" `
          --batch-process --actions='file-close'

        return @{Status = (Test-Path $svgPath ? 'OK' : 'FAIL'); Svg = $svgPath}
    } catch { return @{Status = 'ERROR'; Svg = $null} }
}

function Parse-SvgToJs {
    param([string]$SvgPath)

    if (-not (Test-Path $SvgPath)) { return 'MISSING' }

    try {
        $r = node -e "
          const fs=require('fs');
          console.log(fs.readFileSync('$SvgPath','utf8').includes('<svg')?'OK':'FAIL');
        "
        return $r.Trim()
    } catch { return 'ERROR' }
}

function Convert-JsToDxf {
    param([string]$SvgPath)

    $dxfPath = [IO.Path]::ChangeExtension($SvgPath,'dxf')

    try {
        & 'C:\Program Files\Inkscape\inkscape.exe' `
          "$SvgPath" --export-type=dxf --export-filename="$dxfPath" `
          --batch-process --actions='file-close'

        return (Test-Path $dxfPath ? 'OK' : 'FAIL')
    } catch { return 'ERROR' }
}

Get-ChildItem -Filter *.dxf | ForEach-Object {
    $dxfPath   = $_.FullName

    # 1) DXF ➜ SVG
    $step1     = Convert-DxfToSvg $dxfPath
    $s1        = $step1.Status
    $svgPath   = $step1.Svg

    # 2) SVG ➜ «JS» (честно говоря, просто проверка, что <svg> есть)
    $s2        = Parse-SvgToJs $svgPath

    # 3) SVG ➜ DXF
    $s3        = Convert-JsToDxf $svgPath

    [pscustomobject]@{
        File     = $_.Name
        DXFtoSVG = $s1
        SVGtoJS  = $s2
        JStoDXF  = $s3
    } | Export-Csv -Path 'convert_pipeline_report.csv' `
                   -Append -NoTypeInformation -Encoding UTF8 -Force

    Write-Host "    DXF->SVG:$s1   SVG->JS:$s2   JS->DXF:$s3"
}
