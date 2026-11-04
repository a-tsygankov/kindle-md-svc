# Windows bootstrap needs canonical-path checks before Node exists on a new host.
# Opening a directory handle follows junctions/cloud roots without reading files.
function Get-CanonicalDirectory {
    param([string]$Path)
    if (-not ('KindleHostPaths' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class KindleHostPaths {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    public static string Resolve(string path) {
        using (var handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var buffer = new StringBuilder(32768);
            uint size = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
            if (size == 0 || size >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
            string result = buffer.ToString();
            if (result.StartsWith(@"\\?\UNC\")) return @"\\" + result.Substring(8);
            return result.StartsWith(@"\\?\") ? result.Substring(4) : result;
        }
    }
}
'@
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "Source directory must exist: $Path" }
    return [KindleHostPaths]::Resolve([IO.Path]::GetFullPath($Path))
}

function Assert-BootstrapSourceSafety {
    param([string]$Repo, [string]$SourceOverride, [bool]$HasSourceOverride)
    $configFile = Join-Path $Repo 'config.local.json'
    $source = ''
    if (Test-Path -LiteralPath $configFile) {
        $settings = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        if ($settings.schemaVersion -ne 1) { throw 'Unsupported configuration schemaVersion; preserve and migrate it explicitly.' }
        if ($null -ne $settings.sourceDir -and $settings.sourceDir -isnot [string]) { throw 'sourceDir must be a string.' }
        $source = [string]$settings.sourceDir
    }
    if ($HasSourceOverride) { $source = $SourceOverride }
    if (-not $source) { return }
    if (-not [IO.Path]::IsPathRooted($source)) { $source = Join-Path $Repo $source }
    $canonicalSource = (Get-CanonicalDirectory -Path $source).TrimEnd('\')
    $canonicalRepo = Get-CanonicalDirectory -Path $Repo
    foreach ($name in @('.tools', 'node_modules', '.state', 'output', 'dist')) {
        $target = Join-Path $canonicalRepo $name
        if (Test-Path -LiteralPath $target) { $target = Get-CanonicalDirectory -Path $target }
        $target = $target.TrimEnd('\')
        if ($target.Equals($canonicalSource, [StringComparison]::OrdinalIgnoreCase) -or
            $target.StartsWith($canonicalSource + '\', [StringComparison]::OrdinalIgnoreCase) -or
            $canonicalSource.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Configured source overlaps managed setup target $name. Nothing was installed."
        }
    }
}
