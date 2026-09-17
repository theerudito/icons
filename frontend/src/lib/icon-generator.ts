import { assertEncodedMimeType } from './validation.ts'

export type RenderSettings = {
  artworkScale: number
  padding: number
  cornerRadius: number
  background: string
}

export function drawIcon(image: HTMLImageElement, size: number, settings: RenderSettings): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas rendering is not available on this system.')

  const radius = size * settings.cornerRadius / 100
  roundedRect(context, 0, 0, size, size, radius)
  context.clip()

  if (settings.background !== 'transparent') {
    context.fillStyle = settings.background
    context.fillRect(0, 0, size, size)
  }

  const inset = size * settings.padding / 100
  const available = Math.max(1, size - inset * 2)
  const fitScale = Math.min(available / image.naturalWidth, available / image.naturalHeight)
  const scale = fitScale * settings.artworkScale / 100
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)

  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error(`${mimeType} export is not supported by this system.`))
        return
      }
      try {
        assertEncodedMimeType(mimeType, blob.type)
        resolve(blob)
      } catch (cause) {
        reject(cause)
      }
    }, mimeType, .94)
  })
}

export async function buildIco(frames: Blob[], sizes: number[]): Promise<Blob> {
  if (frames.length !== sizes.length || frames.length === 0) throw new Error('ICO frames are incomplete.')
  const images = await Promise.all(frames.map(frame => frame.arrayBuffer()))
  const directorySize = 6 + images.length * 16
  const totalSize = directorySize + images.reduce((sum, image) => sum + image.byteLength, 0)
  const output = new ArrayBuffer(totalSize)
  const view = new DataView(output)
  const bytes = new Uint8Array(output)

  view.setUint16(0, 0, true)
  view.setUint16(2, 1, true)
  view.setUint16(4, images.length, true)
  let dataOffset = directorySize
  images.forEach((image, index) => {
    const entry = 6 + index * 16
    const size = sizes[index]
    view.setUint8(entry, size >= 256 ? 0 : size)
    view.setUint8(entry + 1, size >= 256 ? 0 : size)
    view.setUint8(entry + 2, 0)
    view.setUint8(entry + 3, 0)
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, 32, true)
    view.setUint32(entry + 8, image.byteLength, true)
    view.setUint32(entry + 12, dataOffset, true)
    bytes.set(new Uint8Array(image), dataOffset)
    dataOffset += image.byteLength
  })
  return new Blob([output], { type: 'image/x-icon' })
}

export function buildSvg(renderedPngDataUrl: string, size: number, settings: RenderSettings, title: string): string {
  if (!Number.isInteger(size) || size <= 0) throw new Error('SVG output dimensions are invalid.')
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(renderedPngDataUrl)) {
    throw new Error('SVG artwork must be an embedded PNG data URI.')
  }

  const attributes = [
    ['data-background', settings.background],
    ['data-artwork-scale', String(settings.artworkScale)],
    ['data-padding', String(settings.padding)],
    ['data-corner-radius', String(settings.cornerRadius)],
  ].map(([name, value]) => `${name}="${escapeXml(value)}"`).join(' ')
  const embedded = escapeXml(renderedPngDataUrl)

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ${attributes}>\n  <title>${escapeXml(title)}</title>\n  <image x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="none" href="${embedded}" xlink:href="${embedded}"/>\n</svg>\n`
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.roundRect(x, y, width, height, safeRadius)
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]!)
}
