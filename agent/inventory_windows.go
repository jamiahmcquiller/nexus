//go:build windows

package main

import (
	"encoding/json"
	"strings"
	"time"
)

func platformID() (string, error) {
	out := run(10*time.Second, "reg", "query", `HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid")
	for _, line := range strings.Split(out, "\n") {
		if f := strings.Fields(line); len(f) >= 3 && f[0] == "MachineGuid" {
			return f[len(f)-1], nil
		}
	}
	return "", nil
}

// One PowerShell pass collects everything as JSON. Each section is wrapped so one failure
// (for example BitLocker status without admin rights) does not lose the rest.
const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$r = @{}
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$r.manufacturer = $cs.Manufacturer; $r.model = $cs.Model; $r.user = $cs.UserName
$r.ram = [int64]$cs.TotalPhysicalMemory
$r.serial = (Get-CimInstance Win32_BIOS).SerialNumber
$r.cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$r.os_name = $os.Caption; $r.os_build = $os.BuildNumber
$r.os_display = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion
$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
$r.disk_total = [int64]$d.Size; $r.disk_free = [int64]$d.FreeSpace
try { $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop; $r.bitlocker = ($bl.ProtectionStatus -eq 'On') } catch {
  $m = (manage-bde -status $env:SystemDrive) -join ' '; if ($m -match 'Protection On') { $r.bitlocker = $true } elseif ($m -match 'Protection Off') { $r.bitlocker = $false } }
$fw = Get-NetFirewallProfile; if ($fw) { $r.firewall = -not ($fw | Where-Object { -not $_.Enabled }) }
$mp = Get-MpComputerStatus; if ($mp) { $r.defender = [bool]($mp.AntivirusEnabled -and $mp.RealTimeProtectionEnabled) }
$av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object -First 1
if ($av) { $r.av_name = $av.displayName }
$keys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$r.software = @(Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } |
  Select-Object @{n='name';e={$_.DisplayName}}, @{n='publisher';e={$_.Publisher}}, @{n='version';e={$_.DisplayVersion}} | Sort-Object name -Unique)
$r | ConvertTo-Json -Depth 4 -Compress
`

func collectPlatform(inv *Inventory) {
	raw := run(120*time.Second, "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript)
	var r struct {
		Manufacturer, Model, User, Serial, CPU string
		OSName                                 string `json:"os_name"`
		OSBuild                                string `json:"os_build"`
		OSDisplay                              string `json:"os_display"`
		RAM                                    int64  `json:"ram"`
		DiskTotal                              int64  `json:"disk_total"`
		DiskFree                               int64  `json:"disk_free"`
		BitLocker                              *bool  `json:"bitlocker"`
		Firewall                               *bool  `json:"firewall"`
		Defender                               *bool  `json:"defender"`
		AVName                                 string `json:"av_name"`
		Software                               []Software
	}
	if json.Unmarshal([]byte(raw), &r) != nil {
		return
	}
	inv.Manufacturer, inv.Model, inv.Serial, inv.CPU = strings.TrimSpace(r.Manufacturer), strings.TrimSpace(r.Model), strings.TrimSpace(r.Serial), strings.TrimSpace(r.CPU)
	inv.OSName = strings.TrimPrefix(strings.TrimSpace(r.OSName), "Microsoft ")
	inv.OSVersion, inv.OSBuild = r.OSDisplay, r.OSBuild
	inv.RAMGB = bytesToGB(uint64(r.RAM))
	inv.DiskTotalGB, inv.DiskFreeGB = bytesToGB(uint64(r.DiskTotal)), bytesToGB(uint64(r.DiskFree))
	if i := strings.LastIndex(r.User, `\`); i >= 0 {
		r.User = r.User[i+1:]
	}
	inv.AssignedUser = r.User
	inv.DiskEncryption, inv.Firewall, inv.Antivirus = r.BitLocker, r.Firewall, r.Defender
	inv.EncryptionName = "BitLocker"
	inv.AntivirusName = "Microsoft Defender"
	if r.AVName != "" {
		inv.AntivirusName = r.AVName
	}
	inv.Software = r.Software
}
