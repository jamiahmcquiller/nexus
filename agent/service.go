package main

import (
	"io"
	"os"
	"path/filepath"
)

// copySelf puts the agent binary in a stable folder so moving or deleting the download
// does not break the background service.
func copySelf(dir, name string) (string, error) {
	src, err := os.Executable()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(dir, name)
	if src == dst {
		return dst, nil
	}
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return "", err
	}
	out.Close()
	return dst, os.Rename(tmp, dst)
}
