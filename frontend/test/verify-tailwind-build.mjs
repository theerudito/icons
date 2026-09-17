import { readdir, readFile } from 'node:fs/promises'

const assetsDirectory = new URL('../dist/assets/', import.meta.url)
const cssFiles = (await readdir(assetsDirectory)).filter(file => file.endsWith('.css'))

if (cssFiles.length === 0) throw new Error('Tailwind verification failed: the production build contains no CSS asset.')

const css = (await Promise.all(cssFiles.map(file => readFile(new URL(file, assetsDirectory), 'utf8')))).join('\n')
const rawDirective = /@import\s+(?:url\()?['"]?tailwindcss|@(tailwind|theme|utility|custom-variant|variant|source)\b/i

if (rawDirective.test(css)) {
  throw new Error('Tailwind verification failed: a raw Tailwind directive remains in the production CSS.')
}

const requiredUtilities = [
  ['grid', /\.grid\{display:grid\}/],
  ['rounded-2xl', /\.rounded-2xl\{/],
  ['sm:flex-row', /\.sm\\:flex-row\{/],
]

for (const [name, pattern] of requiredUtilities) {
  if (!pattern.test(css)) throw new Error(`Tailwind verification failed: the ${name} utility is absent from the production CSS.`)
}

console.log(`Tailwind verification passed for ${cssFiles.join(', ')}.`)
