#!/bin/sh

set -eu

PACKAGE_NAME="icons"
PACKAGE_VERSION="${PACKAGE_VERSION:-1.0.0}"
ARCHITECTURE="amd64"

# Ubicado en build/linux/build-deb.sh -> retrocede 2 niveles hasta la raíz del proyecto
PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

STAGING_DIR="$PROJECT_ROOT/build/deb/$PACKAGE_NAME"
OUTPUT_DIR="$PROJECT_ROOT/build/installer"
OUTPUT_FILE="$OUTPUT_DIR/${PACKAGE_NAME}_${PACKAGE_VERSION}_${ARCHITECTURE}.deb"

BINARY="$PROJECT_ROOT/build/bin/icons"
ICON="$PROJECT_ROOT/build/linux/icons.png"

require_command() {
    command -v "$1" >/dev/null 2>&1 || {
        printf 'Comando requerido no encontrado: %s\n' "$1" >&2
        exit 1
    }
}

require_command npm
require_command wails
require_command dpkg-deb

case "$PACKAGE_VERSION" in
    *[!0-9A-Za-z.+:~\-]* | '')
        printf 'PACKAGE_VERSION no es válida para Debian: %s\n' "$PACKAGE_VERSION" >&2
        exit 1
        ;;
esac

SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$PROJECT_ROOT" log -1 --format=%ct 2>/dev/null || date +%s)}"
export SOURCE_DATE_EPOCH

echo "======================================"
echo " Icons (Wails) - Debian Builder"
echo "======================================"
echo "Proyecto: $PROJECT_ROOT"
echo ""

# --------------------------------------
# 1. FRONTEND
# --------------------------------------

echo "==> Instalando dependencias y compilando frontend..."
cd "$PROJECT_ROOT"

if [ "${SKIP_FRONTEND_INSTALL:-0}" != "1" ]; then
    if [ -f "$PROJECT_ROOT/frontend/package-lock.json" ]; then
        npm --prefix "$PROJECT_ROOT/frontend" ci
    else
        npm --prefix "$PROJECT_ROOT/frontend" install
    fi
fi

npm --prefix "$PROJECT_ROOT/frontend" run build

# --------------------------------------
# 2. WAILS BUILD (Go + WebKit)
# --------------------------------------

echo "==> Compilando backend con Wails..."

wails build \
    -clean \
    -s \
    -m \
    -nosyncgomod \
    -trimpath \
    -tags webkit2_41

# --------------------------------------
# 3. VERIFICAR ARTEFACTOS
# --------------------------------------

echo "==> Verificando archivos generados..."

if [ ! -f "$BINARY" ]; then
    printf 'ERROR: No se encontró el binario en: %s\n' "$BINARY" >&2
    ls -lah "$PROJECT_ROOT/build/bin/" 2>/dev/null || true
    exit 1
fi

if [ ! -f "$ICON" ]; then
    printf 'ERROR: No se encontró el icono en: %s\n' "$ICON" >&2
    exit 1
fi

# --------------------------------------
# 4. PREPARAR PAQUETE DEBIAN
# --------------------------------------

echo "==> Generando paquete .deb..."

rm -rf "$STAGING_DIR"
rm -f "$OUTPUT_FILE"

mkdir -p "$STAGING_DIR/DEBIAN" \
    "$STAGING_DIR/usr/bin" \
    "$STAGING_DIR/usr/share/applications" \
    "$STAGING_DIR/usr/share/icons/hicolor/256x256/apps" \
    "$OUTPUT_DIR"

# Archivo DEBIAN/control
cat > "$STAGING_DIR/DEBIAN/control" <<EOF
Package: $PACKAGE_NAME
Version: $PACKAGE_VERSION
Section: utils
Priority: optional
Architecture: $ARCHITECTURE
Depends: libgtk-3-0, libwebkit2gtk-4.1-0
Maintainer: Developer <dev@example.com>
Description: Icons
 Desktop application built with Wails.
EOF

# Archivo .desktop para el lanzador de aplicaciones
cat > "$STAGING_DIR/usr/share/applications/$PACKAGE_NAME.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Icons
Comment=Icons application built with Wails
Exec=/usr/bin/$PACKAGE_NAME
Icon=$PACKAGE_NAME
Terminal=false
Categories=Utility;
StartupNotify=true
EOF

# Copiar binario e icono con los permisos correctos
install -m 0755 "$BINARY" "$STAGING_DIR/usr/bin/$PACKAGE_NAME"
install -m 0644 "$ICON" "$STAGING_DIR/usr/share/icons/hicolor/256x256/apps/$PACKAGE_NAME.png"

# Normalizar marcas de tiempo para compilaciones reproducibles
find "$STAGING_DIR" -exec touch --date="@$SOURCE_DATE_EPOCH" {} +

# Empaquetar el .deb
dpkg-deb --root-owner-group --build "$STAGING_DIR" "$OUTPUT_FILE"

# Limpiar directorio de preparación
rm -rf "$STAGING_DIR"

echo ""
echo "======================================"
echo " PAQUETE CREADO CORRECTAMENTE"
echo "======================================"
echo "Ruta: $OUTPUT_FILE"
echo ""