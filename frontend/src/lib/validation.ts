export const MAX_SOURCE_DIMENSION = 8192
export const MAX_SOURCE_PIXELS = 32 * 1024 * 1024
export const MAX_SVG_ELEMENTS = 2000

export function assertImageDimensions(width: number, height: number, label: string) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} dimensions are invalid.`)
  }
  if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) {
    throw new Error(`${label} dimensions exceed the ${MAX_SOURCE_DIMENSION} px per-axis safety limit.`)
  }
  if (width * height > MAX_SOURCE_PIXELS) {
    throw new Error(`${label} exceeds the ${MAX_SOURCE_PIXELS.toLocaleString('en-US')} decoded-pixel safety limit.`)
  }
}

export function assertSvgComplexity(elementCount: number) {
  if (elementCount > MAX_SVG_ELEMENTS) {
    throw new Error(`The SVG exceeds the ${MAX_SVG_ELEMENTS.toLocaleString('en-US')} element safety limit.`)
  }
}

export function assertEncodedMimeType(requestedType: string, actualType: string) {
  const requested = requestedType.toLowerCase()
  const actual = actualType.toLowerCase()
  if (actual === requested) return

  const format = requested === 'image/webp' ? 'WebP' : requested === 'image/png' ? 'PNG' : requestedType
  const returned = actual || 'an unknown format'
  throw new Error(`${format} export is not supported by this browser. It returned ${returned} data instead, so no incorrectly named file was saved.`)
}
