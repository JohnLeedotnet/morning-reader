export function adminFetch(url: string, opts: RequestInit = {}) {
  const pin = sessionStorage.getItem('parent_pin') || ''
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers, 'X-Admin-Pin': pin },
  })
}

export function adminRecordingUrl(sessionId: number) {
  const pin = sessionStorage.getItem('parent_pin') || ''
  return `/api/admin/sessions/${sessionId}/recording?pin=${encodeURIComponent(pin)}`
}

export function isAdminAuthed() { return !!sessionStorage.getItem('parent_pin') }
export function clearAdminAuth() { sessionStorage.removeItem('parent_pin') }
