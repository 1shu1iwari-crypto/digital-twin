export function localDayRange(day: string) {
  const start = new Date(`${day}T00:00:00`)
  if (Number.isNaN(start.getTime())) throw new Error('Invalid sync date')
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

export function mean(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => Number.isFinite(value))
  if (!valid.length) return undefined
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

export function clampIntervalsToMinutes(
  intervals: Array<{start: Date; end: Date}>,
  rangeStart: Date,
  rangeEnd: Date,
) {
  const normalized = intervals
    .map(({start, end}) => ({
      start: Math.max(start.getTime(), rangeStart.getTime()),
      end: Math.min(end.getTime(), rangeEnd.getTime()),
    }))
    .filter(({start, end}) => end > start)
    .sort((a, b) => a.start - b.start)

  if (!normalized.length) return 0

  let total = 0
  let currentStart = normalized[0]!.start
  let currentEnd = normalized[0]!.end

  for (const interval of normalized.slice(1)) {
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end)
    } else {
      total += currentEnd - currentStart
      currentStart = interval.start
      currentEnd = interval.end
    }
  }
  total += currentEnd - currentStart
  return total / 60_000
}

export function round(value: number, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
