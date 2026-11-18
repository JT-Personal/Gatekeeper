import { useCallback, useEffect, useRef, useState } from 'react'
import { workspaceSchema, type Workspace } from './domain'
import { initialWorkspace } from './seed'
import { fetchSession, type Session } from './session'

type Preference = 'auto' | 'local' | 'server'
type Snapshot = { workspace: Workspace; revision: number }
type ServerState = { saved: Snapshot; draft: Workspace }
type SaveError = { message: string; conflict?: Snapshot; reauthenticate?: boolean }

const DATA_KEY = 'gatekeeper.workspace.v1'
const MODE_KEY = 'gatekeeper.storage'

function readLocal(): { workspace: Workspace; warning: string } {
  try {
    const value = localStorage.getItem(DATA_KEY)
    if (!value) return { workspace: initialWorkspace, warning: '' }
    const result = workspaceSchema.safeParse(JSON.parse(value))
    if (result.success) return { workspace: result.data, warning: '' }
    return { workspace: initialWorkspace, warning: 'The browser workspace could not be read. Export a backup before making changes.' }
  } catch {
    return { workspace: initialWorkspace, warning: 'The browser workspace could not be read. Browser storage may be unavailable.' }
  }
}

function readPreference(): Preference {
  try {
    const value = localStorage.getItem(MODE_KEY)
    return value === 'server' || value === 'local' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

function readSnapshot(payload: unknown): Snapshot {
  if (typeof payload !== 'object' || payload === null || !('workspace' in payload) ||
      !('revision' in payload) || typeof payload.revision !== 'number' || !Number.isSafeInteger(payload.revision)) {
    throw new Error('The server returned an invalid workspace version.')
  }
  return { workspace: workspaceSchema.parse(payload.workspace), revision: payload.revision }
}

async function fetchSnapshot(signal?: AbortSignal) {
  const response = await fetch('/api/workspace', { cache: 'no-store', signal })
  if (response.status === 401) throw new Error('Sign in again to open the PostgreSQL workspace.')
  if (!response.ok) throw new Error('Could not open the shared PostgreSQL workspace.')
  return readSnapshot(await response.json())
}

export function useWorkspace() {
  const [initial] = useState(readLocal)
  const [local, setLocal] = useState(initial.workspace)
  const [localWarning, setLocalWarning] = useState(initial.warning)
  const [preference, setPreference] = useState(readPreference)
  const [mode, setMode] = useState<'local' | 'server' | 'loading'>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [server, setServer] = useState<ServerState | null>(null)
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null)
  const [connectionError, setConnectionError] = useState('')
  const [saveError, setSaveError] = useState<SaveError | null>(null)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const probe = useRef(0)
  const writing = useRef(false)

  const writeLocal = useCallback((workspace: Workspace) => {
    setLocal(workspace)
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(workspace))
      setLocalWarning('')
    } catch {
      setLocalWarning('Browser storage is full or unavailable. Export your workspace before closing this tab.')
    }
  }, [])

  function storePreference(value: Preference) {
    setPreference(value)
    try {
      localStorage.setItem(MODE_KEY, value)
    } catch {
      // Session-only mode selection still works when browser storage is unavailable.
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const sequence = ++probe.current

    async function openWorkspace() {
      let discovered: Session
      try {
        discovered = await fetchSession(controller.signal)
      } catch {
        if (sequence === probe.current) setSessionError('Could not check the workspace sign-in status.')
        return
      }

      if (sequence !== probe.current) return
      setSession(discovered)
      if (discovered.mode === 'oidc' && !discovered.user) return
      if (discovered.mode === 'local' || (discovered.mode === 'trusted' && preference === 'local')) {
        setMode('local')
        return
      }

      try {
        const snapshot = await fetchSnapshot(controller.signal)
        if (sequence !== probe.current) return
        setServerAvailable(true)
        setServer({ saved: snapshot, draft: snapshot.workspace })
        setMode('server')
        if (discovered.mode === 'trusted' && preference === 'auto') storePreference('server')
      } catch (error) {
        if (sequence !== probe.current) return
        setServerAvailable(false)
        setConnectionError(error instanceof Error ? error.message : 'Could not open the shared PostgreSQL workspace.')
      }
    }

    void openWorkspace().finally(() => clearTimeout(timeout))
    return () => {
      ++probe.current
      clearTimeout(timeout)
      controller.abort()
    }
    // Explicit storage switches use their own connection flow.
  }, [attempt])

  const dirty = Boolean(server && server.saved.workspace !== server.draft)
  useEffect(() => {
    if (mode !== 'server' || !server || !dirty || saveError || writing.current) return
    const { saved, draft } = server
    writing.current = true
    setSaving(true)

    async function save() {
      try {
        const response = await fetch('/api/workspace', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace: draft, revision: saved.revision }),
          signal: AbortSignal.timeout(12000),
        })

        if (response.status === 409) {
          const conflict = readSnapshot(await response.json())
          setSaveError({ message: 'Another session saved changes. Export this draft or load the latest shared workspace.', conflict })
          return
        }
        if (response.status === 413) {
          setSaveError({ message: 'The draft exceeds the 32 MB server limit. Export a backup or reduce the workspace before retrying.' })
          return
        }
        if (response.status === 401) {
          setSaveError({ message: 'Your session ended. Sign in again to save this draft, or export a backup.', reauthenticate: true })
          return
        }
        if ([400, 403, 422].includes(response.status)) {
          const payload: unknown = await response.json().catch(() => null)
          const detail = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'The shared workspace rejected the update.'
          setSaveError({ message: detail })
          return
        }
        if (!response.ok) throw new Error('The shared workspace could not be saved.')
        const snapshot = readSnapshot(await response.json())
        setServer((current) => current && ({
          saved: snapshot,
          draft: current.draft === draft ? snapshot.workspace : current.draft,
        }))
      } catch {
        setSaveError({ message: 'Your changes are in this tab. Retry saving or export a backup.' })
      } finally {
        writing.current = false
        setSaving(false)
      }
    }

    void save()
  }, [mode, server, dirty, saveError])

  useEffect(() => {
    if (!dirty || mode !== 'server') return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, mode])

  const workspace = mode === 'server' ? server?.draft ?? local : local

  function update(next: Workspace) {
    if (mode === 'local') writeLocal(next)
    if (mode === 'server') setServer((current) => current && { ...current, draft: next })
  }

  function useLocal(copyDraft = false) {
    if (!session || session.mode === 'oidc') return
    ++probe.current
    setConnecting(false)
    if (copyDraft && server) writeLocal(server.draft)
    setMode('local')
    setSaveError(null)
    setConnectionError('')
    storePreference('local')
  }

  async function useServer() {
    if (!session || session.mode === 'local' || (session.mode === 'oidc' && !session.user)) return
    const sequence = ++probe.current
    setConnecting(true)
    setConnectionError('')
    try {
      const snapshot = await fetchSnapshot(AbortSignal.timeout(5000))
      if (sequence !== probe.current) return
      setServer({ saved: snapshot, draft: snapshot.workspace })
      setServerAvailable(true)
      setMode('server')
      setSaveError(null)
      if (session.mode === 'trusted') storePreference('server')
    } catch {
      if (sequence !== probe.current) return
      setServerAvailable(false)
      setConnectionError('Could not open the shared PostgreSQL workspace.')
    } finally {
      if (sequence === probe.current) setConnecting(false)
    }
  }

  function resolveConflict() {
    if (!saveError?.conflict) return
    const snapshot = saveError.conflict
    setServer({ saved: snapshot, draft: snapshot.workspace })
    setSaveError(null)
  }

  return {
    workspace, mode, session, sessionError, update, serverAvailable, localWarning, connectionError, connecting,
    retrySession: () => {
      setSessionError('')
      setAttempt((previous) => previous + 1)
    },
    saveError, saving, dirty, useLocal, useServer, resolveConflict,
    retrySave: () => setSaveError(null),
  }
}
