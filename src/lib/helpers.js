export function todayStr() {
  return toLocalDateStr(new Date())
}

export function toLocalDateStr(d) {
  const dt = new Date(d)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isPastOrToday(dateStr) {
  if (!dateStr) return false
  return dateStr <= todayStr()
}

export function formatDateHuman(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  const today = todayStr()
  const tomorrow = toLocalDateStr(new Date(Date.now() + 86400000))
  const yesterday = toLocalDateStr(new Date(Date.now() - 86400000))
  if (dateStr === today) return 'Today'
  if (dateStr === tomorrow) return 'Tomorrow'
  if (dateStr === yesterday) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hr12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hr12}:${m} ${ampm}`
}

// Normalizes any Indian number input into +91XXXXXXXXXX
export function normalizeIndianPhone(raw) {
  if (!raw) return ''
  let digits = raw.replace(/[^\d]/g, '')
  digits = digits.replace(/^0+/, '')
  if (digits.startsWith('91') && digits.length === 12) {
    return '+' + digits
  }
  if (digits.length === 10) {
    return '+91' + digits
  }
  if (digits.length > 10) {
    return '+' + digits.slice(-12).padStart(12, '9').replace(/^9(?!1)/, '91')
  }
  return '+91' + digits
}

export function displayPhone(phone) {
  if (!phone) return ''
  const digits = phone.replace('+91', '')
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
  return phone
}

export function whatsappLink(phone, message) {
  const digits = (phone || '').replace(/[^\d]/g, '')
  const base = `https://wa.me/${digits}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

export function telLink(phone) {
  return `tel:${phone}`
}

export function formatINR(amount) {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = Number(amount)
  if (Number.isNaN(n)) return '—'
  return '₹' + n.toLocaleString('en-IN')
}

// Compact form for big numbers, e.g. 4500000 -> ₹45L, 12000000 -> ₹1.2Cr
export function formatINRCompact(amount) {  if (amount === null || amount === undefined || amount === '') return '—'
  const n = Number(amount)
  if (Number.isNaN(n)) return '—'
  if (n >= 10000000) return '₹' + trim(n / 10000000) + 'Cr'
  if (n >= 100000) return '₹' + trim(n / 100000) + 'L'
  if (n >= 1000) return '₹' + trim(n / 1000) + 'K'
  return '₹' + n
}

function trim(n) {
  return Number(n.toFixed(2)).toString()
}

export function budgetRange(min, max) {
  if (!min && !max) return '—'
  if (min && max) return `${formatINRCompact(min)} – ${formatINRCompact(max)}`
  return formatINRCompact(min || max)
}

// Turns a plain 'YYYY-MM-DD' (the user's *local* calendar day) into a
// correct UTC start/end range for querying a `timestamptz` column.
// Using `new Date('2026-08-05T00:00:00')` (no trailing Z) parses as
// midnight in the browser's own timezone (IST for our users), then
// .toISOString() converts that to the right UTC instant — this is what
// avoids the ~5.5hr day-boundary bug you'd get from treating the string
// as if it were already UTC.
export function localDayBoundsUTC(dateStr) {
  const start = new Date(`${dateStr}T00:00:00`)
  const end = new Date(`${dateStr}T23:59:59.999`)
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

// Same local-timezone-safe idea as localDayBoundsUTC, but for the whole
// calendar month a given date falls in — used by the monthly Site Visit
// progress ring so "this month" always means the agent's own calendar
// month, not a UTC-shifted one.
export function localMonthBoundsUTC(date = new Date()) {
  const d = typeof date === 'string' ? new Date(date) : date
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
  return { startISO: start.toISOString(), endISO: end.toISOString(), label: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
}
