param(
 [string]$Version='0.5.7',
 [string]$Baseline='D:\weixiagen\release\archive\WeChatAgent-0.4.3',
 [string]$ClientRoot='D:\weixiagen\data\workspace\state\hook\wechat-4.1.15.13',
 [string]$HookRoot='D:\weixiagen\data\workspace\state\hook\native-4.1.15.13',
 [string]$ReaderKeyDll='',
 [string]$VoiceComponentsZip='',
 [string]$OutputDirectory='',
 [string]$StagingDirectory=''
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version.'}
if(!$OutputDirectory){$OutputDirectory="D:\weixiagen\release\artifacts-$Version"}
if(!$StagingDirectory){$StagingDirectory="D:\weixiagen\release\WeChatGirl-$Version"}
$stage=[IO.Path]::GetFullPath($StagingDirectory).TrimEnd('\')
$baselinePath=(Resolve-Path -LiteralPath $Baseline).Path.TrimEnd('\')
$clientPath=(Resolve-Path -LiteralPath $ClientRoot).Path.TrimEnd('\')
if(!$VoiceComponentsZip){
 $voiceSpec=Get-Content -LiteralPath (Join-Path $repo 'packaging/windows/voice-components.json') -Raw|ConvertFrom-Json
 $registeredArchive=Join-Path (Split-Path -Parent $repo) ('release/artifacts-'+$voiceSpec.release.TrimStart('v')+'/'+$voiceSpec.name)
 if(Test-Path -LiteralPath $registeredArchive){$VoiceComponentsZip=$registeredArchive}
}
if($VoiceComponentsZip){
 & node (Join-Path $repo 'scripts/verify-voice-components.mjs') $VoiceComponentsZip
 if($LASTEXITCODE -ne 0){throw 'Voice component archive failed verification; no staging directory was created.'}
}
$readerKeyRelative='components/weflow-cli/resources/key/win32/x64/wx_key.dll'
if(!$ReaderKeyDll){$ReaderKeyDll=Join-Path $baselinePath ('app/resources/project/'+$readerKeyRelative)}
& node (Join-Path $repo 'scripts/runtime-components.mjs') file $ReaderKeyDll
if($LASTEXITCODE -ne 0){throw 'Reader key component missing, changed or incompatible. Supply -ReaderKeyDll from the reviewed distribution; no package was created.'}
if($stage -eq $baselinePath -or $stage.StartsWith($baselinePath+'\',[StringComparison]::OrdinalIgnoreCase) -or $baselinePath.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Staging must be separate from baseline.'}
if((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $OutputDirectory)){throw 'Use new staging and output directories.'}
if((Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw|ConvertFrom-Json).version -ne $Version){throw 'Source and requested versions differ.'}
$wechatVersion='4.1.15.13'
foreach($binary in @('Weixin.exe',"$wechatVersion/Weixin.dll")){
 $file=Join-Path $clientPath $binary
 $signature=Get-AuthenticodeSignature -LiteralPath $file
 if((Get-Item -LiteralPath $file).VersionInfo.FileVersion -ne $wechatVersion -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Tencent'){throw 'Client must be Tencent-signed WeChat 4.1.15.13 x64.'}
 $stream=[IO.File]::OpenRead($file)
 try{
  $reader=[IO.BinaryReader]::new($stream)
  $stream.Position=60
  $peOffset=$reader.ReadInt32()
  $stream.Position=$peOffset+4
  if($reader.ReadUInt16() -ne 34404){throw 'Client binary must be x64.'}
 }finally{$stream.Dispose()}
}
$hookPath=(Resolve-Path -LiteralPath $HookRoot).Path
$hookBuild=Get-Content -LiteralPath (Join-Path $hookPath 'build.json') -Raw|ConvertFrom-Json
if($hookBuild.targetVersion -ne $wechatVersion -or $hookBuild.profile -ne '4.1.15.13-media-mentions-v2' -or $hookBuild.loaderInit -ne 'worker-path-v1' -or $hookBuild.voiceProfile -ne 'recording-factory-v1' -or
 (Get-FileHash -LiteralPath (Join-Path $hookPath 'wechatagent-text-4.1.15.13.dll')).Hash.ToLowerInvariant() -ne $hookBuild.sha256 -or
 (Get-FileHash -LiteralPath (Join-Path $hookPath 'wechatagent-text-loader.exe')).Hash.ToLowerInvariant() -ne $hookBuild.loaderSha256){throw 'Hook 4.1.15.13 profile/hash mismatch.'}
function Copy-Tree([string]$Source,[string]$Destination,[string[]]$ExcludeDirs=@(),[string[]]$ExcludeFiles=@()){
 New-Item -ItemType Directory -Path $Destination -Force|Out-Null
 $copyArgs=@($Source,$Destination,'/E','/COPY:DAT','/DCOPY:DAT','/R:2','/W:2','/NFL','/NDL','/NP')
 if($ExcludeDirs.Count){$copyArgs+='/XD';$copyArgs+=$ExcludeDirs}
 if($ExcludeFiles.Count){$copyArgs+='/XF';$copyArgs+=$ExcludeFiles}
 & robocopy.exe @copyArgs|Out-Null
 if($LASTEXITCODE -gt 7){throw "Copy failed: $Source"}
}
Write-Host "Preparing isolated WeChatGirl $Version payload..."
$baselineApp=Join-Path $baselinePath 'app'
$resources=Join-Path $stage 'app/resources'
# Copy program files only, never baseline workspaces, desktop sessions or data runtimes.
Copy-Tree $baselineApp (Join-Path $stage 'app') @(
 (Join-Path $baselineApp 'resources/project'),(Join-Path $baselineApp 'resources/app'),
 (Join-Path $baselineApp 'resources/vendor/wechat'),(Join-Path $baselineApp 'resources/vendor/hook'),(Join-Path $baselineApp 'resources/vendor/hook-current')
) @('storage.ini','*.token','uninstall.exe','Uninstall WeChatGirl.exe','Uninstall WeChatAgent.exe','uninstallerIcon.ico')
$project=Join-Path $resources 'project'
New-Item -ItemType Directory -Path $project -Force|Out-Null
$pluginCatalog=Get-Content -LiteralPath (Join-Path $repo 'packages/plugin-distribution/catalog.json') -Raw|ConvertFrom-Json
$corePluginSources=@($pluginCatalog.entries|Where-Object {$_.essential}|ForEach-Object {$_.source+'/'})
$corePluginArchives=@($pluginCatalog.entries|Where-Object {$_.essential}|ForEach-Object {'optional-extensions/packages/'+$_.file;'optional-extensions/packages/'+$_.file+'.sha256'})
$sourceFiles=@(& git -C $repo -c core.quotepath=false ls-files --cached --others --exclude-standard)
if($LASTEXITCODE -ne 0){throw 'Could not enumerate source files.'}
foreach($relative in $sourceFiles){
 if($relative.StartsWith('optional-extensions/') -and $relative -ne 'optional-extensions/README.md' -and $relative -notin @('optional-extensions/group-behavior/lib/policy.mjs','optional-extensions/speech-recognition/lib/diagnostics.mjs','optional-extensions/speech-recognition/lib/recognize.mjs','optional-extensions/speech-recognition/assets/config-test.wav','optional-extensions/speech-recognition/LICENSE','optional-extensions/speech-recognition/UPSTREAM.json') -and $relative -notin $corePluginArchives){$isCorePlugin=$false;foreach($prefix in $corePluginSources){if($relative.StartsWith($prefix)){$isCorePlugin=$true;break}};if(-not $isCorePlugin){continue}}
 if($relative -match '^scripts/test-'){continue}
 if($relative -eq 'deployment.json' -or $relative -match '(^|/)(?:\.git|state|node_modules|__pycache__)(/|$)|\.tmp$|^\.github/'){continue}
 if($relative -match '^config/' -and $relative -ne 'config/wechatagent.example.json'){throw 'Private config in source set.'}
 if($relative -match '^roles/' -and $relative -ne 'roles/示例助手.md'){throw 'Private persona in source set.'}
 $source=Join-Path $repo $relative
 if(!(Test-Path -LiteralPath $source -PathType Leaf)){continue}
 $destination=Join-Path $project $relative
 New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force|Out-Null
 Copy-Item -LiteralPath $source -Destination $destination
}
Copy-Tree (Join-Path $repo 'desktop') (Join-Path $resources 'app') @('node_modules') @('*.tmp','*.log')
# Native runtime files are ignored by Git; include this independently reviewed component explicitly.
$readerKeyDestination=Join-Path $project $readerKeyRelative
New-Item -ItemType Directory -Path (Split-Path -Parent $readerKeyDestination) -Force|Out-Null
Copy-Item -LiteralPath $ReaderKeyDll -Destination $readerKeyDestination
& node (Join-Path $repo 'scripts/runtime-components.mjs') file $readerKeyDestination
if($LASTEXITCODE -ne 0){throw 'Copied reader key component failed verification.'}
# Restore only the reviewed, locked runtime dependency tree; never copy a live node_modules.
& npm ci --prefix (Join-Path $project 'packages/dsh-social-bridge-plugin') --ignore-scripts --omit=dev --omit=optional --no-audit --no-fund
if($LASTEXITCODE -ne 0){throw 'Locked bridge runtime dependencies could not be prepared.'}
# Audited QR renderer dependency; user plugins are not copied.
Copy-Tree (Join-Path $baselinePath 'app/resources/project/vendor/netease-qr') (Join-Path $project 'vendor/netease-qr')
$clientDestination=Join-Path $resources 'vendor/wechat'
New-Item -ItemType Directory -Path $clientDestination -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $clientPath 'Weixin.exe') -Destination $clientDestination
Copy-Tree (Join-Path $clientPath $wechatVersion) (Join-Path $clientDestination $wechatVersion) @('config','logs','Cache') @('*.token','*.db','*.log','*.ini','WeixinUpdate.exe','WeixinUpdate.exe.disabled')
# Never take the client root proxy DLL or its per-install authentication token.
$hookDestination=Join-Path $resources 'vendor/hook-current'
New-Item -ItemType Directory -Path $hookDestination -Force|Out-Null
foreach($file in 'wechatagent-text-4.1.15.13.dll','wechatagent-text-loader.exe','build.json'){Copy-Item -LiteralPath (Join-Path $hookPath $file) -Destination $hookDestination}
$oldExe=Join-Path $stage 'app/WeChatAgent.exe'
$newExe=Join-Path $stage 'app/WeChatGirl.exe'
if(Test-Path -LiteralPath $oldExe){Move-Item -LiteralPath $oldExe -Destination $newExe}
if(!(Test-Path -LiteralPath $newExe)){throw 'Desktop executable missing.'}
& (Join-Path $repo 'scripts/set-windows-exe-icon.ps1') -Executable $newExe -Icon (Join-Path $repo 'desktop/icon.ico')
# Voice environments are distributed as a reviewed archive, not copied from live data.
$hashes=[ordered]@{}
Get-ChildItem -LiteralPath $project -File -Recurse|Sort-Object FullName|ForEach-Object{
 $relative=$_.FullName.Substring($project.Length+1).Replace('\','/')
 $hashes[$relative]=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant()
}
$seed=($hashes.GetEnumerator()|ForEach-Object{$_.Key+':'+$_.Value}) -join [Environment]::NewLine
$sha=[Security.Cryptography.SHA256]::Create()
try{$buildId=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($seed))).Replace('-','').ToLowerInvariant()).Substring(0,16)}finally{$sha.Dispose()}
$manifest=[ordered]@{version=$Version;packageVersion=$Version;buildId=$buildId;builtAt=[DateTime]::UtcNow.ToString('o');runtimeRevision='db3bce768f85';wechatVersion=$wechatVersion;dshBundled=$false;pluginDistribution='core';essentialPlugins=@('people-memory','persona-studio');files=@($hashes.Keys);sourceHashes=$hashes}
[IO.File]::WriteAllText((Join-Path $project 'deployment.json'),($manifest|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
& (Join-Path $repo 'scripts/build-launcher.ps1') -OutputPath (Join-Path $stage 'WeChatGirl.exe')
$guide=@("WeChatGirl $Version | Windows 10/11 x64",'请先完整解压，再双击根目录 WeChatGirl.exe，无须打开命令窗口。','不要在压缩包中运行，也不要只复制一个 EXE。程序文件在 app，首次启动会在同级 data 保存配置。','DSH 需单独安装，请跟随首次配置向导完成连接。','需要本地语音时，在音乐页下载并导入语音组件 ZIP；组件不包含全部模型。','升级前保存设置并从托盘完整退出程序，保留原有 data。安装版使用 Windows 已安装的应用或 app/Uninstall WeChatGirl.exe 卸载；便携版退出后删除程序目录即可，数据需自行保留。') -join [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $stage 'README-portable.txt'),$guide,[Text.UTF8Encoding]::new($false))
& (Join-Path $repo 'scripts/build-release.ps1') -PayloadRoot $stage -OutputDirectory $OutputDirectory -Version $Version -VoiceComponentsZip $VoiceComponentsZip
Write-Host "Ready: $stage"
