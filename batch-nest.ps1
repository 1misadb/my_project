# =====================================
# 📝 DXF → nested.dxf batch processing
# =====================================

# 📁 Папка с DXF
$sourceDir = "C:\Users\User\dxf-parser-app\converted"

# 📁 Папка для nested.dxf
$outputDir = Join-Path $sourceDir "nested"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
    Write-Host "📁 Created output directory: $outputDir"
}

# 🔄 Перебираем все DXF-файлы
Get-ChildItem -Path $sourceDir -Filter *.dxf | ForEach-Object {

    $file = $_.FullName
    $basename = $_.BaseName
    $outputFile = Join-Path $outputDir "$basename.nested.dxf"

    Write-Host "🔄 Processing $($_.Name)..."

    # Формируем команду curl
    $curlCmd = @(
        "curl.exe",
        "-X POST",
        "-F `"file=@$file`"",
        "http://localhost:3001/nest-dxf",
        "-o `"$outputFile`""
    ) -join " "

    Write-Host "▶ $curlCmd"

    try {
        $result = iex $curlCmd
        Write-Host "✅ Saved nested: $outputFile"
    }
    catch {
        Write-Warning "❌ Failed to nest $($_.Name): $_"
    }
}

Write-Host "🏁 Batch nesting complete."
