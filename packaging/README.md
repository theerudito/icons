# Debian package

Build the amd64 package from the repository root:

```sh
./packaging/build-deb.sh
```

The script installs the locked frontend dependencies with `npm ci`, builds the
Wails binary using the build tags configured in `wails.json`, and writes the
package to `build/installer/icons_1.0.0_amd64.deb`.

Set `PACKAGE_VERSION` to produce a different Debian package version. Set
`SOURCE_DATE_EPOCH` to a fixed Unix timestamp when reproducible timestamps are
required; otherwise the latest Git commit timestamp is used. Set
`SKIP_FRONTEND_INSTALL=1` only when `frontend/node_modules` already matches the
lockfile, such as an offline local verification.
