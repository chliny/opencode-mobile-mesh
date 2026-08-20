export interface HorizontalIntentInput {
  dx: number
  dy: number
  threshold?: number
  ratio?: number
}

export const HORIZONTAL_THRESHOLD_PX = 6
export const HORIZONTAL_RATIO = 0.7

export function isHorizontalIntent(input: HorizontalIntentInput): boolean {
  const threshold = input.threshold ?? HORIZONTAL_THRESHOLD_PX
  const ratio = input.ratio ?? HORIZONTAL_RATIO
  const absDx = Math.abs(input.dx)
  const absDy = Math.abs(input.dy)
  return absDx >= threshold && absDx > absDy * ratio
}

export function clampOffset(offset: number, maxOffset: number): number {
  if (maxOffset <= 0) return 0
  return Math.max(0, Math.min(offset, maxOffset))
}

export function flingTarget(velocity: number, currentOffset: number, maxOffset: number): number {
  const projected = currentOffset + velocity * 0.3
  return clampOffset(projected, maxOffset)
}
