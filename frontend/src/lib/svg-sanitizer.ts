import { assertImageDimensions, assertSvgComplexity } from './validation.ts'

export const MAX_LOCAL_REFERENCE_DEPTH = 32
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

type AttributeMap = Record<string, string>

const REMOVED_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'link',
  'style',
  'image',
  'feimage',
  'audio',
  'video',
])

const SVG_ANIMATION_ELEMENTS = new Set([
  'animate',
  'animatecolor',
  'animatemotion',
  'animatetransform',
  'set',
  'discard',
])

const LOCAL_HREF_ELEMENTS = new Set(['use', 'lineargradient', 'radialgradient', 'pattern', 'filter', 'textpath', 'mpath'])
const LOCAL_FRAGMENT = /^#([A-Za-z_][A-Za-z0-9_.:-]*)$/
const UNSUPPORTED_CSS_IMAGE_FUNCTION = /(?:^|[^\w-])(?:-[a-z][a-z0-9-]*-)?(?:image-set|image|cross-fade|element|paint)\s*\(/i
const CSS_URL = /url\s*\(\s*(?:(['"])(.*?)\1|([^'")]*))\s*\)/gi

export function sanitizeSvg(text: string): string | null {
  if (!text.trim().startsWith('<')) return null
  const document = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') return null

  validateSvg(document.documentElement)
  const sourceElements = [document.documentElement, ...document.documentElement.querySelectorAll('*')]
  sourceElements.forEach(node => {
    const localName = node.localName.toLowerCase().split(':').at(-1)!
    if (REMOVED_ELEMENTS.has(localName) || SVG_ANIMATION_ELEMENTS.has(localName)) {
      node.remove()
    }
  })

  const allElements = [document.documentElement, ...document.documentElement.querySelectorAll('*')]
  allElements.forEach(node => {
    for (const attribute of [...node.attributes]) {
      if (isXmlBaseAttribute(attribute.name, attribute.localName, attribute.namespaceURI)
        || isEventAttribute(attribute.name, attribute.localName)) {
        node.removeAttributeNode(attribute)
        continue
      }

      const name = attribute.name.toLowerCase()
      const localName = attribute.localName.toLowerCase()
      if (localName === 'src' || name === 'src' || name.endsWith(':src')) {
        node.removeAttributeNode(attribute)
        continue
      }
      if (isHrefAttribute(name, localName)) {
        if (!LOCAL_HREF_ELEMENTS.has(node.localName.toLowerCase())) {
          node.removeAttributeNode(attribute)
          continue
        }
        assertLocalFragment(attribute.value, `<${node.localName}> ${attribute.name}`)
      } else {
        if (hasUnsafeCssSyntax(attribute.value)) {
          throw new Error(`The SVG ${attribute.name} attribute contains unsafe CSS syntax.`)
        }
        extractLocalUrlIds(attribute.value, `${attribute.name} attribute`)
      }
    }
  })

  normalizeHrefAttributes(allElements)
  validateLocalReferenceGraph(document)
  return new XMLSerializer().serializeToString(document.documentElement)
}

export function isUnsafeSvgAttribute(
  elementName: string,
  attributeName: string,
  attributeValue: string,
  attributeLocalName = attributeName,
  attributeNamespace: string | null = null,
): boolean {
  const name = attributeName.toLowerCase()
  return isXmlBaseAttribute(attributeName, attributeLocalName, attributeNamespace)
    || isEventAttribute(attributeName, attributeLocalName)
    || attributeLocalName.toLowerCase() === 'src'
    || name === 'src'
    || name.endsWith(':src')
    || (isHrefAttribute(name, attributeLocalName.toLowerCase()) && (!LOCAL_HREF_ELEMENTS.has(elementName.toLowerCase()) || !LOCAL_FRAGMENT.test(attributeValue.trim())))
    || hasExternalCssReference(attributeValue)
}

export function isXmlBaseAttribute(name: string, localName = name, namespace: string | null = null): boolean {
  return name.toLowerCase() === 'xml:base'
    || (localName.toLowerCase() === 'base' && namespace === XML_NAMESPACE)
}

export function hasExternalCssReference(value: string): boolean {
  if (hasUnsafeCssSyntax(value)) return true
  try {
    extractLocalUrlIds(value, 'attribute')
    return false
  } catch {
    return true
  }
}

function hasUnsafeCssSyntax(value: string): boolean {
  return /@import\b|\\|\/\*/i.test(value) || UNSUPPORTED_CSS_IMAGE_FUNCTION.test(value)
}

export function normalizeUseReferenceAttributes(attributes: AttributeMap, idCounts: ReadonlyMap<string, number>, elementName = 'use'): AttributeMap {
  const references = Object.entries(attributes)
    .filter(([name]) => name.toLowerCase() === 'href' || name.toLowerCase().endsWith(':href'))
    .map(([, value]) => value.trim())
  if (references.length === 0 || references.some(reference => !/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(reference))) {
    throw new Error(`SVG <${elementName}> references must be non-empty local fragments.`)
  }
  if (new Set(references).size !== 1) {
    throw new Error(`SVG <${elementName}> elements cannot contain conflicting references.`)
  }

  const reference = references[0]
  if (idCounts.get(reference.slice(1)) !== 1) {
    throw new Error(`SVG <${elementName}> reference ${reference} does not resolve to one local element.`)
  }

  return {
    ...Object.fromEntries(Object.entries(attributes).filter(([name]) => {
      const lowerName = name.toLowerCase()
      return lowerName !== 'href' && !lowerName.endsWith(':href')
    })),
    href: reference,
  }
}

export function assertLocalReferenceGraph(edges: ReadonlyArray<ReadonlyArray<number>>, maxDepth = MAX_LOCAL_REFERENCE_DEPTH) {
  const state = new Uint8Array(edges.length)
  const depths = new Uint16Array(edges.length)

  const visit = (index: number): number => {
    if (state[index] === 1) throw new Error('The SVG contains a cyclic local resource reference.')
    if (state[index] === 2) return depths[index]
    state[index] = 1
    let depth = 1
    for (const referencedIndex of edges[index]) depth = Math.max(depth, 1 + visit(referencedIndex))
    if (depth > maxDepth) throw new Error(`SVG local resource reference chains cannot exceed ${maxDepth} levels.`)
    state[index] = 2
    depths[index] = depth
    return depth
  }

  for (let index = 0; index < edges.length; index++) visit(index)
}

function validateSvg(root: Element) {
  assertSvgComplexity(root.querySelectorAll('*').length + 1)

  const viewBoxText = root.getAttribute('viewBox')
  const viewBox = viewBoxText?.trim().split(/[\s,]+/).map(Number)
  if (viewBoxText && (viewBox?.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0)) {
    throw new Error('The SVG viewBox dimensions are invalid.')
  }
  if (viewBox) assertImageDimensions(viewBox[2], viewBox[3], 'The SVG viewBox')

  const width = svgLength(root.getAttribute('width'), viewBox?.[2] ?? 300)
  const height = svgLength(root.getAttribute('height'), viewBox?.[3] ?? 150)
  assertImageDimensions(width, height, 'The SVG')
}

function validateLocalReferenceGraph(document: XMLDocument) {
  const allElements = [document.documentElement, ...document.documentElement.querySelectorAll('*')]
  const idCounts = new Map<string, number>()
  for (const element of allElements) {
    const id = element.getAttribute('id')
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }

  for (const element of allElements) {
    for (const id of elementReferenceIds(element)) {
      if (idCounts.get(id) !== 1) {
        throw new Error(`SVG local reference #${id} does not resolve to one local element.`)
      }
    }
  }

  const targets = allElements.filter(element => {
    const id = element.getAttribute('id')
    return Boolean(id && idCounts.get(id) === 1)
  })
  const indexes = new Map(targets.map((element, index) => [element.getAttribute('id')!, index]))
  const edges = targets.map(target => {
    const subtree = [target, ...target.querySelectorAll('*')]
    return [...new Set(subtree.flatMap(element => elementReferenceIds(element)).map(id => indexes.get(id)!))]
  })
  assertLocalReferenceGraph(edges)
}

function svgLength(value: string | null, fallback: number): number {
  if (!value || value.trim().endsWith('%')) return fallback
  const match = value.trim().match(/^((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:px)?$/i)
  if (!match) throw new Error('SVG width and height must use finite pixel dimensions or percentages backed by a viewBox.')
  return Number(match[1])
}

function elementAttributes(element: Element): AttributeMap {
  return Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]))
}

function normalizeHrefAttributes(elements: Element[]) {
  for (const element of elements) {
    const hrefs = [...element.attributes].filter(attribute => isHrefAttribute(attribute.name.toLowerCase(), attribute.localName.toLowerCase()))
    if (hrefs.length === 0) continue
    const normalized = normalizeUseReferenceAttributes(elementAttributes(element), countIds(elements), element.localName)
    hrefs.forEach(attribute => element.removeAttributeNode(attribute))
    element.setAttribute('href', normalized.href)
  }
}

function countIds(elements: Element[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const element of elements) {
    const id = element.getAttribute('id')
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

function elementReferenceIds(element: Element): string[] {
  return [...element.attributes].flatMap(attribute => {
    if (isHrefAttribute(attribute.name.toLowerCase(), attribute.localName.toLowerCase())) {
      return [assertLocalFragment(attribute.value, `<${element.localName}> ${attribute.name}`)]
    }
    return extractLocalUrlIds(attribute.value, `${attribute.name} attribute`)
  })
}

function extractLocalUrlIds(value: string, context: string): string[] {
  const starts = [...value.matchAll(/\burl\s*\(/gi)]
  const matches = [...value.matchAll(CSS_URL)]
  if (/\burl\b/i.test(value) && starts.length !== matches.length) {
    throw new Error(`The SVG ${context} contains a malformed URL reference.`)
  }
  return matches.map(match => assertLocalFragment((match[2] ?? match[3] ?? '').trim(), context))
}

function assertLocalFragment(value: string, context: string): string {
  const match = value.trim().match(LOCAL_FRAGMENT)
  if (!match) throw new Error(`The SVG ${context} must use a same-document #fragment reference.`)
  return match[1]
}

function isHrefAttribute(name: string, localName = name): boolean {
  return localName === 'href' || name === 'href' || name.endsWith(':href')
}

function isEventAttribute(name: string, localName: string): boolean {
  return name.toLowerCase().split(':').at(-1)!.startsWith('on')
    || localName.toLowerCase().split(':').at(-1)!.startsWith('on')
}
