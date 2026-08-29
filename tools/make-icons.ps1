# Icon generator for IMG Collage Editor. ASCII only:
# Windows PowerShell 5.1 reads BOM-less files as ANSI and mangles non-ASCII,
# which silently turns the assignments that follow a comment into $null.
Add-Type -AssemblyName System.Drawing

$Out = 'C:\Users\User\suii-collage\icons'

# Relative geometry, as fractions of the icon's side. The outer square is
# centred and split into four cells of DIFFERENT sizes -- deliberately not a
# uniform grid, because this app joins photos of differing ratios.
# The top-left cell is filled solid so the mark echoes the panel tab
# sitting at the top-left of each panel in the app.
$BoxLen    = 0.540
$RadiusF   = 0.075
$StrokeF   = 0.040
$SplitVTop = 0.42
$SplitH    = 0.45
$SplitVBtm = 0.68

function New-RoundedPath([single]$x, [single]$y, [single]$len, [single]$rad) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [single]($rad * 2)
  $p.AddArc($x,             $y,             $d, $d, [single]180, [single]90)
  $p.AddArc($x + $len - $d, $y,             $d, $d, [single]270, [single]90)
  $p.AddArc($x + $len - $d, $y + $len - $d, $d, $d, [single]0,   [single]90)
  $p.AddArc($x,             $y + $len - $d, $d, $d, [single]90,  [single]90)
  $p.CloseFigure()
  return $p
}

function Write-Icon([int]$S, [string]$Name) {
  $bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  # Opaque white: iOS composites a transparent apple-touch-icon onto black.
  $g.Clear([System.Drawing.Color]::White)

  $bl  = [single]($BoxLen * $S)
  $bx  = [single](($S - $bl) / 2)
  $rad = [single]($RadiusF * $S)
  $lw  = [single]($StrokeF * $S)
  $vT  = [single]($bx + $SplitVTop * $bl)
  $vB  = [single]($bx + $SplitVBtm * $bl)
  $hY  = [single]($bx + $SplitH    * $bl)
  if ($rad -le 0 -or $bl -le 0 -or $lw -le 0) { throw "bad geometry: rad=$rad bl=$bl lw=$lw" }

  $path = New-RoundedPath $bx $bx $bl $rad
  if ($path.PointCount -lt 4) { throw "empty path for $Name" }

  # Clip so the fill cannot spill past the rounded outer corner.
  $g.SetClip($path)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
  $g.FillRectangle($brush, $bx, $bx, [single]($vT - $bx), [single]($hY - $bx))
  $brush.Dispose()
  $g.ResetClip()

  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, $lw)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Flat
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Flat
  $g.DrawPath($pen, $path)
  $g.DrawLine($pen, $vT, $bx, $vT, $hY)
  $g.DrawLine($pen, $bx, $hY, ($bx + $bl), $hY)
  $g.DrawLine($pen, $vB, $hY, $vB, ($bx + $bl))
  $pen.Dispose()

  $g.Dispose()
  $path.Dispose()
  $bmp.Save((Join-Path $Out $Name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  '{0,-24} {1}x{1}' -f $Name, $S
}

Write-Icon 180  'apple-touch-icon.png'
Write-Icon 192  'icon-192.png'
Write-Icon 512  'icon-512.png'
Write-Icon 1024 'icon-1024.png'
Write-Icon 64   'favicon.png'
