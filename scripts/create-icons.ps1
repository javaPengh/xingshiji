$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot 'shared/icon/行食记 App Icon-selection-ios.png'
$iconDirectory = Join-Path $projectRoot 'PWA/icons'
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null
$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
    # Resize the selected artwork without redrawing it; opaque edges allow iOS
    # to apply its own icon mask. The existing flat background fills alpha.
    $background = ([System.Drawing.Bitmap]$source).GetPixel(0, [int]($source.Height / 2))
    foreach ($size in @(192, 512, 1024)) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::FromArgb(255, $background.R, $background.G, $background.B))
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($source, 0, 0, $size, $size)
            $bitmap.Save((Join-Path $iconDirectory "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
    Write-Output "Prepared app icons from selected artwork ($($source.Width)x$($source.Height))."
} finally { $source.Dispose() }
