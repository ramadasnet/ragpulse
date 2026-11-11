const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(value?: string | Date | null): string {
  if (!value) return '—'
  const diff = (new Date(value).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return diff < 0 ? 'just now' : 'in a few seconds'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return formatDate(value)
}

export function formatDate(value?: string | Date | null, withTime = false): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatNumber(value?: number | null, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en', { maximumFractionDigits: digits, notation: Math.abs(value) >= 100_000 ? 'compact' : 'standard' }).format(value)
}

export function formatBytes(bytes?: number | null): string {
  if (bytes == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(ms?: number | null): string {
  if (ms == null || Number.isNaN(ms)) return '—'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  if (ms < 3600_000) return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatHours(hours: number): string {
  if (hours % 24 === 0) return hours === 24 ? 'daily' : `every ${hours / 24} days`
  return hours === 1 ? 'hourly' : `every ${hours} hours`
}

export function formatCost(usd?: number | null): string {
  if (usd == null) return '—'
  return usd < 0.01 && usd > 0 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

export function initials(name?: string): string {
  return (name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()
}
