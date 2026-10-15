/** Map a timeline time through a collection placement's interval transform. */
export function mapTimeWithCollectionPlacement(
  time: number,
  oldStart: number,
  oldDuration: number,
  newStart: number,
  newDuration: number,
): number {
  const relativeTime = oldDuration > 0 ? (time - oldStart) / oldDuration : 0
  return newStart + relativeTime * newDuration
}
