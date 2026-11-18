import type { FinanceActor } from './finance'

export type Session =
  | { mode: 'local' | 'trusted'; user: null }
  | { mode: 'oidc'; user: FinanceActor | null }

const AUTH_KEY = 'gatekeeper.auth.oidc'

function hasProtectedSession() {
  try {
    return localStorage.getItem(AUTH_KEY) === 'true'
  } catch {
    return false
  }
}

export async function fetchSession(signal: AbortSignal): Promise<Session> {
  const response = await fetch('/api/session', { cache: 'no-store', signal })
  const isJson = response.headers.get('content-type')?.includes('application/json')

  // The static demo and Vite can return a 404 or the app shell for missing API routes.
  if ((response.status === 404 || (response.ok && !isJson)) && !response.redirected && !hasProtectedSession()) {
    return { mode: 'local', user: null }
  }
  if (!response.ok || !isJson) throw new Error('The workspace session could not be checked.')

  const result: unknown = await response.json()
  if (typeof result !== 'object' || result === null || !('mode' in result) || !('user' in result)) {
    throw new Error('The server returned an invalid session.')
  }

  if ((result.mode === 'local' || result.mode === 'trusted') && result.user === null) {
    try { localStorage.removeItem(AUTH_KEY) } catch { /* Storage is optional. */ }
    return { mode: result.mode, user: null }
  }
  if (result.mode !== 'oidc') throw new Error('The server returned an invalid sign-in mode.')

  try { localStorage.setItem(AUTH_KEY, 'true') } catch { /* The response still enforces sign-in. */ }
  const { user } = result
  if (user === null) return { mode: 'oidc', user: null }
  if (typeof user === 'object' && user !== null && 'id' in user && 'name' in user && 'role' in user &&
    typeof user.id === 'string' && user.id && typeof user.name === 'string' && user.name &&
    (user.role === 'founder' || user.role === 'admin')) {
    return { mode: 'oidc', user: { id: user.id, name: user.name, role: user.role } }
  }

  throw new Error('The server returned an invalid user.')
}
