package main

// Unit tests for agent v0.3.2.
//
// The agent runs on a Linux VM here, so macOS code paths can never be
// executed directly. Everything that parses macOS output is therefore
// a pure function tested with fixtures below. The fixtures model the
// real Mac's inventory (device darwin-ac913e0958751651, snapshot
// 2026-11-21): the same 13 applications, the same disk layout (one
// 512 GB SSD reported as 13 df entries). Fixture VERSIONS are
// arbitrary values chosen to prove parsing works — they are NOT the
// real Mac's app versions, which the agent has never observed.

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ------------------------------------------------------------ plist

func TestParsePlistXML(t *testing.T) {
	data := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ProductName</key>
	<string>macOS</string>
	<key>ProductVersion</key>
	<string>26.1</string>
	<key>BuildVersion</key>
	<string>25B78</string>
	<key>Size</key>
	<integer>494000000000</integer>
	<key>Ratio</key>
	<real>1.5</real>
	<key>WholeDisk</key>
	<true/>
	<key>Internal</key>
	<false/>
	<key>Names</key>
	<array><string>a</string><string>b</string></array>
	<key>Nested</key>
	<dict><key>Inner</key><string>yes</string></dict>
</dict>
</plist>`
	m, err := parsePlistXML([]byte(data))
	if err != nil {
		t.Fatalf("parsePlistXML: %v", err)
	}
	if plistString(m, "ProductName") != "macOS" || plistString(m, "ProductVersion") != "26.1" || plistString(m, "BuildVersion") != "25B78" {
		t.Fatalf("strings wrong: %+v", m)
	}
	if n, ok := plistInt(m, "Size"); !ok || n != 494000000000 {
		t.Fatalf("Size = %d, %v", n, ok)
	}
	if !plistBool(m, "WholeDisk") || plistBool(m, "Internal") {
		t.Fatalf("bools wrong")
	}
	arr := plistArray(m, "Names")
	if len(arr) != 2 || arr[0] != "a" || arr[1] != "b" {
		t.Fatalf("array wrong: %v", arr)
	}
	nested, ok := m["Nested"].(map[string]any)
	if !ok || plistString(nested, "Inner") != "yes" {
		t.Fatalf("nested dict wrong: %v", m["Nested"])
	}
	if _, err := parsePlistXML([]byte("<plist><array/></plist>")); err == nil {
		t.Fatalf("array root should be an error")
	}
	if _, err := parsePlistXML([]byte("not xml at all")); err == nil {
		t.Fatalf("garbage should be an error")
	}
}

// ------------------------------------------------------- OS version

func TestParseSwVers(t *testing.T) {
	// Real sw_vers output separates key and value with colon + TAB.
	// v0.3.1 replaced ": " (colon + space) with "=", which matched
	// nothing — the regression this test pins.
	out := "ProductName:\t\tmacOS\nProductVersion:\t\t26.1\nBuildVersion:\t\t25B78\n"
	name, version, build := parseSwVers(out)
	if name != "macOS" || version != "26.1" || build != "25B78" {
		t.Fatalf("parseSwVers = %q %q %q", name, version, build)
	}
	// Single-tab and colon-space forms must also parse.
	name, version, build = parseSwVers("ProductName:\tmacOS\nProductVersion: 26.1\nBuildVersion: 25B78\n")
	if name != "macOS" || version != "26.1" || build != "25B78" {
		t.Fatalf("parseSwVers (alt spacing) = %q %q %q", name, version, build)
	}
	// Empty output parses to empty fields (caller falls back to plist).
	name, version, build = parseSwVers("")
	if name != "" || version != "" || build != "" {
		t.Fatalf("parseSwVers(\"\") = %q %q %q", name, version, build)
	}
}

func TestParseSystemVersionPlist(t *testing.T) {
	data := `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>ProductBuildVersion</key>
	<string>25B78</string>
	<key>ProductName</key>
	<string>macOS</string>
	<key>ProductVersion</key>
	<string>26.1</string>
	<key>BuildVersion</key>
	<string>25B78</string>
</dict>
</plist>`
	name, version, build, err := parseSystemVersionPlist([]byte(data))
	if err != nil {
		t.Fatalf("parseSystemVersionPlist: %v", err)
	}
	if name != "macOS" || version != "26.1" || build != "25B78" {
		t.Fatalf("got %q %q %q", name, version, build)
	}
}

// ------------------------------------------------------ app bundles

// fixtureInfoPlist builds a synthetic Info.plist. Versions here are
// arbitrary fixture values, NOT the real Mac's app versions.
func fixtureInfoPlist(bundleName, displayName, shortVersion, bundleVersion, bundleID string) string {
	var sb strings.Builder
	sb.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\">\n<dict>\n")
	if bundleName != "" {
		fmt.Fprintf(&sb, "\t<key>CFBundleName</key>\n\t<string>%s</string>\n", bundleName)
	}
	if displayName != "" {
		fmt.Fprintf(&sb, "\t<key>CFBundleDisplayName</key>\n\t<string>%s</string>\n", displayName)
	}
	if shortVersion != "" {
		fmt.Fprintf(&sb, "\t<key>CFBundleShortVersionString</key>\n\t<string>%s</string>\n", shortVersion)
	}
	if bundleVersion != "" {
		fmt.Fprintf(&sb, "\t<key>CFBundleVersion</key>\n\t<string>%s</string>\n", bundleVersion)
	}
	if bundleID != "" {
		fmt.Fprintf(&sb, "\t<key>CFBundleIdentifier</key>\n\t<string>%s</string>\n", bundleID)
	}
	sb.WriteString("</dict>\n</plist>\n")
	return sb.String()
}

// macApps models the real Mac's 13 applications: bundle id + fixture
// version + expected vendor. Sideloadly has no well-known vendor — on
// a real Mac codesign would supply it; on this Linux VM it is
// "Unknown" (see TestReadAppBundle).
var macApps = []struct {
	dir, display, version, bundleID, vendor string
}{
	{"BambuStudio.app", "BambuStudio", "2.1.0", "com.bambulab.bambustudio", "Bambu Lab"},
	{"Claude.app", "Claude", "1.0.0", "com.anthropic.claude", "Anthropic"},
	{"Discord.app", "Discord", "0.0.1", "com.hnc.Discord", "Discord Inc."},
	{"GarageBand.app", "GarageBand", "10.4.0", "com.apple.garageband", "Apple"},
	{"Keynote.app", "Keynote", "14.0", "com.apple.Keynote", "Apple"},
	{"Numbers.app", "Numbers", "14.0", "com.apple.Numbers", "Apple"},
	{"Pages.app", "Pages", "14.0", "com.apple.Pages", "Apple"},
	{"Prime Video.app", "Prime Video", "9.0", "com.amazon.AmazonVideo", "Amazon"},
	{"Safari.app", "Safari", "26.0", "com.apple.Safari", "Apple"},
	{"Sideloadly.app", "Sideloadly", "0.5.0", "io.sideloadly.Sideloadly", "Unknown"},
	{"Steam.app", "Steam", "3.0", "com.valvesoftware.steam", "Valve"},
	{"Visual Studio Code.app", "Visual Studio Code", "1.90.0", "com.microsoft.VSCode", "Microsoft"},
	{"iMovie.app", "iMovie", "10.4.0", "com.apple.iMovie", "Apple"},
}

func TestParseAppInfoPlist(t *testing.T) {
	// Display name wins over bundle name; short version wins over
	// bundle version; VS Code's real bundle name is "Code".
	data := fixtureInfoPlist("Code", "Visual Studio Code", "1.90.0", "19000", "com.microsoft.VSCode")
	name, version, bundleID, err := parseAppInfoPlist([]byte(data))
	if err != nil {
		t.Fatalf("parseAppInfoPlist: %v", err)
	}
	if name != "Visual Studio Code" || version != "1.90.0" || bundleID != "com.microsoft.VSCode" {
		t.Fatalf("got %q %q %q", name, version, bundleID)
	}
	// No display name / no short version: fall back.
	data = fixtureInfoPlist("Steam", "", "", "17000", "com.valvesoftware.steam")
	name, version, bundleID, err = parseAppInfoPlist([]byte(data))
	if err != nil {
		t.Fatalf("parseAppInfoPlist: %v", err)
	}
	if name != "Steam" || version != "17000" || bundleID != "com.valvesoftware.steam" {
		t.Fatalf("fallback got %q %q %q", name, version, bundleID)
	}
	if _, _, _, err := parseAppInfoPlist([]byte("garbage")); err == nil {
		t.Fatalf("garbage plist should error")
	}
}

func TestVendorForBundleID(t *testing.T) {
	cases := []struct{ id, want string }{
		{"com.apple.Safari", "Apple"},
		{"com.apple.garageband", "Apple"},
		{"com.microsoft.VSCode", "Microsoft"},
		{"com.valvesoftware.steam", "Valve"},
		{"com.anthropic.claude", "Anthropic"},
		{"com.hnc.Discord", "Discord Inc."},
		{"com.bambulab.bambustudio", "Bambu Lab"},
		{"com.amazon.AmazonVideo", "Amazon"},
		// Unknown identifiers are NEVER guessed and NEVER Apple.
		{"io.sideloadly.Sideloadly", "Unknown"},
		{"com.example.SomeApp", "Unknown"},
		{"", "Unknown"},
	}
	for _, c := range cases {
		if got := vendorForBundleID(c.id); got != c.want {
			t.Errorf("vendorForBundleID(%q) = %q, want %q", c.id, got, c.want)
		}
	}
}

func TestParseCodesignVendor(t *testing.T) {
	stderr := `Executable=/Applications/Steam.app/Contents/MacOS/steam
Identifier=com.valvesoftware.steam
Format=bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20400 size=12345 flags=0x0(none) hashes=100+7 location=embedded
Signature size=9028
Authority=Developer ID Application: Valve Corporation (MXK7H9QR3X)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=MXK7H9QR3X
`
	if got := parseCodesignVendor(stderr); got != "Valve Corporation" {
		t.Fatalf("codesign vendor = %q", got)
	}
	apple := "Authority=Apple Mac OS Application Signing\nAuthority=Apple Worldwide Developer Relations Certification Authority\n"
	if got := parseCodesignVendor(apple); got != "Apple" {
		t.Fatalf("apple codesign vendor = %q", got)
	}
	if got := parseCodesignVendor("no authorities here\n"); got != "" {
		t.Fatalf("empty codesign vendor = %q", got)
	}
}

// writeFixtureApp creates dir/Contents/Info.plist in a temp tree.
func writeFixtureApp(t *testing.T, root, dir, plist string) {
	t.Helper()
	contents := filepath.Join(root, dir, "Contents")
	if err := os.MkdirAll(contents, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", contents, err)
	}
	if err := os.WriteFile(filepath.Join(contents, "Info.plist"), []byte(plist), 0o644); err != nil {
		t.Fatalf("write Info.plist: %v", err)
	}
}

func TestReadAppBundle(t *testing.T) {
	tmp := t.TempDir()
	for _, a := range macApps {
		writeFixtureApp(t, tmp, a.dir, fixtureInfoPlist(a.dir[:len(a.dir)-4], a.display, a.version, "", a.bundleID))
		entry, err := readAppBundle(filepath.Join(tmp, a.dir))
		if err != nil {
			t.Fatalf("readAppBundle(%s): %v", a.dir, err)
		}
		if fmt.Sprint(entry["name"]) != a.display {
			t.Errorf("%s: name = %v, want %s", a.dir, entry["name"], a.display)
		}
		if fmt.Sprint(entry["version"]) != a.version {
			t.Errorf("%s: version = %v, want %s", a.dir, entry["version"], a.version)
		}
		if fmt.Sprint(entry["vendor"]) != a.vendor {
			t.Errorf("%s: vendor = %v, want %s", a.dir, entry["vendor"], a.vendor)
		}
		if fmt.Sprint(entry["bundle_id"]) != a.bundleID {
			t.Errorf("%s: bundle_id = %v, want %s", a.dir, entry["bundle_id"], a.bundleID)
		}
	}
	// A bundle with no readable Info.plist still returns an entry
	// (best effort) plus an error — never silently dropped.
	broken := filepath.Join(tmp, "Broken.app")
	if err := os.MkdirAll(filepath.Join(broken, "Contents"), 0o755); err != nil {
		t.Fatal(err)
	}
	entry, err := readAppBundle(broken)
	if err == nil {
		t.Fatalf("broken bundle should return an error")
	}
	if fmt.Sprint(entry["name"]) != "Broken" || fmt.Sprint(entry["vendor"]) != "Unknown" {
		t.Fatalf("broken bundle entry = %+v", entry)
	}
}

// TestDarwinSoftwareList exercises the whole discovery scope against
// a fixture tree: 13 apps in "Applications", one more in
// "Applications/Utilities", a duplicate Discord in a second root
// (de-duplicated by bundle id), and a broken bundle (kept + logged).
func TestDarwinSoftwareList(t *testing.T) {
	tmp := t.TempDir()
	appsRoot := filepath.Join(tmp, "Applications")
	homeRoot := filepath.Join(tmp, "HomeApps")
	for _, a := range macApps {
		writeFixtureApp(t, appsRoot, a.dir, fixtureInfoPlist(a.dir[:len(a.dir)-4], a.display, a.version, "", a.bundleID))
	}
	writeFixtureApp(t, filepath.Join(appsRoot, "Utilities"), "Activity Monitor.app",
		fixtureInfoPlist("Activity Monitor", "Activity Monitor", "1.0", "", "com.apple.ActivityMonitor"))
	writeFixtureApp(t, homeRoot, "Discord.app",
		fixtureInfoPlist("Discord", "Discord", "0.0.1", "", "com.hnc.Discord"))
	broken := filepath.Join(appsRoot, "Broken.app")
	if err := os.MkdirAll(filepath.Join(broken, "Contents"), 0o755); err != nil {
		t.Fatal(err)
	}

	var errs []string
	apps := darwinSoftwareList(&errs, appsRoot, homeRoot)
	byName := map[string]map[string]any{}
	for _, a := range apps {
		byName[fmt.Sprint(a["name"])] = a
	}
	// All 13 Mac apps + Utilities app + broken bundle = 15 entries
	// (plus any Homebrew formulae if brew happens to be installed).
	if len(apps) < 15 {
		t.Fatalf("got %d apps, want at least 15: %v", len(apps), apps)
	}
	for _, a := range macApps {
		got, ok := byName[a.display]
		if !ok {
			t.Errorf("missing app %s", a.display)
			continue
		}
		if fmt.Sprint(got["vendor"]) != a.vendor || fmt.Sprint(got["version"]) != a.version {
			t.Errorf("%s: got vendor=%v version=%v, want %s %s", a.display, got["vendor"], got["version"], a.vendor, a.version)
		}
	}
	if _, ok := byName["Activity Monitor"]; !ok {
		t.Errorf("Utilities subdir app not found")
	}
	if _, ok := byName["Broken"]; !ok {
		t.Errorf("broken bundle was dropped instead of kept")
	}
	// Discord appears once despite being in both roots.
	count := 0
	for _, a := range apps {
		if fmt.Sprint(a["bundle_id"]) == "com.hnc.Discord" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("Discord appears %d times, want 1", count)
	}
	// The broken bundle produced a recorded error; no app was
	// silently skipped.
	foundErr := false
	for _, e := range errs {
		if strings.Contains(e, "Broken.app") {
			foundErr = true
		}
	}
	if !foundErr {
		t.Errorf("broken bundle error not recorded; errors = %v", errs)
	}
	// No app in the list has the v0.3.1 shape (blank version + Apple).
	for _, a := range apps {
		if fmt.Sprint(a["version"]) == "" && fmt.Sprint(a["vendor"]) == "Apple" && fmt.Sprint(a["bundle_id"]) == "" {
			t.Errorf("v0.3.1-shaped entry still present: %+v", a)
		}
	}
}

// ------------------------------------------------------------ disks

// fixtureDiskutilPlist models the real Mac's layout as diskutil would
// report it: disk0 = the physical 512 GB SSD (APFS container partition
// disk0s2, 493,685,000,000 bytes); disk3 = the synthesized APFS
// container holding the real volumes; disk1 = a second synthesized
// container (the booted-system snapshot disk on Apple Silicon) that
// must NOT be merged into the SSD; disk2 = a disk image (Virtual) that
// must NOT be reported as a disk.
func fixtureDiskutilPlist() string {
	part := func(id string, size int64, content, name, mount string) string {
		s := fmt.Sprintf("\t\t\t<dict>\n\t\t\t\t<key>DeviceIdentifier</key>\n\t\t\t\t<string>%s</string>\n\t\t\t\t<key>Size</key>\n\t\t\t\t<integer>%d</integer>\n\t\t\t\t<key>Content</key>\n\t\t\t\t<string>%s</string>\n", id, size, content)
		if name != "" {
			s += fmt.Sprintf("\t\t\t\t<key>VolumeName</key>\n\t\t\t\t<string>%s</string>\n", name)
		}
		if mount != "" {
			s += fmt.Sprintf("\t\t\t\t<key>MountPoint</key>\n\t\t\t\t<string>%s</string>\n", mount)
		}
		return s + "\t\t\t</dict>\n"
	}
	disk := func(id string, size int64, content string, whole, internal, virtual bool, uuid string, parts string) string {
		s := fmt.Sprintf("\t\t<dict>\n\t\t\t<key>DeviceIdentifier</key>\n\t\t\t<string>%s</string>\n\t\t\t<key>Size</key>\n\t\t\t<integer>%d</integer>\n\t\t\t<key>Content</key>\n\t\t\t<string>%s</string>\n\t\t\t<key>WholeDisk</key>\n\t\t\t<%v/>\n\t\t\t<key>Internal</key>\n\t\t\t<%v/>\n", id, size, content, whole, internal)
		if virtual {
			s += "\t\t\t<key>Virtual</key>\n\t\t\t<true/>\n"
		}
		if uuid != "" {
			s += fmt.Sprintf("\t\t\t<key>APFSContainerUUID</key>\n\t\t\t<string>%s</string>\n", uuid)
		}
		return s + "\t\t\t<key>Partitions</key>\n\t\t\t<array>\n" + parts + "\t\t\t</array>\n\t\t</dict>\n"
	}
	disk0parts := part("disk0s1", 314600000, "EFI", "", "") +
		part("disk0s2", 493685000000, "Apple_APFS", "", "") +
		part("disk0s3", 5400000000, "Apple_APFS", "Recovery", "")
	disk3parts := part("disk3s1", 15200000000, "Apple_APFS", "Macintosh HD", "/") +
		part("disk3s2", 8300000000, "Apple_APFS", "Preboot", "") +
		part("disk3s3", 1100000000, "Apple_APFS", "Recovery", "") +
		part("disk3s4", 2100000000, "Apple_APFS", "Update", "") +
		part("disk3s5", 150000000000, "Apple_APFS", "Macintosh HD - Data", "/System/Volumes/Data") +
		part("disk3s6", 20000000000, "Apple_APFS", "VM", "/System/Volumes/VM")
	disk1parts := part("disk1s1", 15200000000, "Apple_APFS", "Macintosh HD", "") +
		part("disk1s2", 1000000000, "Apple_APFS", "Preboot", "") +
		part("disk1s3", 1000000000, "Apple_APFS", "Recovery", "")
	disk2parts := part("disk2s1", 4000000000, "GUID_partition_scheme", "Image", "/Volumes/Image")
	return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>AllDisksAndPartitions</key>
	<array>
` + disk("disk0", 494000000000, "GUID_partition_scheme", true, true, false, "", disk0parts) +
		disk("disk3", 493685000000, "Apple_APFS", true, true, false, "CONTAINER-UUID-1", disk3parts) +
		disk("disk1", 15000000000, "Apple_APFS", true, true, false, "SNAPSHOT-UUID", disk1parts) +
		disk("disk2", 4000000000, "GUID_partition_scheme", true, false, true, "", disk2parts) +
		`	</array>
</dict>
</plist>`
}

func TestParseDiskutilList(t *testing.T) {
	disks, err := parseDiskutilList([]byte(fixtureDiskutilPlist()))
	if err != nil {
		t.Fatalf("parseDiskutilList: %v", err)
	}
	// BEFORE (v0.3.1 df listing): 13 entries. AFTER: exactly 1 disk.
	if len(disks) != 1 {
		t.Fatalf("got %d disks, want 1: %+v", len(disks), disks)
	}
	d := disks[0]
	if d.Device != "/dev/disk0" {
		t.Fatalf("disk device = %q, want /dev/disk0", d.Device)
	}
	if d.TotalGB != 460 { // 494,000,000,000 bytes
		t.Fatalf("disk total = %d GB, want 460", d.TotalGB)
	}
	// The 6 real APFS volumes from container disk3, attached under
	// the physical disk. The snapshot container (disk1) is NOT merged.
	if len(d.Volumes) != 6 {
		t.Fatalf("got %d volumes, want 6: %+v", len(d.Volumes), d.Volumes)
	}
	byDev := map[string]macVolume{}
	for _, v := range d.Volumes {
		byDev[v.Device] = v
	}
	hd, ok := byDev["/dev/disk3s1"]
	if !ok || hd.Name != "Macintosh HD" || hd.Mount != "/" || hd.Filesystem != "apfs" {
		t.Fatalf("Macintosh HD volume wrong: %+v", hd)
	}
	data, ok := byDev["/dev/disk3s5"]
	if !ok || data.Name != "Macintosh HD - Data" || data.Mount != "/System/Volumes/Data" {
		t.Fatalf("Data volume wrong: %+v", data)
	}
	for _, dev := range []string{"/dev/disk1s1", "/dev/disk2s1"} {
		if _, ok := byDev[dev]; ok {
			t.Errorf("volume %s must not appear under the SSD", dev)
		}
	}
}

func TestDarwinPhysicalDisk(t *testing.T) {
	cases := map[string]string{
		"/dev/disk0": "/dev/disk0", "/dev/disk3s1": "/dev/disk3",
		"/dev/disk3s1s1": "/dev/disk3", "/dev/disk10s2": "/dev/disk10",
	}
	for in, want := range cases {
		if got := darwinPhysicalDisk(in); got != want {
			t.Errorf("darwinPhysicalDisk(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseDFDarwinAndGroup(t *testing.T) {
	// df -k output modeled on the v0.3.1 snapshot: the same 13
	// entries (APFS volumes + devfs + map + disk images).
	dfOut := `Filesystem   1024-blocks      Used Available Capacity Mounted on
/dev/disk3s1s1  482344960 142606336 339738624    30%    /
devfs               210       210         0   100%    /dev
/dev/disk3s6   482344960 142606336 339738624    30%    /System/Volumes/VM
/dev/disk3s2   482344960 142606336 339738624    30%    /System/Volumes/Preboot
/dev/disk3s4   482344960 142606336 339738624    30%    /System/Volumes/Update
/dev/disk1s2     1024000         0   1024000     0%    /System/Volumes/x
/dev/disk1s1     1024000         0   1024000     0%    /System/Volumes/y
/dev/disk1s3     1024000         0   1024000     0%    /System/Volumes/z
/dev/disk3s5   482344960 142606336 339738624    30%    /System/Volumes/Data
map                 1024      1024         0   100%    /System/Volumes/Update/mnt
/dev/disk2s1     4194304   1048576   3145728    25%    /Volumes/Image
/dev/disk4s1     1048576         0   1048576     0%    /Volumes/Other
/dev/disk3s1   482344960 142606336 339738624    30%    /System/Volumes/Data
`
	df := parseDFDarwin(dfOut)
	if _, ok := df["devfs"]; ok {
		t.Errorf("devfs must be excluded")
	}
	if _, ok := df["map"]; ok {
		t.Errorf("map must be excluded")
	}
	if sz, ok := df["/dev/disk3s1"]; !ok || sz[0] != 460 || sz[1] != 324 {
		t.Errorf("disk3s1 = %v, %v; want [460 324]", sz, ok)
	}
	disks := groupDFByDisk(df)
	byDev := map[string]macDisk{}
	for _, d := range disks {
		byDev[d.Device] = d
	}
	// Fallback groups by physical disk: disk3 (6 volumes, 460 GB),
	// disk1, disk2, disk4. The primary diskutil path is the accurate
	// one (it excludes disk images); the fallback only guarantees the
	// SSD is no longer 13 entries.
	ssd, ok := byDev["/dev/disk3"]
	if !ok {
		t.Fatalf("disk3 missing from fallback grouping: %+v", disks)
	}
	if ssd.TotalGB != 460 || ssd.FreeGB != 324 {
		t.Errorf("disk3 = %d/%d GB, want 460/324", ssd.TotalGB, ssd.FreeGB)
	}
	if len(ssd.Volumes) != 6 {
		t.Errorf("disk3 has %d volumes, want 6", len(ssd.Volumes))
	}
}

func TestApplyDFFree(t *testing.T) {
	disks, err := parseDiskutilList([]byte(fixtureDiskutilPlist()))
	if err != nil {
		t.Fatal(err)
	}
	df := map[string][2]int64{
		"/dev/disk3s1": {460, 324},
		"/dev/disk3s5": {460, 324},
	}
	applyDFFree(disks, df)
	if disks[0].FreeGB != 324 {
		t.Errorf("disk free = %d, want 324 (from the / mount)", disks[0].FreeGB)
	}
	for _, v := range disks[0].Volumes {
		if v.Device == "/dev/disk3s1" && v.FreeGB != 324 {
			t.Errorf("volume free = %d, want 324", v.FreeGB)
		}
		if v.Device == "/dev/disk3s2" && v.FreeGB != -1 {
			t.Errorf("unmounted volume free = %d, want -1 (unknown)", v.FreeGB)
		}
	}
}

// ------------------------------------------- sign-in-wall detection

const signInHTML = `<!DOCTYPE html>
<html><head><title>Sign in to GitHub</title></head>
<body><h1>Sign in to GitHub</h1></body></html>`

func TestIsSignInWall(t *testing.T) {
	if !isSignInWall(401, []byte(signInHTML), "https://github.com/login", "http://localhost:8000/api/v1/devices/heartbeat") {
		t.Errorf("HTML 401 from github.com should be the wall")
	}
	if !isSignInWall(200, []byte(signInHTML), "https://example-8000.app.github.dev/api/v1/devices/heartbeat", "http://localhost:8000/api/v1/devices/heartbeat") {
		t.Errorf("HTML 200 where JSON was expected should be the wall")
	}
	if !isSignInWall(302, []byte(""), "https://github.dev/login", "http://localhost:8000/api/v1/devices/heartbeat") {
		t.Errorf("redirect landing on github.dev should be the wall")
	}
	// A genuine 401 with a JSON body is a real auth failure, NOT the
	// wall — the hint must not fire for it.
	if isSignInWall(401, []byte(`{"detail":"bad device token"}`), "http://localhost:8000/api/v1/devices/heartbeat", "http://localhost:8000/api/v1/devices/heartbeat") {
		t.Errorf("JSON 401 must not be treated as the wall")
	}
	if isSignInWall(200, []byte(`{"status":"ok"}`), "http://localhost:8000/api/v1/devices/heartbeat", "http://localhost:8000/api/v1/devices/heartbeat") {
		t.Errorf("JSON 200 must not be treated as the wall")
	}
	if isSignInWall(204, []byte(``), "http://localhost:8000/api/v1/devices/heartbeat", "http://localhost:8000/api/v1/devices/heartbeat") {
		t.Errorf("empty 204 must not be treated as the wall")
	}
}

func TestPostDetectsSignInWall(t *testing.T) {
	wall := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(401)
		fmt.Fprint(w, signInHTML)
	}))
	defer wall.Close()
	cli := &client{server: wall.URL, deviceToken: "dev-token", http: wall.Client()}
	_, _, err := cli.postDevice("/api/v1/devices/heartbeat", map[string]any{})
	if err == nil {
		t.Fatalf("postDevice against the wall should error")
	}
	if !strings.Contains(err.Error(), "Private") || !strings.Contains(err.Error(), "Public") {
		t.Fatalf("wall error must carry the actionable hint, got: %v", err)
	}

	// Same for enroll (post without device auth).
	_, _, err = cli.post("/api/v1/devices/enroll", map[string]any{})
	if err == nil || !strings.Contains(err.Error(), "Private") {
		t.Fatalf("enroll against the wall should carry the hint, got: %v", err)
	}

	// Redirect to another host serving HTML (what the GitHub wall
	// does): the client follows it, then the HTML body triggers.
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, signInHTML)
	}))
	defer other.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/login", http.StatusFound)
	}))
	defer redirector.Close()
	cli2 := &client{server: redirector.URL, deviceToken: "dev-token", http: redirector.Client()}
	_, _, err = cli2.postDevice("/api/v1/devices/heartbeat", map[string]any{})
	if err == nil || !strings.Contains(err.Error(), "Private") {
		t.Fatalf("redirect-to-HTML should carry the hint, got: %v", err)
	}

	// Genuine backend answers pass through untouched.
	real := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	}))
	defer real.Close()
	cli3 := &client{server: real.URL, deviceToken: "dev-token", http: real.Client()}
	status, body, err := cli3.postDevice("/api/v1/devices/heartbeat", map[string]any{})
	if err != nil || status != 200 || string(body) != `{"status":"ok"}` {
		t.Fatalf("real backend: status=%d body=%s err=%v", status, body, err)
	}
	// And a genuine JSON 401 stays a plain 401 (no wall hint).
	badAuth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(401)
		fmt.Fprint(w, `{"detail":"bad device token"}`)
	}))
	defer badAuth.Close()
	cli4 := &client{server: badAuth.URL, deviceToken: "dev-token", http: badAuth.Client()}
	status, _, err = cli4.postDevice("/api/v1/devices/heartbeat", map[string]any{})
	if err != nil {
		t.Fatalf("JSON 401 must not become a wall error: %v", err)
	}
	if status != 401 {
		t.Fatalf("JSON 401 status = %d", status)
	}
}

func TestNextCommandDetectsSignInWall(t *testing.T) {
	wall := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, signInHTML)
	}))
	defer wall.Close()
	cli := &client{server: wall.URL, deviceToken: "dev-token", http: wall.Client()}
	_, err := cli.nextCommand("darwin-test")
	if err == nil || !strings.Contains(err.Error(), "Private") {
		t.Fatalf("command poll against the wall should carry the hint, got: %v", err)
	}
}

// ------------------------------------------------------- config path

func TestConfigPathByExecutableDir(t *testing.T) {
	// A new binary dropped next to an existing agent-config.json must
	// find it: config resolution is by executable directory.
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(filepath.Dir(exe), "agent-config.json")
	if got := configPath(""); got != want {
		t.Fatalf("configPath(\"\") = %q, want %q", got, want)
	}
	if got := configPath("/tmp/custom.json"); got != "/tmp/custom.json" {
		t.Fatalf("explicit config path ignored: %q", got)
	}
}
