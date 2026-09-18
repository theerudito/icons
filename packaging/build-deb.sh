#!/bin/sh

set -eu

PACKAGE_NAME=icons
PACKAGE_VERSION=${PACKAGE_VERSION:-1.0.0}
ARCHITECTURE=amd64
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STAGING_DIR="$PROJECT_ROOT/build/deb/$PACKAGE_NAME"
OUTPUT_DIR="$PROJECT_ROOT/build/installer"
OUTPUT_FILE="$OUTPUT_DIR/${PACKAGE_NAME}_${PACKAGE_VERSION}_${ARCHITECTURE}.deb"

require_command() {
    command -v "$1" >/dev/null 2>&1 || {
        printf 'Required command not found: %s\n' "$1" >&2
        exit 1
    }
}

require_command npm
require_command wails
require_command dpkg-deb
require_command git

case "$PACKAGE_VERSION" in
    *[!0-9A-Za-z.+:~\-]* | '')
        printf 'PACKAGE_VERSION is not valid for a Debian package: %s\n' "$PACKAGE_VERSION" >&2
        exit 1
        ;;
esac

SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -C "$PROJECT_ROOT" log -1 --format=%ct)}
export SOURCE_DATE_EPOCH

cd "$PROJECT_ROOT"
if [ "${SKIP_FRONTEND_INSTALL:-0}" != "1" ]; then
    npm --prefix frontend ci
fi
npm --prefix frontend run build
wails build -clean -s -m -nosyncgomod -trimpath

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/DEBIAN" \
    "$STAGING_DIR/usr/bin" \
    "$STAGING_DIR/usr/share/applications" \
    "$STAGING_DIR/usr/share/icons/hicolor/256x256/apps" \
    "$OUTPUT_DIR"

while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
        Version:\ @VERSION@) printf 'Version: %s\n' "$PACKAGE_VERSION" ;;
        *) printf '%s\n' "$line" ;;
    esac
done < packaging/debian/DEBIAN/control.in > "$STAGING_DIR/DEBIAN/control"

install -m 0755 build/bin/icons "$STAGING_DIR/usr/bin/icons"
install -m 0644 packaging/debian/icons.desktop "$STAGING_DIR/usr/share/applications/icons.desktop"
install -m 0644 packaging/icons.png "$STAGING_DIR/usr/share/icons/hicolor/256x256/apps/icons.png"

find "$STAGING_DIR" -exec touch --date="@$SOURCE_DATE_EPOCH" {} +
dpkg-deb --root-owner-group --build "$STAGING_DIR" "$OUTPUT_FILE"
printf 'Created %s\n' "$OUTPUT_FILE"
