export const MIN_CUSTOM_SIZE = 16
export const MAX_CUSTOM_SIZE = 2048

export function commitCustomSize(draft: string, currentSize: number): number {
  const parsed = draft.trim() === '' ? currentSize : Number(draft)
  const nextSize = Number.isFinite(parsed) ? parsed : currentSize
  return Math.max(MIN_CUSTOM_SIZE, Math.min(MAX_CUSTOM_SIZE, Math.round(nextSize)))
}
