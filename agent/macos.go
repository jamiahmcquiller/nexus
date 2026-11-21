// macOS inventory collectors — agent v0.3.2.
//
// v0.3.1 had three gaps on the Mac, all fixed here:
//
//  1. OS version was blank ("macOS <nil>"): osInfo ran `sw_vers` and
//     then replaced ": " with "=" to feed parseKVList — but sw_vers
//     separates key and value with a colon + TAB ("ProductName:\t\tmacOS"),
//     so no key was ever parsed and productversion stayed nil.
//     parseSwVers below splits on ":" and trims, and SystemVersion.plist
//     is the fallback when sw_vers fails.
//  2. Every app reported vendor "Apple" with a blank version: the agent
//     only listed directory names under /Applications. It now reads each
//     bundle's Info.plist for the real name, version and bundle
//     identifier, and derives the vendor from the bundle identifier /
//     code-signing authority — never hardcoded "Apple", never defaulted
//     to Apple (see vendorForBundleID).
//  3. One SSD reported as 13 disks: the agent listed every `df` mount,
//     including APFS volumes on the same physical disk and virtual
//     filesystems (devfs, map, ...). It now parses `diskutil list -plist`
//     and reports each physical disk ONCE, with its APFS volumes listed
//     under it; `df` is only a fallback, de-duplicated by physical disk.
//
// Everything that parses external output is a pure function over the
// raw bytes (parseSwVers, parseSystemVersionPlist, parseAppInfoPlist,
// parseDiskutilList, parseDFDarwin) so it is unit-tested with fixtures
// on any platform. The functions that run commands or touch the
// filesystem are thin wrappers around those parsers.
package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ------------------------------------------------------------ plist files

// readPlistFile reads an Apple plist file (XML or binary). Binary
// plists are converted with `plutil` on macOS; on other platforms a
// binary plist is an error (the XML parse fails and there is no plutil).
func readPlistFile(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if m, err := parsePlistXML(data); err == nil {
		return m, nil
	}
	if runtime.GOOS != "darwin" {
		return nil, fmt.Errorf("%s: not an XML plist and plutil is unavailable on %s", path, runtime.GOOS)
	}
	out, err := runCmd(10*time.Second, "plutil", "-convert", "xml1", "-o", "-", path)
	if err != nil {
		return nil, fmt.Errorf("%s: plist parse failed and plutil conversion failed: %v", path, err)
	}
	return parsePlistXML([]byte(out))
}

// ---------------------------------------------------------- OS version

// parseSwVers parses `sw_vers` output:
//
//	ProductName:		macOS
//	ProductVersion:		26.1
//	BuildVersion:		25B78
//
// Note the colon + TAB separator — v0.3.1 replaced ": " (colon + space)
// with "=", which matched nothing and left every field empty.
func parseSwVers(out string) (name, version, build string) {
	kv := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		kv[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
	}
	return kv["ProductName"], kv["ProductVersion"], kv["BuildVersion"]
}

// parseSystemVersionPlist parses /System/Library/CoreServices/
// SystemVersion.plist (ProductName / ProductVersion / BuildVersion).
func parseSystemVersionPlist(data []byte) (name, version, build string, err error) {
	m, err := parsePlistXML(data)
	if err != nil {
		return "", "", "", err
	}
	return plistString(m, "ProductName"), plistString(m, "ProductVersion"), plistString(m, "BuildVersion"), nil
}

// darwinOSInfo returns the OS map for macOS: name "macOS", version
// e.g. "26.1", build e.g. "25B78". sw_vers first, SystemVersion.plist
// as fallback; the name defaults to "macOS" so it is never "<nil>".
func darwinOSInfo() map[string]any {
	info := map[string]any{"platform": "darwin", "arch": runtime.GOARCH}
	name, version, build := "", "", ""
	if out, err := runCmd(10*time.Second, "sw_vers"); err == nil && out != "" {
		name, version, build = parseSwVers(out)
	}
	if version == "" {
		if data, err := os.ReadFile("/System/Library/CoreServices/SystemVersion.plist"); err == nil {
			if n, v, b, perr := parseSystemVersionPlist(data); perr == nil {
				name, version, build = n, v, b
			}
		}
	}
	if name == "" {
		name = "macOS"
	}
	info["name"] = name
	if version != "" {
		info["version"] = version
	}
	if build != "" {
		info["build"] = build
	}
	return info
}

// ---------------------------------------------------------- app bundles

// macAppSearchRoots lists the locations scanned for .app bundles, in
// precedence order (first location wins when the same bundle identifier
// appears twice). /Applications is the system-wide location;
// /System/Applications holds the macOS bundled apps (Safari, Mail,
// GarageBand, ...) that v0.3.1 never scanned; ~/Applications (added in
// darwinSoftwareList) holds per-user installs. One level of
// subdirectories (e.g. /Applications/Utilities) is also scanned.
var macAppSearchRoots = []string{"/Applications", "/System/Applications"}

// parseAppInfoPlist extracts the real display name, version and bundle
// identifier from an .app bundle's Info.plist. Name prefers
// CFBundleDisplayName over CFBundleName; version prefers
// CFBundleShortVersionString over CFBundleVersion. Empty strings mean
// the bundle does not declare that field.
func parseAppInfoPlist(data []byte) (name, version, bundleID string, err error) {
	m, err := parsePlistXML(data)
	if err != nil {
		return "", "", "", err
	}
	name = plistString(m, "CFBundleDisplayName")
	if name == "" {
		name = plistString(m, "CFBundleName")
	}
	version = plistString(m, "CFBundleShortVersionString")
	if version == "" {
		version = plistString(m, "CFBundleVersion")
	}
	return name, version, plistString(m, "CFBundleIdentifier"), nil
}

// wellKnownVendors maps bundle-ID prefixes to the publisher — ONLY
// where the publisher is unambiguous. com.apple.* is Apple by
// definition. Everything else must be genuinely known: an unknown
// bundle ID is "Unknown", never guessed and never Apple. The rule is
// deliberately conservative — a wrong vendor is worse than "Unknown",
// and the bundle identifier is always included in the entry so the
// real publisher can be identified from it.
var wellKnownVendors = []struct{ prefix, vendor string }{
	{"com.apple.", "Apple"},
	{"com.microsoft.", "Microsoft"},
	{"com.valvesoftware.", "Valve"},
	{"com.anthropic.", "Anthropic"},
	{"com.hnc.", "Discord Inc."}, // Discord's bundle id is com.hnc.Discord
	{"com.bambulab.", "Bambu Lab"},
	{"com.amazon.", "Amazon"},
}

// vendorForBundleID derives the vendor from a bundle identifier using
// the well-known mapping above. Returns "Unknown" when the identifier
// is empty or matches nothing known.
func vendorForBundleID(bundleID string) string {
	for _, w := range wellKnownVendors {
		if strings.HasPrefix(bundleID, w.prefix) {
			return w.vendor
		}
	}
	return "Unknown"
}

// parseCodesignVendor extracts the developer name from `codesign -dv`
// stderr. The first Authority line carries it:
//
//	Authority=Developer ID Application: Valve Corporation (MXK7H9QR3X)
//	Authority=Apple Mac OS Application Signing
//
// Returns "" when no usable authority is present.
func parseCodesignVendor(stderr string) string {
	appleSigned := false
	for _, line := range strings.Split(stderr, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Authority=") {
			continue
		}
		auth := strings.TrimPrefix(line, "Authority=")
		if strings.HasPrefix(auth, "Developer ID Application: ") {
			name := strings.TrimPrefix(auth, "Developer ID Application: ")
			if i := strings.LastIndex(name, " ("); i > 0 {
				name = name[:i]
			}
			return strings.TrimSpace(name)
		}
		if auth == "Apple Mac OS Application Signing" {
			appleSigned = true
		}
	}
	if appleSigned {
		return "Apple"
	}
	return ""
}

// codesignVendor runs `codesign -dv` on one bundle and returns the
// developer name, or "" when codesign fails or reports nothing usable.
// codesign writes its report to stderr, hence runCmdOut.
func codesignVendor(appPath string) string {
	_, stderr, err := runCmdOut(10*time.Second, "codesign", "-dv", "--verbose=4", appPath)
	if err != nil {
		return ""
	}
	return parseCodesignVendor(stderr)
}

// readAppBundle reads one .app bundle directory and returns its
// name/version/vendor/bundleID. A bundle whose Info.plist cannot be
// read still returns an entry (name from the directory name, version
// "", vendor "Unknown") plus an error so the failure is logged, never
// silently dropped.
func readAppBundle(appPath string) (entry map[string]any, err error) {
	dirName := strings.TrimSuffix(filepath.Base(appPath), ".app")
	plistPath := filepath.Join(appPath, "Contents", "Info.plist")
	m, perr := readPlistFile(plistPath)
	if perr != nil {
		return map[string]any{"name": dirName, "version": "", "vendor": "Unknown", "bundle_id": ""},
			fmt.Errorf("%s: Info.plist unreadable: %v", appPath, perr)
	}
	name := plistString(m, "CFBundleDisplayName")
	if name == "" {
		name = plistString(m, "CFBundleName")
	}
	if name == "" {
		name = dirName
	}
	version := plistString(m, "CFBundleShortVersionString")
	if version == "" {
		version = plistString(m, "CFBundleVersion")
	}
	bundleID := plistString(m, "CFBundleIdentifier")
	vendor := vendorForBundleID(bundleID)
	if vendor == "Unknown" && bundleID != "" {
		// Last resort for an unmapped bundle id: the code-signing
		// authority names the real developer (e.g. Sideloadly).
		if v := codesignVendor(appPath); v != "" {
			vendor = v
		}
	}
	return map[string]any{"name": name, "version": version, "vendor": vendor, "bundle_id": bundleID}, nil
}

// darwinSoftwareList scans the macOS application locations and returns
// one entry per installed .app bundle (plus Homebrew formulae, as
// before). Bundles are de-duplicated by bundle identifier — first
// location wins. Nothing is silently skipped: an unreadable search
// root or an unreadable bundle is appended to errors and logged by the
// caller, and the bundle still appears with its best-effort metadata.
// roots overrides the search locations (used by tests to point at
// fixture directories); with no roots the standard locations are used.
func darwinSoftwareList(errors *[]string, roots ...string) []map[string]any {
	var apps []map[string]any
	seenBundle := map[string]bool{}
	seenName := map[string]bool{}
	add := func(entry map[string]any) {
		name := fmt.Sprint(entry["name"])
		if name == "" || name == "Name" {
			return
		}
		if bundleID := fmt.Sprint(entry["bundle_id"]); bundleID != "" {
			if seenBundle[bundleID] {
				return
			}
			seenBundle[bundleID] = true
		} else if seenName[name] {
			return
		}
		seenName[name] = true
		apps = append(apps, entry)
	}

	if len(roots) == 0 {
		roots = append([]string{}, macAppSearchRoots...)
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			roots = append(roots, filepath.Join(home, "Applications"))
		}
	}
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			*errors = append(*errors, "software ("+root+"): "+err.Error())
			continue
		}
		// scanAppDir processes .app entries in one directory.
		scanDir := func(dir string, ents []os.DirEntry) {
			for _, e := range ents {
				if !strings.HasSuffix(e.Name(), ".app") {
					continue
				}
				entry, err := readAppBundle(filepath.Join(dir, e.Name()))
				if err != nil {
					*errors = append(*errors, "software: "+err.Error())
				}
				add(entry)
			}
		}
		scanDir(root, entries)
		// One level of subdirectories (e.g. /Applications/Utilities):
		// real apps live there, but never recurse into a bundle itself.
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".app") || !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			sub, err := os.ReadDir(filepath.Join(root, e.Name()))
			if err != nil {
				*errors = append(*errors, "software ("+filepath.Join(root, e.Name())+"): "+err.Error())
				continue
			}
			scanDir(filepath.Join(root, e.Name()), sub)
		}
	}
	if out, err := runCmd(15*time.Second, "brew", "list", "--versions"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				add(map[string]any{"name": f[0], "version": f[1], "vendor": "Homebrew", "bundle_id": ""})
			}
		}
	}
	sort.Slice(apps, func(i, j int) bool { return fmt.Sprint(apps[i]["name"]) < fmt.Sprint(apps[j]["name"]) })
	if len(apps) > 500 {
		apps = apps[:500]
	}
	return apps
}

// -------------------------------------------------------------- disks

const bytesPerGB = 1024 * 1024 * 1024

// macVolume is one mounted (or unmounted) volume on a physical disk.
type macVolume struct {
	Device     string
	Name       string
	Mount      string
	Filesystem string
	TotalGB    int64
	FreeGB     int64 // -1 when unknown
}

// macDisk is one physical disk, with its volumes listed under it.
type macDisk struct {
	Device     string
	Name       string
	TotalGB    int64
	FreeGB     int64 // -1 when unknown
	Filesystem string
	Volumes    []macVolume
}

func (d macDisk) toMap() map[string]any {
	m := map[string]any{"device": d.Device, "total_gb": d.TotalGB, "filesystem": d.Filesystem}
	if d.Name != "" {
		m["name"] = d.Name
	}
	if d.FreeGB >= 0 {
		m["free_gb"] = d.FreeGB
	}
	var vols []map[string]any
	for _, v := range d.Volumes {
		vm := map[string]any{"device": v.Device, "total_gb": v.TotalGB, "filesystem": v.Filesystem}
		if v.Name != "" {
			vm["name"] = v.Name
		}
		if v.Mount != "" {
			vm["mount"] = v.Mount
		}
		if v.FreeGB >= 0 {
			vm["free_gb"] = v.FreeGB
		}
		vols = append(vols, vm)
	}
	if len(vols) > 0 {
		m["volumes"] = vols
	}
	return m
}

// parseDiskutilList parses `diskutil list -plist` output and returns
// one entry per PHYSICAL disk. Synthesized APFS containers (Content
// "Apple_APFS") are not disks — their volumes belong to the physical
// disk that hosts the container — and disk images / virtual disks are
// excluded. Association of a container to its physical disk uses, in
// order: a matching APFS container UUID, equal size between the
// container and the physical disk's APFS partition, or (single-disk
// machines) the only physical disk present.
func parseDiskutilList(data []byte) ([]macDisk, error) {
	m, err := parsePlistXML(data)
	if err != nil {
		return nil, err
	}
	type containerInfo struct {
		volumes []macVolume
		uuid    string
		size    int64
	}
	type physInfo struct {
		disk          macDisk
		containerUUID string
		containerSize int64
	}
	var physical []physInfo
	var containers []containerInfo

	for _, raw := range plistArray(m, "AllDisksAndPartitions") {
		dm, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		devID := plistString(dm, "DeviceIdentifier")
		if devID == "" {
			continue
		}
		size, _ := plistInt(dm, "Size")
		content := plistString(dm, "Content")
		if !plistBool(dm, "WholeDisk") {
			continue
		}
		if plistBool(dm, "Virtual") || content == "Apple_DiskImage" {
			continue // disk image / virtual disk, not a physical disk
		}
		var vols []macVolume
		for _, praw := range plistArray(dm, "Partitions") {
			pm, ok := praw.(map[string]any)
			if !ok {
				continue
			}
			psize, _ := plistInt(pm, "Size")
			pcontent := plistString(pm, "Content")
			fs := pcontent
			if pcontent == "Apple_APFS" {
				fs = "apfs"
			}
			vols = append(vols, macVolume{
				Device:     "/dev/" + plistString(pm, "DeviceIdentifier"),
				Name:       plistString(pm, "VolumeName"),
				Mount:      plistString(pm, "MountPoint"),
				Filesystem: fs,
				TotalGB:    psize / bytesPerGB,
				FreeGB:     -1,
			})
		}
		if content == "Apple_APFS" {
			// Synthesized APFS container disk (e.g. /dev/disk3): its
			// partitions are the real volumes of the physical disk.
			uuid := plistString(dm, "APFSContainerUUID")
			if uuid == "" {
				uuid = plistString(dm, "ContainerUUID")
			}
			containers = append(containers, containerInfo{volumes: vols, uuid: uuid, size: size})
			continue
		}
		// Physical disk. Remember its APFS partition's UUID/size so
		// the container can be matched to it below.
		pi := physInfo{
			disk: macDisk{
				Device:     "/dev/" + devID,
				Name:       plistString(dm, "MediaName"),
				TotalGB:    size / bytesPerGB,
				FreeGB:     -1,
				Filesystem: content,
			},
		}
		for _, praw := range plistArray(dm, "Partitions") {
			pm, ok := praw.(map[string]any)
			if !ok {
				continue
			}
			if plistString(pm, "Content") == "Apple_APFS" {
				// The physical disk can carry more than one APFS
				// partition (the main container plus a small
				// Recovery container). The container partition is
				// the largest one — keep it, not the Recovery one.
				if psize, _ := plistInt(pm, "Size"); psize > pi.containerSize {
					pi.containerUUID = plistString(pm, "APFSContainerUUID")
					pi.containerSize = psize
				}
			}
		}
		physical = append(physical, pi)
	}

	// Attach each container's volumes to its physical disk.
	// Match order: (1) APFS container UUID, (2) equal size between the
	// container and the physical disk's APFS partition, (3) exactly one
	// container and exactly one physical disk in the whole listing.
	// Rule (3) is deliberately narrow: Apple Silicon Macs also expose a
	// second synthesized disk (disk1, the booted system snapshot) that
	// must NOT be merged into the SSD's volumes, so an unmatched
	// container is skipped rather than attached speculatively.
	for _, c := range containers {
		attached := false
		for i := range physical {
			if c.uuid != "" && physical[i].containerUUID != "" && c.uuid == physical[i].containerUUID {
				physical[i].disk.Volumes = append(physical[i].disk.Volumes, c.volumes...)
				attached = true
				break
			}
		}
		if !attached {
			for i := range physical {
				if c.size > 0 && physical[i].containerSize != 0 && physical[i].containerSize == c.size {
					physical[i].disk.Volumes = append(physical[i].disk.Volumes, c.volumes...)
					attached = true
					break
				}
			}
		}
		if !attached && len(containers) == 1 && len(physical) == 1 {
			physical[0].disk.Volumes = append(physical[0].disk.Volumes, c.volumes...)
			attached = true
		}
		if !attached {
			// No physical disk matched (e.g. the snapshot container
			// disk1 on Apple Silicon): skip it rather than inventing
			// a second disk or duplicating volumes onto the SSD.
			log.Printf("diskutil: APFS container with no matching physical disk skipped (not a physical disk)")
		}
	}
	out := make([]macDisk, 0, len(physical))
	for _, p := range physical {
		out = append(out, p.disk)
	}
	return out, nil
}

// parseDFDarwin parses macOS `df -k` output (Filesystem 1K-blocks
// Used Available Capacity Mounted on) into device -> (total GB, free
// GB). Only /dev/disk* devices are kept — devfs, map, autofs and other
// virtual filesystems are excluded by construction.
func parseDFDarwin(out string) map[string][2]int64 {
	df := map[string][2]int64{}
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 6 || !strings.HasPrefix(f[0], "/dev/disk") {
			continue
		}
		totalKB, err1 := strconv.ParseInt(f[1], 10, 64)
		freeKB, err2 := strconv.ParseInt(f[3], 10, 64)
		if err1 != nil || err2 != nil {
			continue
		}
		df[f[0]] = [2]int64{totalKB * 1024 / bytesPerGB, freeKB * 1024 / bytesPerGB}
	}
	return df
}

// applyDFFree fills in free/total sizes from `df` for each volume that
// is mounted, and sets each disk's free space from the volume mounted
// at "/" (falling back to its largest mounted volume).
func applyDFFree(disks []macDisk, df map[string][2]int64) {
	for i := range disks {
		for j := range disks[i].Volumes {
			if sz, ok := df[disks[i].Volumes[j].Device]; ok {
				disks[i].Volumes[j].TotalGB = sz[0]
				disks[i].Volumes[j].FreeGB = sz[1]
			}
		}
		best := int64(-1)
		for _, v := range disks[i].Volumes {
			if v.Mount == "/" && v.FreeGB >= 0 {
				best = v.FreeGB
				break
			}
			if v.FreeGB > best {
				best = v.FreeGB
			}
		}
		if best >= 0 {
			disks[i].FreeGB = best
		}
	}
}

// darwinPhysicalDisk maps a macOS device node to its physical disk:
// /dev/disk3s1 -> /dev/disk3, /dev/disk0 -> /dev/disk0.
func darwinPhysicalDisk(dev string) string {
	rest := strings.TrimPrefix(dev, "/dev/disk")
	i := 0
	for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
		i++
	}
	return "/dev/disk" + rest[:i]
}

// groupDFByDisk groups parseDFDarwin output by physical disk
// (disk3s1 -> disk3). The disk total is the physical size, not the sum
// of its volumes — APFS volumes share the container, so the largest
// volume's size is the container size and its free space is the disk's
// free space. Virtual filesystems never reach this function:
// parseDFDarwin only keeps /dev/disk* devices.
func groupDFByDisk(df map[string][2]int64) []macDisk {
	byDisk := map[string]*macDisk{}
	var order []string
	for dev, sz := range df {
		base := darwinPhysicalDisk(dev)
		d, ok := byDisk[base]
		if !ok {
			d = &macDisk{Device: base, FreeGB: -1, Filesystem: "GUID_partition_scheme"}
			byDisk[base] = d
			order = append(order, base)
		}
		d.Volumes = append(d.Volumes, macVolume{Device: dev, TotalGB: sz[0], FreeGB: sz[1], Filesystem: "apfs"})
	}
	var disks []macDisk
	for _, base := range order {
		d := byDisk[base]
		var largest int64
		for _, v := range d.Volumes {
			if v.TotalGB > largest {
				largest = v.TotalGB
				d.FreeGB = v.FreeGB
			}
		}
		d.TotalGB = largest
		disks = append(disks, *d)
	}
	sort.Slice(disks, func(i, j int) bool { return disks[i].Device < disks[j].Device })
	return disks
}

// darwinDiskInfo returns one entry per physical disk on macOS.
// Primary source is `diskutil list -plist`; if diskutil is unavailable
// it falls back to `df -k`, de-duplicated by physical disk number, so
// the old 13-entries-for-one-SSD result cannot recur.
func darwinDiskInfo(errors *[]string) []map[string]any {
	var disks []macDisk
	if out, err := runCmd(15*time.Second, "diskutil", "list", "-plist"); err == nil && out != "" {
		parsed, perr := parseDiskutilList([]byte(out))
		if perr == nil {
			disks = parsed
		} else {
			*errors = append(*errors, "disks (diskutil parse): "+perr.Error())
		}
	} else if err != nil {
		*errors = append(*errors, "disks (diskutil): "+err.Error())
	}
	if len(disks) == 0 {
		// Fallback: df, grouped by physical disk (disk3s1 -> disk3).
		// Note the fallback cannot tell a disk image from a real disk
		// from df alone, so it may still list an attached image as a
		// disk — the diskutil path above is the accurate one.
		if out, err := runCmd(10*time.Second, "df", "-k"); err == nil {
			disks = groupDFByDisk(parseDFDarwin(out))
		} else if err != nil {
			*errors = append(*errors, "disks (df): "+err.Error())
		}
	} else {
		// diskutil path: fill free space from df.
		if out, err := runCmd(10*time.Second, "df", "-k"); err == nil {
			applyDFFree(disks, parseDFDarwin(out))
		}
	}
	var out []map[string]any
	for _, d := range disks {
		out = append(out, d.toMap())
	}
	return out
}
