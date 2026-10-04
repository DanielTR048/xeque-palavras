[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$ToolchainRoot = 'F:\Tools\codex-android',
    [string]$SigningConfig = (Join-Path $env:USERPROFILE '.codex\app-signing\xeque\signing.json'),
    [string]$OutputDirectory,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $repositoryRoot 'android'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repositoryRoot 'artifacts\android' }

$environmentNames = @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'GRADLE_USER_HOME', 'PATH',
    'XEQUE_KEYSTORE', 'XEQUE_STORE_PASSWORD', 'XEQUE_KEY_ALIAS', 'XEQUE_KEY_PASSWORD')
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Assert-ExitCode([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}

try {
    if (-not $env:JAVA_HOME) {
        $jdkRoot = Join-Path $ToolchainRoot 'jdk'
        $installedJdk = Get-ChildItem -LiteralPath $jdkRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
            Sort-Object Name -Descending | Select-Object -First 1
        if ($installedJdk) { $env:JAVA_HOME = $installedJdk.FullName }
    }
    if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
        throw 'Set JAVA_HOME to an installed JDK 17 or 21. See docs/ANDROID.md.'
    }
    if (-not $env:ANDROID_HOME) {
        $env:ANDROID_HOME = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $ToolchainRoot 'sdk' }
    }
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms\android-36\android.jar'))) {
        throw 'Android SDK platform 36 is missing. Install platforms;android-36 and build-tools;36.0.0.'
    }
    if (-not $env:GRADLE_USER_HOME -and (Test-Path -LiteralPath $ToolchainRoot)) {
        $env:GRADLE_USER_HOME = Join-Path $ToolchainRoot 'gradle-home'
    }
    $env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

    if ($Configuration -eq 'Release') {
        $signingFields = @{
            XEQUE_KEYSTORE = 'keystorePath'
            XEQUE_STORE_PASSWORD = 'storePassword'
            XEQUE_KEY_ALIAS = 'keyAlias'
            XEQUE_KEY_PASSWORD = 'keyPassword'
        }
        if (Test-Path -LiteralPath $SigningConfig) {
            $privateConfig = Get-Content -LiteralPath $SigningConfig -Raw | ConvertFrom-Json
            foreach ($entry in $signingFields.GetEnumerator()) {
                if (-not [Environment]::GetEnvironmentVariable($entry.Key, 'Process')) {
                    [Environment]::SetEnvironmentVariable($entry.Key, [string]$privateConfig.($entry.Value), 'Process')
                }
            }
            $privateConfig = $null
        }
        foreach ($name in $signingFields.Keys) {
            if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
                throw "Release signing requires $name. Provide signing environment variables or an external signing.json; never commit credentials."
            }
        }
        if (-not (Test-Path -LiteralPath $env:XEQUE_KEYSTORE)) { throw 'The configured release keystore does not exist.' }
    }

    Push-Location $repositoryRoot
    try {
        & node (Join-Path $PSScriptRoot 'prepare-android-assets.mjs')
        Assert-ExitCode 'Android asset preparation'
    } finally { Pop-Location }

    # Use the checksum-verified local distribution when available, otherwise the pinned wrapper.
    $localGradle = Join-Path $ToolchainRoot 'gradle-8.13\bin\gradle.bat'
    $gradle = if (Test-Path -LiteralPath $localGradle) { $localGradle } else { Join-Path $androidRoot 'gradlew.bat' }
    if (-not (Test-Path -LiteralPath $gradle)) { throw 'Gradle 8.13 or the project Gradle wrapper is required.' }
    $tasks = @()
    if (-not $SkipTests) { $tasks += ":app:test${Configuration}UnitTest"; $tasks += ":app:lint${Configuration}" }
    $tasks += ":app:assemble${Configuration}"
    & $gradle -p $androidRoot @tasks --no-daemon --console=plain
    Assert-ExitCode 'Native Android build'

    $variant = $Configuration.ToLowerInvariant()
    $apk = Join-Path $androidRoot "app\build\outputs\apk\$variant\app-$variant.apk"
    if (-not (Test-Path -LiteralPath $apk)) { throw "Expected signed APK was not produced: $apk" }
    $buildTools = Join-Path $env:ANDROID_HOME 'build-tools\36.0.0'
    $apksigner = Join-Path $buildTools 'apksigner.bat'
    $aapt = Join-Path $buildTools 'aapt.exe'
    if (-not (Test-Path -LiteralPath $apksigner) -or -not (Test-Path -LiteralPath $aapt)) {
        throw 'Android build-tools 36.0.0 are required for APK signature and permission verification.'
    }
    & $apksigner verify --verbose --print-certs $apk
    Assert-ExitCode 'APK signature verification'
    $permissions = (& $aapt dump permissions $apk 2>&1) -join "`n"
    Assert-ExitCode 'APK permission inspection'
    if ($permissions -notmatch 'android\.permission\.INTERNET') {
        throw 'Profile synchronization requires the Android Internet permission.'
    }
    $badging = (& $aapt dump badging $apk 2>&1) -join "`n"
    Assert-ExitCode 'APK metadata inspection'
    if ($badging -notmatch "versionName='([^']+)'") { throw 'Could not read APK versionName.' }
    $versionName = $Matches[1]

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($apk)
    try {
        foreach ($language in @('pt', 'en')) {
            $entry = $archive.GetEntry("assets/dictionaries/$language.json")
            if (-not $entry) { throw "APK is missing the offline $language dictionary." }
            $reader = [System.IO.StreamReader]::new($entry.Open())
            try { $dictionary = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
            if ($dictionary.words.Count -lt 10000) { throw "APK dictionary $language contains fewer than 10,000 words." }
            Write-Output "Offline dictionary ${language}: $($dictionary.words.Count) words."
        }
        if (-not $archive.GetEntry('assets/dictionaries/common.json')) { throw 'APK is missing common-answer pools.' }
        foreach ($language in @('pt', 'en')) {
            if (-not $archive.GetEntry("assets/licenses/LICENSE-$language.txt")) { throw "APK is missing the $language dictionary license." }
        }
    } finally { $archive.Dispose() }

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $suffix = if ($Configuration -eq 'Debug') { '-debug' } else { '' }
    $outputApk = Join-Path $OutputDirectory "xeque-$versionName-native$suffix.apk"
    Copy-Item -LiteralPath $apk -Destination $outputApk -Force
    $hash = (Get-FileHash -LiteralPath $outputApk -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path -Leaf $outputApk)" | Set-Content -LiteralPath "$outputApk.sha256" -Encoding ascii
    Write-Output 'Verified signed native APK includes offline dictionaries and optional profile synchronization.'
    Write-Output "APK: $outputApk"
    Write-Output "SHA-256: $hash"
} finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
}
