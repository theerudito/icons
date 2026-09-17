import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'

import { SaveFile } from '../wailsjs/go/main/App.js'
import { commitCustomSize, MAX_CUSTOM_SIZE, MIN_CUSTOM_SIZE } from './lib/custom-size'
import { buildIco, buildSvg, canvasToBlob, drawIcon, type RenderSettings } from './lib/icon-generator'
import { sanitizeSvg } from './lib/svg-sanitizer'
import { assertImageDimensions } from './lib/validation'

type PresetId = 'play' | 'favicon' | 'windows' | 'generic'
type OutputFormat = 'png' | 'webp' | 'svg'
type SourceKind = 'raster' | 'vector' | ''
type Variant = { size: number; label: string }

const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const MAX_GENERATED_BYTES = 24 * 1024 * 1024

const palette = [
  { name: 'Transparent', value: 'transparent' },
  { name: 'Ink', value: '#101827' },
  { name: 'Slate', value: '#334155' },
  { name: 'Cloud', value: '#f8fafc' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Cyan', value: '#0891b2' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Rose', value: '#e11d48' },
  { name: 'Violet', value: '#7c3aed' },
  { name: 'Black', value: '#000000' },
  { name: 'Navy', value: '#1e3a8a' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Lime', value: '#65a30d' },
  { name: 'Fuchsia', value: '#c026d3' },
  { name: 'Brown', value: '#92400e' },
]

const presets: Array<{ id: PresetId; title: string; detail: string }> = [
  { id: 'play', title: 'Google Play', detail: '512 px PNG' },
  { id: 'favicon', title: 'Favicon', detail: '3-size ICO' },
  { id: 'windows', title: 'Windows app', detail: '5-size ICO' },
  { id: 'generic', title: 'Custom', detail: 'PNG, WebP or SVG' },
]

function getVariants(preset: PresetId, genericSize: number): Variant[] {
  if (preset === 'favicon') return [16, 32, 48].map(size => ({ size, label: `${size} × ${size}` }))
  if (preset === 'windows') return [16, 24, 32, 48, 256].map(size => ({ size, label: `${size} × ${size}` }))
  if (preset === 'generic') return [{ size: genericSize, label: `${genericSize} × ${genericSize}` }]
  return [{ size: 512, label: '512 × 512' }]
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const renderSequenceRef = useRef(0)
  const sourceLoadSequenceRef = useRef(0)
  const downloadUrlsRef = useRef(new Set<string>())
  const downloadTimersRef = useRef(new Set<number>())

  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceKind>('')
  const [preset, setPreset] = useState<PresetId>('play')
  const [artworkScale, setArtworkScale] = useState(82)
  const [padding, setPadding] = useState(8)
  const [cornerRadius, setCornerRadius] = useState(18)
  const [background, setBackground] = useState('#2563eb')
  const [genericSize, setGenericSize] = useState(512)
  const [genericSizeDraft, setGenericSizeDraft] = useState('512')
  const [genericFormat, setGenericFormat] = useState<OutputFormat>('png')
  const [selectedSize, setSelectedSize] = useState(512)
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({})
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  const variants = getVariants(preset, genericSize)
  const isBundle = preset === 'favicon' || preset === 'windows'
  const outputFormat = isBundle ? 'ICO' : preset === 'play' ? 'PNG' : genericFormat.toUpperCase()
  const selectedPreview = previewUrls[selectedSize] || previewUrls[variants[0].size]

  useEffect(() => {
    const sequence = ++renderSequenceRef.current
    if (!sourceImage) {
      setPreviewUrls({})
      return
    }

    const settings = { artworkScale, padding, cornerRadius, background }
    const next: Record<number, string> = {}
    for (const variant of getVariants(preset, genericSize)) {
      next[variant.size] = drawIcon(sourceImage, variant.size, settings).toDataURL('image/png')
    }
    if (sequence === renderSequenceRef.current) setPreviewUrls(next)
  }, [artworkScale, background, cornerRadius, genericSize, padding, preset, sourceImage])

  useEffect(() => () => {
    for (const timer of downloadTimersRef.current) window.clearTimeout(timer)
    for (const url of downloadUrlsRef.current) URL.revokeObjectURL(url)
    downloadTimersRef.current.clear()
    downloadUrlsRef.current.clear()
  }, [])

  function settings(): RenderSettings {
    return { artworkScale, padding, cornerRadius, background }
  }

  function selectPreset(nextPreset: PresetId) {
    setPreset(nextPreset)
    setGenericSizeDraft(String(genericSize))
    setSelectedSize(nextPreset === 'favicon' ? 32 : nextPreset === 'windows' ? 48 : nextPreset === 'generic' ? genericSize : 512)
    setError('')
    setStatus('')
  }

  function useGenericSize(size: number) {
    const nextSize = commitCustomSize(String(size), genericSize)
    setGenericSize(nextSize)
    setGenericSizeDraft(String(nextSize))
    setSelectedSize(nextSize)
  }

  function commitGenericSize() {
    const nextSize = commitCustomSize(genericSizeDraft, genericSize)
    setGenericSize(nextSize)
    setGenericSizeDraft(String(nextSize))
    setSelectedSize(nextSize)
  }

  async function loadSource(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    const sequence = ++sourceLoadSequenceRef.current
    if (!file) return

    setError('')
    setStatus('')
    if (file.size > MAX_SOURCE_BYTES) {
      setError('The source image is larger than the 15 MB safety limit.')
      return
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let dataUrl: string
      let kind: Exclude<SourceKind, ''>
      if (isPng(bytes)) {
        dataUrl = await blobToDataUrl(new Blob([bytes], { type: 'image/png' }))
        kind = 'raster'
      } else if (isWebP(bytes)) {
        dataUrl = await blobToDataUrl(new Blob([bytes], { type: 'image/webp' }))
        kind = 'raster'
      } else {
        const safeSvg = sanitizeSvg(new TextDecoder().decode(bytes))
        if (!safeSvg) throw new Error('Choose a valid PNG, WebP, or SVG file.')
        dataUrl = await blobToDataUrl(new Blob([safeSvg], { type: 'image/svg+xml' }))
        kind = 'vector'
      }

      const image = await loadImage(dataUrl)
      assertImageDimensions(image.naturalWidth, image.naturalHeight, kind === 'raster' ? 'The raster image' : 'The SVG')
      if (sequence !== sourceLoadSequenceRef.current) return
      setSourceImage(image)
      setSourceKind(kind)
      setSourceName(file.name)
      setStatus(`${file.name} loaded at ${image.naturalWidth} × ${image.naturalHeight}.`)
    } catch (cause) {
      if (sequence !== sourceLoadSequenceRef.current) return
      setSourceImage(null)
      setSourceKind('')
      setSourceName('')
      setError(cause instanceof Error ? cause.message : 'The image could not be loaded.')
    }
  }

  async function exportSelection() {
    if (!sourceImage || isExporting) return
    setError('')
    setStatus('')
    setIsExporting(true)
    try {
      let blob: Blob
      let filename: string

      if (isBundle) {
        const frames: Blob[] = []
        for (const variant of variants) {
          frames.push(await canvasToBlob(drawIcon(sourceImage, variant.size, settings()), 'image/png'))
        }
        blob = await buildIco(frames, variants.map(item => item.size))
        filename = preset === 'favicon' ? 'favicon.ico' : 'windows-app.ico'
      } else {
        const size = preset === 'play' ? 512 : selectedSize
        const canvas = drawIcon(sourceImage, size, settings())
        const format = preset === 'play' ? 'png' : genericFormat
        if (format === 'svg') {
          const png = await canvasToBlob(canvas, 'image/png')
          const embedded = await blobToDataUrl(png)
          const svg = buildSvg(embedded, size, settings(), `Rendered icon from ${sourceName}`)
          blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
        } else {
          blob = await canvasToBlob(canvas, `image/${format}`)
        }
        filename = preset === 'play' ? 'google-play-icon.png' : `app-icon-${size}.${format}`
      }

      if (blob.size > MAX_GENERATED_BYTES) throw new Error('The generated file exceeds the 24 MB safety limit.')
      const encoded = (await blobToDataUrl(blob)).split(',')[1]
      const path = await saveWithNativeDialog(filename, encoded, blob)
      setStatus(path ? `Saved to ${path}` : 'Export cancelled.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  async function saveWithNativeDialog(filename: string, encoded: string, blob: Blob): Promise<string> {
    if (window.go?.main?.App?.SaveFile) return SaveFile(filename, encoded)

    const url = URL.createObjectURL(blob)
    downloadUrlsRef.current.add(url)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url)
      downloadUrlsRef.current.delete(url)
      downloadTimersRef.current.delete(timer)
    }, 1000)
    downloadTimersRef.current.add(timer)
    return filename
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1420px] bg-[#090c11] px-4 py-4 text-[#edf2f8] [background-image:radial-gradient(circle_at_72%_0,#131d2e_0,transparent_35%)] sm:px-5 sm:py-5 lg:px-8 lg:pt-7 lg:pb-10">
      <div className="mb-5 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-[#2c3545] bg-[#11161feb] p-1.5 lg:grid-cols-4" aria-label="Output destination">
          {presets.map(item => (
            <button
              className={`flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-2 text-center transition-colors sm:flex-row sm:gap-2 ${preset === item.id ? 'border-[#355d9b] bg-[#172b4d] text-[#9ac2ff] shadow-lg' : 'border-transparent hover:border-[#2c3545] hover:bg-[#202938]'}`}
              type="button"
              onClick={() => selectPreset(item.id)}
              key={item.id}
            >
              <strong>{item.title}</strong><span className={`text-xs ${preset === item.id ? 'text-[#c1d8fb]' : 'text-[#a6b0c0]'}`}>{item.detail}</span>
            </button>
          ))}
        </nav>
        <button className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#83b5ff] bg-[#73a9ff] px-4 py-3 font-extrabold text-[#07101e] shadow-lg transition hover:-translate-y-px hover:border-[#b4d2ff] hover:bg-[#94bdff] active:translate-y-0" type="button" onClick={() => fileInputRef.current?.click()}>
          <svg className="w-5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" /></svg>
          {sourceImage ? 'Replace source' : 'Choose image'}
        </button>
        <input className="sr-only" ref={fileInputRef} type="file" accept=".png,.webp,.svg,image/png,image/webp,image/svg+xml" onChange={loadSource} />
      </div>

      {error && <div className="mb-4 rounded-xl border border-[#71303c] bg-[#30171d] px-3.5 py-2.5 text-sm text-[#ff9ca7]" role="alert">{error}</div>}
      {status && <div className="mb-4 rounded-xl border border-[#285f49] bg-[#10291f] px-3.5 py-2.5 text-sm text-[#74d7ad]" role="status">{status}</div>}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(275px,340px)_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-[#2c3545] bg-[#11161ff5] p-4 shadow-2xl sm:p-5" aria-label="Icon controls">
          <div className="mb-5 flex items-center justify-between">
            <div><p className="mb-1 text-[11px] font-extrabold tracking-[.17em] text-[#a6b0c0]">ARTWORK</p><h2 className="text-xl font-extrabold">Composition</h2></div>
            {sourceImage && <span className="max-w-[90px] overflow-hidden text-ellipsis rounded-md border border-[#355d9b] bg-[#172b4d] px-2 py-1 text-[10px] font-extrabold tracking-widest text-[#a9cbff]" title={sourceName}>{sourceKind === 'vector' ? 'SVG' : 'RASTER'}</span>}
          </div>

          <div className="mb-5 rounded-xl border border-[#293c5b] bg-[#151e2e] p-4">
            <div className="flex justify-between gap-3 text-sm font-extrabold"><label htmlFor="scale">Artwork scale</label><output className="text-[#8cb8ff]" htmlFor="scale">{artworkScale}%</output></div>
            <input className="range-control" id="scale" type="range" min="20" max="120" step="1" value={artworkScale} onChange={event => setArtworkScale(Number(event.currentTarget.value))} disabled={!sourceImage} />
            <div className="flex justify-between text-[10px] text-[#a6b0c0]"><span>Contained</span><span>Edge to edge</span></div>
          </div>

          <div className="my-4">
            <label className="flex justify-between gap-3 text-sm font-extrabold" htmlFor="padding">Inner padding <span className="text-[#8cb8ff]">{padding}%</span></label>
            <input className="range-control" id="padding" type="range" min="0" max="30" value={padding} onChange={event => setPadding(Number(event.currentTarget.value))} disabled={!sourceImage} />
          </div>
          <div className="my-4">
            <label className="flex justify-between gap-3 text-sm font-extrabold" htmlFor="radius">Corner radius <span className="text-[#8cb8ff]">{cornerRadius}%</span></label>
            <input className="range-control" id="radius" type="range" min="0" max="50" value={cornerRadius} onChange={event => setCornerRadius(Number(event.currentTarget.value))} disabled={!sourceImage} />
          </div>

          <fieldset className="mt-5">
            <legend className="mb-3 w-full text-sm font-extrabold">Background</legend>
            <div className="grid grid-cols-6 gap-2.5">
              {palette.map(color => (
                <button
                  className={`aspect-square min-w-6 cursor-pointer rounded-lg border-2 border-[#0b0f16] bg-[var(--swatch)] shadow-[0_0_0_1px_#465268] transition hover:scale-105 hover:shadow-[0_0_0_2px_#8391a8] disabled:cursor-not-allowed disabled:opacity-35 disabled:saturate-50 ${color.value === 'transparent' ? 'checkerboard' : ''} ${background === color.value ? 'scale-[.88] shadow-[0_0_0_3px_#73a9ff,0_0_0_5px_#0b0f16] hover:scale-[.88] hover:shadow-[0_0_0_3px_#73a9ff,0_0_0_5px_#0b0f16]' : ''}`}
                  style={{ '--swatch': color.value === 'transparent' ? '#ffffff' : color.value } as CSSProperties}
                  type="button"
                  aria-label={color.name}
                  title={color.name}
                  aria-pressed={background === color.value}
                  onClick={() => setBackground(color.value)}
                  disabled={!sourceImage}
                  key={color.value}
                />
              ))}
            </div>
          </fieldset>

          {preset === 'generic' && (
            <fieldset className="mt-5 border-t border-[#2c3545] pt-5">
              <legend className="mb-3 w-full text-sm font-extrabold">Custom output</legend>
              <div className="flex gap-1.5">
                {[128, 256, 512, 1024].map(size => (
                  <button className={`flex-1 cursor-pointer rounded-lg border px-1 py-2 text-xs transition-colors ${genericSize === size ? 'border-[#548add] bg-[#172b4d] font-extrabold text-[#a9cbff]' : 'border-[#2c3545] bg-[#171e29] hover:border-[#465268] hover:bg-[#202938]'}`} type="button" onClick={() => useGenericSize(size)} key={size}>{size}</button>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs font-extrabold text-[#a6b0c0]" htmlFor="size">Size <input className="w-24 rounded-lg border border-[#465268] bg-[#171e29] px-2 py-1.5 text-[#edf2f8] hover:border-[#64738d]" id="size" type="number" min={MIN_CUSTOM_SIZE} max={MAX_CUSTOM_SIZE} value={genericSizeDraft} onChange={event => setGenericSizeDraft(event.currentTarget.value)} onBlur={commitGenericSize} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /> px</label>
              <div className="mt-3 flex gap-4 text-xs text-[#a6b0c0]">
                {(['png', 'webp', 'svg'] as OutputFormat[]).map(format => (
                  <label className="cursor-pointer" key={format}><input className="accent-[#73a9ff]" type="radio" name="format" value={format} checked={genericFormat === format} onChange={() => setGenericFormat(format)} /> {format.toUpperCase()}</label>
                ))}
              </div>
              {genericFormat === 'svg' && <p className="mt-2.5 text-[11px] leading-relaxed text-[#a6b0c0]">SVG output is a container with the rendered image embedded. Raster sources do not become vector artwork.</p>}
            </fieldset>
          )}
        </aside>

        <section className="flex min-h-[580px] flex-col rounded-2xl border border-[#2c3545] bg-[#11161ff5] p-4 shadow-2xl sm:p-6 lg:min-h-[610px]">
          <div className="mb-4 flex items-center justify-between">
            <div><p className="mb-1 text-[11px] font-extrabold tracking-[.17em] text-[#a6b0c0]">LIVE OUTPUT</p><h2 className="text-xl font-extrabold">{presets.find(item => item.id === preset)?.title}</h2></div>
            <span className="rounded-md border border-[#355d9b] bg-[#202938] px-2 py-1 text-[10px] font-extrabold tracking-widest">{outputFormat}</span>
          </div>

          {!sourceImage ? (
            <button className="grid min-h-[360px] flex-1 cursor-pointer place-content-center justify-items-center gap-2 rounded-2xl border-2 border-dashed border-[#465268] bg-[#0e131b] text-[#a6b0c0] transition-colors hover:border-[#6484b6] hover:bg-[#121a27]" type="button" onClick={() => fileInputRef.current?.click()}>
              <span className="mb-2 grid size-16 place-items-center rounded-2xl border border-[#355d9b] bg-[#172b4d] text-[#8cb8ff]"><svg className="w-7 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l4.5-5 3.5 4 2.5-3 5.5 6M8 8h.01M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /></svg></span>
              <strong className="text-lg text-[#edf2f8]">Bring in your artwork</strong>
              <span className="text-sm">PNG, WebP, or SVG up to 15 MB</span>
            </button>
          ) : (
            <>
              {isBundle && <div className="mb-4 flex items-baseline gap-3 rounded-xl border border-[#645127] bg-[#29220f] px-3 py-2.5 text-xs text-[#f4d78b]"><strong className="whitespace-nowrap">One ICO file</strong><span>Includes all {variants.length} resolutions shown below. Selecting a tile changes the inspection preview; export always includes the complete set.</span></div>}

              <div className="checkerboard relative my-1 mb-5 grid aspect-square w-[min(280px,42vh)] place-items-center self-center overflow-hidden rounded-[22px] border border-[#465268] shadow-2xl">
                <img className="size-full object-contain" src={selectedPreview} alt={`Selected ${selectedSize} pixel icon preview`} />
                <span className="absolute right-2 bottom-2 rounded-md border border-white/15 bg-[#05080ddb] px-2 py-1 text-[10px]">{selectedSize} × {selectedSize}</span>
              </div>

              <div className="mt-auto grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Output variants">
                {variants.map(variant => (
                  <button className={`min-w-0 cursor-pointer rounded-xl border p-2 text-left transition-colors ${selectedSize === variant.size ? 'border-[#73a9ff] bg-[#172b4d] shadow-[0_0_0_2px_rgba(115,169,255,.2)]' : 'border-[#2c3545] bg-[#171e29] hover:border-[#465268] hover:bg-[#202938]'}`} type="button" onClick={() => setSelectedSize(variant.size)} key={variant.size}>
                    <span className="checkerboard mb-2 grid aspect-[1.35] w-full place-items-center overflow-hidden rounded-lg border border-[#3b4659]"><img className="h-[78%] w-[58%] object-contain" src={previewUrls[variant.size]} alt="" /></span>
                    <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px]">{variant.label}</strong>
                    <small className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-[#a6b0c0]">{isBundle ? 'Inside ICO' : outputFormat}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mt-5 flex flex-col items-stretch justify-between gap-4 border-t border-[#2c3545] pt-5 sm:flex-row sm:items-center">
            <div><strong className="block text-sm">{isBundle ? `${variants.length} resolutions in one ICO` : `${selectedSize} × ${selectedSize} ${outputFormat}`}</strong><span className="mt-1 block text-[11px] text-[#a6b0c0]">{sourceImage ? 'Ready for a native save location' : 'Load artwork to enable export'}</span></div>
            <button className="cursor-pointer rounded-xl border border-[#83b5ff] bg-[#73a9ff] px-4 py-3 font-extrabold text-[#07101e] shadow-lg transition hover:-translate-y-px hover:border-[#b4d2ff] hover:bg-[#94bdff] active:translate-y-0 disabled:cursor-not-allowed disabled:border-[#2c3545] disabled:bg-[#202938] disabled:text-[#788397] disabled:opacity-70 disabled:shadow-none" type="button" onClick={exportSelection} disabled={!sourceImage || isExporting}>{isExporting ? 'Preparing…' : `Export ${outputFormat}`}</button>
          </div>
        </section>
      </section>
    </main>
  )
}

function isPng(bytes: Uint8Array) {
  return bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
}

function isWebP(bytes: Uint8Array) {
  return bytes.length > 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the generated image.'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image data is invalid or unsupported by this system.'))
    image.src = url
  })
}
