import { useCallback, useEffect, useRef, useState } from 'react'
import { workspaceSchema, type Workspace } from './domain'
import { initialWorkspace } from './seed'

type Preference = 'auto' | 'local' | 'server'
type Snapshot = { workspace: Workspace; revision: number }
type ServerState = { saved: Snapshot; draft: Workspace }
type SaveError = { message: string; conflict?: Snapshot }

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
  if (!response.ok) throw new Error('The PostgreSQL workspace is unavailable.')
  return readSnapshot(await response.json())
}

export function useWorkspace() {
  const [initial] = useState(readLocal)
  const [local, setLocal] = useState(initial.workspace)
  const [localWarning, setLocalWarning] = useState(initial.warning)
  const [preference, setPreference] = useState(readPreference)
  const [mode, setMode] = useState<'local' | 'server' | 'loading'>(() => preference === 'local' ? 'local' : 'loading')
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
    const timeout = setTimeout(() => controller.abort(), 4000)
    const sequence = ++probe.current

    fetchSnapshot(controller.signal).then((snapshot) => {
      if (sequence !== probe.current) return
      setServerAvailable(true)
      setServer({ saved: snapshot, draft: snapshot.workspace })
      if (preference !== 'local') {
        setMode('server')
        if (preference === 'auto') storePreference('server')
      }
    }).catch(() => {
      if (sequence !== probe.current) return
      setServerAvailable(false)
      if (preference === 'server') {
        setConnectionError('Could not open the shared PostgreSQL workspace.')
      } else {
        setMode('local')
      }
    }).finally(() => clearTimeout(timeout))

    return () => {
      ++probe.current
      clearTimeout(timeout)
      controller.abort()
    }
    // Initial auto-detection runs once. Explicit switches have their own connection flow.
  }, [])

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
          setSaveError({ message: 'Another session saved changes. Keep this draft in browser storage or load the latest shared workspace.', conflict })
          return
        }
        if (response.status === 413) {
          setSaveError({ message: 'The draft exceeds the 32 MB server limit. Export a backup or reduce the workspace before retrying.' })
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
    ++probe.current
    setConnecting(false)
    if (copyDraft && server) writeLocal(server.draft)
    setMode('local')
    setSaveError(null)
    setConnectionError('')
    storePreference('local')
  }

  async function useServer() {
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
      storePreference('server')
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
    workspace, mode, update, serverAvailable, localWarning, connectionError, connecting,
    saveError, saving, dirty, useLocal, useServer, resolveConflict,
    retrySave: () => setSaveError(null),
  }
}
