import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_CUSTOM_SIZE,
  MIN_CUSTOM_SIZE,
  commitCustomSize,
} from '../src/lib/custom-size.ts'

test('commits valid custom-size drafts as bounded integers', () => {
  assert.equal(commitCustomSize('256', 512), 256)
  assert.equal(commitCustomSize('63.6', 512), 64)
  assert.equal(commitCustomSize('1', 512), MIN_CUSTOM_SIZE)
  assert.equal(commitCustomSize('4096', 512), MAX_CUSTOM_SIZE)
})

test('keeps the committed size when a draft is empty or invalid', () => {
  assert.equal(commitCustomSize('', 512), 512)
  assert.equal(commitCustomSize('   ', 256), 256)
  assert.equal(commitCustomSize('not-a-size', 128), 128)
})
