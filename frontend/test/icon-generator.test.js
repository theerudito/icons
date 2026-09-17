import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser } from 'linkedom'

import { buildSvg } from '../src/lib/icon-generator.ts'

const artwork = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwW0VQAAAABJRU5ErkJggg=='
const settings = {
  artworkScale: 82,
  padding: 8,
  cornerRadius: 18,
  background: '#2563eb',
}

test('serializes a complete self-contained rendered composition', () => {
  const svg = buildSvg(artwork, 512, settings, 'Artwork & <source> "name" \'file\'')

  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/)
  assert.match(svg, /width="512" height="512" viewBox="0 0 512 512"/)
  assert.match(svg, /<image x="0" y="0" width="512" height="512" preserveAspectRatio="none"/)
  assert.equal(svg.split(artwork).length - 1, 2)
  assert.match(svg, /href="data:image\/png;base64,/)
  assert.match(svg, /xlink:href="data:image\/png;base64,/)
  assert.match(svg, /data-background="#2563eb"/)
  assert.match(svg, /data-artwork-scale="82" data-padding="8" data-corner-radius="18"/)
  assert.match(svg, /<title>Artwork &amp; &lt;source&gt; &quot;name&quot; &apos;file&apos;<\/title>/)
  assert.doesNotMatch(svg, /blob:|file:|https?:\/\/(?!www\.w3\.org)/)

  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const image = document.querySelector('image')
  assert.equal(document.documentElement.localName, 'svg')
  assert.equal(image?.getAttribute('href'), artwork)
  assert.equal(image?.getAttribute('xlink:href'), artwork)
})

test('keeps transparent and pure black background selections distinguishable', () => {
  const transparent = buildSvg(artwork, 256, { ...settings, background: 'transparent' }, 'Transparent icon')
  const black = buildSvg(artwork, 256, { ...settings, background: '#000000' }, 'Black icon')

  assert.match(transparent, /data-background="transparent"/)
  assert.match(black, /data-background="#000000"/)
  assert.notEqual(transparent, black)
})

test('rejects temporary, local, external, and incorrectly encoded artwork references', () => {
  for (const reference of [
    'blob:https://example.com/id',
    'file:///tmp/icon.png',
    'https://example.com/icon.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,not valid',
  ]) {
    assert.throws(() => buildSvg(reference, 512, settings, 'Icon'), /embedded PNG data URI/)
  }
  assert.throws(() => buildSvg(artwork, 0, settings, 'Icon'), /dimensions/)
})
