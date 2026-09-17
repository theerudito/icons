package main

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// SaveFile writes generated icon data after the user chooses a native path.
func (a *App) SaveFile(defaultFilename, encodedData string) (string, error) {
	extension := strings.ToLower(filepath.Ext(defaultFilename))
	allowed := map[string]string{
		".png":  "PNG image (*.png)",
		".webp": "WebP image (*.webp)",
		".svg":  "SVG image (*.svg)",
		".ico":  "Icon file (*.ico)",
	}
	displayName, ok := allowed[extension]
	if !ok {
		return "", errors.New("unsupported export format")
	}
	if len(encodedData) > 32*1024*1024 {
		return "", errors.New("generated file exceeds the 24 MB safety limit")
	}

	data, err := base64.StdEncoding.DecodeString(encodedData)
	if err != nil {
		return "", errors.New("generated file data is invalid")
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:                "Export icon",
		DefaultFilename:      defaultFilename,
		CanCreateDirectories: true,
		Filters:              []runtime.FileFilter{{DisplayName: displayName, Pattern: "*" + extension}},
	})
	if err != nil || path == "" {
		return path, err
	}
	if strings.ToLower(filepath.Ext(path)) != extension {
		path += extension
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}
