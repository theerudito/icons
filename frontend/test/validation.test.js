import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_SOURCE_DIMENSION,
  MAX_SOURCE_PIXELS,
  MAX_SVG_ELEMENTS,
  assertEncodedMimeType,
  assertImageDimensions,
  assertSvgComplexity,
} from '../src/lib/validation.ts'

test('accepts source artwork within the decoded image limits', () => {
  assert.doesNotThrow(() => assertImageDimensions(4096, 4096, 'The raster image'))
  assert.doesNotThrow(() => assertImageDimensions(MAX_SOURCE_DIMENSION, MAX_SOURCE_PIXELS / MAX_SOURCE_DIMENSION, 'The raster image'))
})

test('rejects excessive decoded dimensions and pixel counts', () => {
  assert.throws(
    () => assertImageDimensions(MAX_SOURCE_DIMENSION + 1, 1, 'The raster image'),
    /8192 px per-axis safety limit/,
  )
  assert.throws(
    () => assertImageDimensions(6000, 6000, 'The raster image'),
    /33,554,432 decoded-pixel safety limit/,
  )
})

test('rejects excessive SVG complexity', () => {
  assert.doesNotThrow(() => assertSvgComplexity(MAX_SVG_ELEMENTS))
  assert.throws(() => assertSvgComplexity(MAX_SVG_ELEMENTS + 1), /2,000 element safety limit/)
})

test('requires the encoded MIME type to match the requested export', () => {
  assert.doesNotThrow(() => assertEncodedMimeType('image/webp', 'image/webp'))
  assert.throws(
    () => assertEncodedMimeType('image/webp', 'image/png'),
    /returned image\/png data instead, so no incorrectly named file was saved/,
  )
})
