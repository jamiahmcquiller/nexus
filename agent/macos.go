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
// order: a matching APFS physical store (APFSPhysicalStores), a
// matching APFS container UUID, equal size between the container and
// the physical disk's APFS partition, or (single-disk machines) the
// only physical disk present.
//
// Bug 4 (real Mac snapshot 2026-11-21): the v0.3.2 parser trusted
// fixture-only assumptions about the plist shape and the snapshot
// came back as FOUR disks (disk1/disk2/disk3/disk4) — the shape of
// the `df` fallback, meaning this function returned ZERO disks on
// the real Mac and darwinDiskInfo silently fell back to df. Three
// shape errors are fixed here, all against the documented schema
// (aws ec2-macos-utils DiskPart, which mirrors `diskutil list
// -plist`):
//
//   - Container volumes live under "APFSVolumes", not "Partitions".
//     v0.3.2 read only Partitions, so every container yielded zero
//     volumes. APFSVolume entries carry no Content key; they are
//     APFS by definition. Both keys are now read (de-duplicated).
//   - There is no "APFSContainerUUID" key on the container or its
//     physical-store partition in that schema, so UUID matching
//     could never fire. The direct link is "APFSPhysicalStores"
//     (e.g. disk3 -> disk0s2), which is now match rule (0); UUID
//     and size remain as fallbacks.
//   - "WholeDisk" is not in that schema either, so requiring it
//     skips every entry when the key is absent. An entry now counts
//     as a whole disk when WholeDisk is true, or when the key is
//     absent and the DeviceIdentifier is a bare whole-disk id
//     (disk<N>); it is skipped only when WholeDisk is explicitly
//     false or the id names a slice.
//
// If the listing contains NO physical disk at all (disk0 absent from
// the parse, as in the real snapshot), the containers have nothing
// to attach to. Returning zero disks would re-trigger the df
// fallback that manufactured the four bogus entries, so exactly one
// container is promoted instead: the booted-system container (the
// one whose volumes include the "/" mount), else the largest
// container. This runs ONLY when no physical disk was parsed, so a
// present disk0 keeps the old behaviour (the Recovery/snapshot
// container disk1 is skipped, never merged into the SSD).
// isWholeDiskDevice reports whether a DeviceIdentifier names a whole
// disk (disk<N>) rather than a slice (disk<N>s<M>, disk<N>s<M>s<P>).
func isWholeDiskDevice(id string) bool {
	rest := strings.TrimPrefix(id, "disk")
	if rest == "" || rest == id {
		return false
	}
	for _, r := range rest {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// summarizePlistEntries renders one compact "id:content:size,..."
// summary of a Partitions or APFSVolumes array, for the diagnostic
// log line in parseDiskutilList. defaultFS fills in the content for
// entries that carry no Content key (APFSVolume entries are APFS).
func summarizePlistEntries(raw []any, defaultFS string) string {
	var parts []string
	for _, r := range raw {
		m, ok := r.(map[string]any)
		if !ok {
			continue
		}
		content := plistString(m, "Content")
		if content == "" {
			content = defaultFS
		}
		if content == "" {
			content = "?"
		}
		size, _ := plistInt(m, "Size")
		parts = append(parts, fmt.Sprintf("%s:%s:%d", plistString(m, "DeviceIdentifier"), content, size))
	}
	return strings.Join(parts, ",")
}

// appendDiskVolumes appends macVolume entries from a Partitions or
// APFSVolumes array. apfsVolumes is true for APFSVolumes arrays,
// whose entries carry no Content key — every entry is an APFS volume
// (filesystem "apfs"). Entries are de-duplicated by device, so a
// container that lists its volumes under both keys is not doubled.
func appendDiskVolumes(vols []macVolume, raw []any, apfsVolumes bool) []macVolume {
	seen := map[string]bool{}
	for _, v := range vols {
		seen[v.Device] = true
	}
	for _, r := range raw {
		m, ok := r.(map[string]any)
		if !ok {
			continue
		}
		dev := plistString(m, "DeviceIdentifier")
		if dev == "" {
			continue
		}
		device := "/dev/" + dev
		if seen[device] {
			continue
		}
		seen[device] = true
		size, _ := plistInt(m, "Size")
		fs := plistString(m, "Content")
		if apfsVolumes || fs == "Apple_APFS" {
			fs = "apfs"
		}
		vols = append(vols, macVolume{
			Device:     device,
			Name:       plistString(m, "VolumeName"),
			Mount:      plistString(m, "MountPoint"),
			Filesystem: fs,
			TotalGB:    size / bytesPerGB,
			FreeGB:     -1,
		})
	}
	return vols
}

func parseDiskutilList(data []byte) ([]macDisk, error) {
	m, err := parsePlistXML(data)
	if err != nil {
		return nil, err
	}
	type containerInfo struct {
		device   string // e.g. /dev/disk3
		name     string
		content  string
		volumes  []macVolume
		uuid     string
		size     int64
		stores   []string // APFSPhysicalStores, e.g. ["disk0s2"]
		attached bool
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
		uuid := plistString(dm, "APFSContainerUUID")
		if uuid == "" {
			uuid = plistString(dm, "ContainerUUID")
		}
		var stores []string
		for _, sraw := range plistArray(dm, "APFSPhysicalStores") {
			if sm, ok := sraw.(map[string]any); ok {
				if s := plistString(sm, "APFSPhysicalStore"); s != "" {
					stores = append(stores, s)
				}
			}
		}
		// Diagnostic: one concise line per raw diskutil entry, BEFORE
		// any de-dup or classification, so the next run on the real
		// Mac shows exactly what diskutil returned (in particular
		// whether disk0 is present, which keys each entry carries,
		// and where each container's volumes live).
		log.Printf("diskutil: raw disk device=/dev/%s content=%s wholeDisk=%v virtual=%v virtualOrPhysical=%s size=%d containerUUID=%s physicalStores=[%s] partitions=[%s] apfsVolumes=[%s]",
			devID, content, plistBool(dm, "WholeDisk"), plistBool(dm, "Virtual"), plistString(dm, "VirtualOrPhysical"), size, uuid, strings.Join(stores, ","),
			summarizePlistEntries(plistArray(dm, "Partitions"), ""), summarizePlistEntries(plistArray(dm, "APFSVolumes"), "apfs"))
		// WholeDisk is not a guaranteed key in `diskutil list -plist`
		// output, so an absent key must not skip the entry: entries
		// in AllDisksAndPartitions are whole disks by construction.
		// Skip only when WholeDisk is explicitly false, or the key
		// is absent and the id names a slice rather than a disk.
		_, hasWholeDisk := dm["WholeDisk"]
		if !plistBool(dm, "WholeDisk") && (hasWholeDisk || !isWholeDiskDevice(devID)) {
			continue
		}
		if plistBool(dm, "Virtual") || plistString(dm, "VirtualOrPhysical") == "Virtual" || content == "Apple_DiskImage" {
			continue // disk image / virtual disk, not a physical disk
		}
		// Container volumes live under APFSVolumes on real output
		// (Bug 4); Partitions is read too for older shapes. Either
		// key alone suffices; both together are de-duplicated.
		var vols []macVolume
		vols = appendDiskVolumes(vols, plistArray(dm, "Partitions"), false)
		vols = appendDiskVolumes(vols, plistArray(dm, "APFSVolumes"), true)
		if content == "Apple_APFS" {
			// Synthesized APFS container disk (e.g. /dev/disk3): its
			// volumes are the real volumes of the physical disk.
			containers = append(containers, containerInfo{device: "/dev/" + devID, name: plistString(dm, "MediaName"), content: content, volumes: vols, uuid: uuid, size: size, stores: stores})
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
	// Match order: (0) APFS physical store — the container's
	// APFSPhysicalStores name the physical partition that hosts it
	// (disk3 -> disk0s2), the direct link; (1) APFS container UUID;
	// (2) equal size between the container and the physical disk's
	// APFS partition; (3) exactly one container and exactly one
	// physical disk in the whole listing. Rule (3) is deliberately
	// narrow: Apple Silicon Macs also expose a second synthesized
	// disk (disk1, the booted system snapshot / Recovery container)
	// that must NOT be merged into the SSD's volumes, so an
	// unmatched container is skipped rather than attached
	// speculatively — unless no physical disk exists at all (below).
	for ci := range containers {
		c := &containers[ci]
		for i := range physical {
			for _, store := range c.stores {
				if darwinPhysicalDisk("/dev/"+store) == physical[i].disk.Device {
					physical[i].disk.Volumes = append(physical[i].disk.Volumes, c.volumes...)
					c.attached = true
					break
				}
			}
			if c.attached {
				break
			}
		}
		if !c.attached {
			for i := range physical {
				if c.uuid != "" && physical[i].containerUUID != "" && c.uuid == physical[i].containerUUID {
					physical[i].disk.Volumes = append(physical[i].disk.Volumes, c.volumes...)
					c.attached = true
					break
				}
			}
		}
		if !c.attached {
			for i := range physical {
				if c.size > 0 && physical[i].containerSize != 0 && physical[i].containerSize == c.size {
					physical[i].disk.Volumes = append(physical[i].disk.Volumes, c.volumes...)
					c.attached = true
					break
				}
			}
		}
		if !c.attached && len(containers) == 1 && len(physical) == 1 {
			physical[0].disk.Volumes = append(physical[0].disk.Volumes, c.volumes...)
			c.attached = true
		}
		// An unmatched container is logged as skipped AFTER the
		// promotion decision below, so a promoted container is not
		// first reported as skipped.
	}

	// No physical disk at all in the listing (the real Mac's
	// 2026-11-21 snapshot: disk0 absent, only the synthesized
	// containers and disk images present). Returning zero disks here
	// makes darwinDiskInfo fall back to `df`, which cannot tell a
	// container from a disk image and reports one "disk" per df
	// device (disk1/disk2/disk3/disk4) — the Bug 4 symptom. Promote
	// exactly one container instead: the booted-system container
	// (the one whose volumes include the "/" mount), else the
	// largest container. The Recovery/snapshot container is never
	// promoted by the "/" rule (it has no "/" mount) and loses the
	// size rule to the main container by an order of magnitude;
	// disk images were excluded before containers were collected.
	// This runs ONLY when no physical disk was parsed, so a present
	// disk0 keeps the behaviour above (snapshot container skipped).
	if len(physical) == 0 {
		best := -1
		for i := range containers {
			if containers[i].attached {
				continue
			}
			for _, v := range containers[i].volumes {
				if v.Mount == "/" {
					best = i
					break
				}
			}
			if best != -1 {
				break
			}
		}
		if best == -1 {
			for i := range containers {
				if containers[i].attached {
					continue
				}
				if best == -1 || containers[i].size > containers[best].size {
					best = i
				}
			}
		}
		if best != -1 {
			c := containers[best]
			log.Printf("diskutil: no physical disk in listing; promoting APFS container %s as the disk (%d volumes)", c.device, len(c.volumes))
			physical = append(physical, physInfo{disk: macDisk{
				Device:     c.device,
				Name:       c.name,
				TotalGB:    c.size / bytesPerGB,
				FreeGB:     -1,
				Filesystem: c.content,
				Volumes:    c.volumes,
			}})
			containers[best].attached = true
		}
	}

	// Any container still unmatched now is genuinely skipped — never
	// a second disk, never volumes duplicated onto the SSD (e.g. the
	// snapshot/Recovery container disk1 on Apple Silicon).
	for i := range containers {
		if !containers[i].attached {
			log.Printf("diskutil: APFS container %s with no matching physical disk skipped (not a physical disk)", containers[i].device)
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
		// disk — the diskutil path above is the accurate one. This
		// fallback is also what manufactured the Bug 4 symptom (four
		// "disks" for one SSD) when diskutil parsed zero disks, so
		// it is logged and recorded — never silent.
		log.Printf("diskutil: no physical disks parsed, falling back to df -k (df cannot distinguish disk images from real disks)")
		*errors = append(*errors, "disks: diskutil returned no physical disks; fell back to df -k (disk images may appear as disks)")
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
