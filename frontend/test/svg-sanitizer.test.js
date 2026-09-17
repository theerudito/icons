import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser as TestDOMParser } from 'linkedom'

import {
  MAX_LOCAL_REFERENCE_DEPTH,
  XML_NAMESPACE,
  assertLocalReferenceGraph,
  hasExternalCssReference,
  isUnsafeSvgAttribute,
  isXmlBaseAttribute,
  normalizeUseReferenceAttributes,
  sanitizeSvg,
} from '../src/lib/svg-sanitizer.ts'

globalThis.DOMParser = TestDOMParser
globalThis.XMLSerializer = class {
  serializeToString(node) {
    return node.toString()
  }
}

test('allows local resource references and rejects external resource loading', () => {
  assert.equal(hasExternalCssReference('fill: url(#gradient)'), false)
  assert.equal(hasExternalCssReference('fill: url(https://example.com/gradient.svg#paint)'), true)
  assert.equal(hasExternalCssReference('@import "https://example.com/theme.css"'), true)
  assert.equal(isUnsafeSvgAttribute('path', 'onclick', 'alert(1)'), true)
  assert.equal(isUnsafeSvgAttribute('a', 'href', 'https://example.com'), true)
  assert.equal(isUnsafeSvgAttribute('path', 'style', 'fill: url(#gradient)'), false)
})

test('accepts masks, filters, gradients, patterns, clip paths, and markers with local references', () => {
  const sanitized = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <defs>
      <linearGradient id="gradient"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#111"/></linearGradient>
      <pattern id="pattern" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="url(#gradient)"/></pattern>
      <filter id="shadow"><feGaussianBlur stdDeviation="1"/></filter>
      <clipPath id="clip"><circle cx="32" cy="32" r="28"/></clipPath>
      <marker id="marker" markerWidth="4" markerHeight="4" refX="2" refY="2"><circle cx="2" cy="2" r="2"/></marker>
      <mask id="mask"><rect width="64" height="64" fill="url(#pattern)"/></mask>
    </defs>
    <path d="M4 32h56" style="-moz-appearance: none; fill: url('#gradient'); filter: url(#shadow)" clip-path="url(#clip)" mask="url(#mask)" marker-end="url(#marker)"/>
  </svg>`)

  assert.ok(sanitized)
  assert.match(sanitized, /mask="url\(#mask\)"/)
  assert.match(sanitized, /clip-path="url\(#clip\)"/)
  assert.match(sanitized, /filter: url\(#shadow\)/)
  assert.match(sanitized, /marker-end="url\(#marker\)"/)
  assert.match(sanitized, /-moz-appearance: none/)
})

test('removes every SVG animation element regardless of local-name casing or namespace prefix', () => {
  const sanitized = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg">
    <animate attributeName="opacity" values="0;1"/><animateColor attributeName="fill" values="#000;#fff"/>
    <ANIMATEMOTION path="M0 0L1 1"/><animateTransform attributeName="transform" type="rotate"/><set attributeName="fill" to="red"/>
    <s:discard/><s:AnImAtEcOlOr attributeName="fill" values="#000;#fff"/><rect width="1" height="1"/>
  </svg>`)

  assert.ok(sanitized)
  assert.doesNotMatch(sanitized, /animate|discard|<set\b/i)
  assert.match(sanitized, /<rect/)
})

test('strips XML Base from the root, ancestors, and referencing elements', () => {
  for (const [location, rootAttributes, groupAttributes, useAttributes] of [
    ['root', 'xml:base="https://example.com/assets/"', '', ''],
    ['ancestor', '', 'xml:base="https://example.com/assets/"', ''],
    ['element', '', '', 'xml:base="https://example.com/assets/"'],
  ]) {
    const sanitized = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" ${rootAttributes}><defs><path id="icon" d="M0 0h1v1z"/></defs><g ${groupAttributes}><use href="#icon" ${useAttributes}/></g></svg>`)

    assert.ok(sanitized, `${location} XML Base SVG should remain otherwise valid`)
    assert.doesNotMatch(sanitized, /xml:base/i)
    assert.match(sanitized, /href="#icon"/)
  }
})

test('recognizes namespace-equivalent XML Base attributes', () => {
  assert.equal(isXmlBaseAttribute('xml:base', 'base', XML_NAMESPACE), true)
  assert.equal(isXmlBaseAttribute('alias:base', 'base', XML_NAMESPACE), true)
  assert.equal(isUnsafeSvgAttribute('use', 'alias:base', 'https://example.com/', 'base', XML_NAMESPACE), true)
  assert.equal(isXmlBaseAttribute('base', 'base', null), false)
})

test('accepts local use references and normalizes legacy xlink syntax', () => {
  const ids = new Map([['symbol', 1]])

  assert.deepEqual(normalizeUseReferenceAttributes({ href: '#symbol', x: '4' }, ids), { href: '#symbol', x: '4' })
  assert.deepEqual(normalizeUseReferenceAttributes({ 'xlink:href': '#symbol', y: '8' }, ids), { y: '8', href: '#symbol' })
  assert.deepEqual(normalizeUseReferenceAttributes({ href: '#symbol', 'xlink:href': '#symbol' }, ids), { href: '#symbol' })
})

test('rejects unsafe, malformed, missing, and ambiguous use references', () => {
  const ids = new Map([['symbol', 1], ['duplicate', 2]])
  for (const attributes of [
    {},
    { href: '' },
    { href: 'https://example.com/icon.svg#symbol' },
    { href: 'data:image/svg+xml;base64,abc' },
    { href: 'file:///tmp/icon.svg#symbol' },
    { href: 'other.svg#symbol' },
    { href: '#missing' },
    { href: '#duplicate' },
    { href: '#symbol', 'xlink:href': 'https://example.com/icon.svg#symbol' },
  ]) {
    assert.throws(() => normalizeUseReferenceAttributes(attributes, ids), /<use>|reference/)
  }
})

test('rejects direct and indirect local resource cycles', () => {
  assert.throws(() => assertLocalReferenceGraph([[0]]), /cyclic/)
  assert.throws(() => assertLocalReferenceGraph([[1], [2], [0]]), /cyclic/)
  assert.throws(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><mask id="a"><rect mask="url(#b)"/></mask><mask id="b"><rect mask="url(#a)"/></mask></defs><rect mask="url(#a)"/></svg>'), /cyclic/)
})

test('bounds local resource reference-chain depth', () => {
  const allowed = Array.from({ length: MAX_LOCAL_REFERENCE_DEPTH }, (_, index) => (
    index + 1 < MAX_LOCAL_REFERENCE_DEPTH ? [index + 1] : []
  ))
  const rejected = Array.from({ length: MAX_LOCAL_REFERENCE_DEPTH + 1 }, (_, index) => (
    index + 1 < MAX_LOCAL_REFERENCE_DEPTH + 1 ? [index + 1] : []
  ))

  assert.doesNotThrow(() => assertLocalReferenceGraph(allowed))
  assert.throws(() => assertLocalReferenceGraph(rejected), /cannot exceed 32 levels/)

  const masks = Array.from({ length: MAX_LOCAL_REFERENCE_DEPTH + 1 }, (_, index) => (
    `<mask id="mask${index}"><rect width="1" height="1"${index < MAX_LOCAL_REFERENCE_DEPTH ? ` mask="url(#mask${index + 1})"` : ''}/></mask>`
  )).join('')
  assert.throws(
    () => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><defs>${masks}</defs><rect mask="url(#mask0)"/></svg>`),
    /cannot exceed 32 levels/,
  )
})

test('rejects external, malformed, missing, and ambiguous URL references', () => {
  for (const [name, reference] of [
    ['external', 'https://example.com/assets.svg#paint'],
    ['cross-document', 'other.svg#paint'],
    ['data', 'data:image/svg+xml;base64,abc'],
    ['file', 'file:///tmp/paint.svg#paint'],
    ['javascript', 'javascript:alert(1)'],
    ['missing', '#missing'],
  ]) {
    assert.throws(
      () => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(${reference})"/></svg>`),
      /URL reference|same-document|does not resolve/,
      name,
    )
  }
  assert.throws(
    () => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"/><linearGradient id="paint"/></defs><rect fill="url(#paint)"/></svg>'),
    /does not resolve to one local element/,
  )
  assert.throws(
    () => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#broken"/></svg>'),
    /malformed URL reference/,
  )
})

test('rejects bare-string and unsupported CSS image functions', () => {
  for (const [name, style] of [
    ['external', 'fill: image-set("https://example.com/icon.png" 1x)'],
    ['protocol-relative', 'fill: image-set("//example.com/icon.png" 1x)'],
    ['relative cross-document', 'fill: image-set("../icon.svg#paint" 1x)'],
    ['data scheme', 'fill: image-set("data:image/svg+xml;base64,abc" 1x)'],
    ['file scheme', 'fill: image-set("file:///tmp/icon.svg" 1x)'],
    ['javascript scheme', 'fill: image-set("javascript:alert(1)" 1x)'],
    ['multiple values', 'fill: image-set("one.png" 1x, "two.png" 2x)'],
    ['case variant', 'fill: ImAgE-SeT("https://example.com/icon.png" 1x)'],
    ['vendor variant', 'fill: -WEBKIT-IMAGE-SET("https://example.com/icon.png" 1x)'],
    ['Mozilla vendor prefix', 'fill: -moz-element("#source")'],
    ['Opera vendor prefix', 'fill: -o-image-set("https://example.com/icon.png" 1x)'],
    ['Microsoft vendor prefix', 'fill: -ms-image("https://example.com/icon.png")'],
    ['arbitrary mixed-case vendor prefix', 'fill: -AcMe-CrOsS-FaDe("one.png", "two.png")'],
    ['escaped function name', String.raw`fill: ima\67 e-set("https://example.com/icon.png" 1x)`],
    ['comment-obfuscated function name', 'fill: image/**/-set("https://example.com/icon.png" 1x)'],
  ]) {
    assert.equal(hasExternalCssReference(style), true, name)
    assert.throws(
      () => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect style='${style}'/></svg>`),
      /unsafe CSS syntax/,
      name,
    )
  }
})

test('strips scripts, events, foreign loading content, and non-resource links', () => {
  const sanitized = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:evil="urn:evil" onload="alert(1)">
    <script>alert(1)</script><foreignObject><iframe src="https://example.com"/></foreignObject>
    <image href="data:image/png;base64,abc"/><a href="https://example.com"><rect onclick="alert(1)" evil:onfocus="alert(1)" width="1" height="1"/></a>
  </svg>`)

  assert.ok(sanitized)
  assert.doesNotMatch(sanitized, /script|foreignObject|iframe|image|onload|onclick|onfocus|https:|data:/i)
  assert.match(sanitized, /<a><rect/)
})
