param(
  [string]$ExecutablePath = "${env:ProgramFiles(x86)}\3CXPhone\3CXPhone.exe"
)

$resolvedPath = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
$productName = (Get-Item -LiteralPath $resolvedPath).VersionInfo.ProductName
if ($productName -ne '3CXPhone') {
  throw "The executable is not 3CXPhone: $resolvedPath"
}

$protocolKey = 'HKCU:\Software\Classes\dial'
$commandKey = Join-Path $protocolKey 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $protocolKey -Value 'URL:3CXPhone dial protocol'
New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
Set-Item -Path $commandKey -Value "`"$resolvedPath`" %1"

$sipProtocolKey = 'HKCU:\Software\Classes\sip'
$sipCommandKey = Join-Path $sipProtocolKey 'shell\open\command'
if (Test-Path $sipCommandKey) {
  $sipProtocol = (Get-Item -LiteralPath $sipProtocolKey).GetValue('')
  $sipCommand = (Get-Item -LiteralPath $sipCommandKey).GetValue('')
  if (
    $sipProtocol -eq 'URL:3CXPhone sip protocol' -and
    $sipCommand -eq "`"$resolvedPath`" `"%1`""
  ) {
    Remove-Item -LiteralPath $sipProtocolKey -Recurse -Force
  }
}

Write-Output 'Registered the dial: URI scheme for the current Windows user.'
