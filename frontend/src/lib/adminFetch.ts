try { sessionStorage.removeItem('parent_pin') } catch (_) {}

export function adminFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, {
    ...opts,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  })
}

export function adminRecordingUrl(sessionId: number) {
  return `/api/admin/sessions/${sessionId}/recording`
}

export function isAdminAuthed() { return false }
export function clearAdminAuth() { try { sessionStorage.removeItem('parent_pin') } catch (_) {} }
