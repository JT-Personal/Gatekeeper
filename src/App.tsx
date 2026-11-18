import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, ChevronsUpDown, CircleHelp,
  ClipboardCheck, Database, Download, Factory, FileText, FlaskConical, FolderKanban,
  GitBranch, HardDrive, LayoutDashboard, List, Menu, Plus, Search, Settings2, ShieldCheck,
  Upload, X,
} from 'lucide-react'
import Dashboard from './Dashboard'
import Documents from './Documents'
import DocumentModal from './DocumentModal'
import RTMTable from './RTMTable'
import DVPRTracker from './DVPRTracker'
import GateReviews from './GateReviews'
import { workspaceSchema, type GateId, type Project } from './domain'
import { createProject } from './seed'
import { EmptyState, Modal, PageHeading } from './ui'
import { useWorkspace } from './useWorkspace'

const navigation = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'rtm', label: 'Requirements & RTM', icon: GitBranch },
  { id: 'dvpr', label: 'DVP&R Tracker', icon: FlaskConical },
  { id: 'gates', label: 'Gate Reviews', icon: ClipboardCheck },
] as const

type View = typeof navigation[number]['id']
type Dialog = 'projects' | 'new-project' | 'edit-project' | 'data' | 'search' | 'help' | 'keep-draft' | null
const PROJECT_KEY = 'gatekeeper.activeProject'

function currentView(): View {
  const id = location.hash.slice(1)
  return navigation.find((item) => item.id === id)?.id ?? 'dashboard'
}

function initialProjectId() {
  try { return localStorage.getItem(PROJECT_KEY) ?? '' } catch { return '' }
}

function initials(owner: string) {
  return owner.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'GK'
}

export default function App() {
  const storage = useWorkspace()
  const { workspace, update, mode } = storage
  const [activeId, setActiveId] = useState(initialProjectId)
  const [view, setView] = useState<View>(currentView)
  const [gateId, setGateId] = useState<GateId>()
  const [documentId, setDocumentId] = useState<string | null>()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [importError, setImportError] = useState('')
  const [pendingImport, setPendingImport] = useState<{ name: string; workspace: typeof workspace } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const project = workspace.projects.find((item) => item.id === activeId) ?? workspace.projects[0]

  function open(which: Dialog) {
    setSearch('')
    setImportError('')
    setPendingImport(null)
    setDialog(which)
  }

  useEffect(() => {
    const onHash = () => setView(currentView())
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) {
        event.preventDefault()
        setSearch('')
        setDialog('search')
      }
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 4500)
    return () => clearTimeout(timeout)
  }, [notice])

  function navigate(next: View, gate?: GateId) {
    setGateId(next === 'gates' ? gate : undefined)
    setView(next)
    setMobileOpen(false)
    if (location.hash !== '#' + next) location.hash = next
    window.scrollTo({ top: 0 })
  }

  function selectProject(id: string) {
    setActiveId(id)
    try { localStorage.setItem(PROJECT_KEY, id) } catch { /* The session can still switch projects. */ }
    setDocumentId(undefined)
    navigate('dashboard')
    setDialog(null)
  }

  function updateProject(next: Project) {
    update({ ...workspace, projects: workspace.projects.map((item) => item.id === next.id ? next : item) })
  }

  function saveProject(entry: Pick<Project, 'name' | 'code' | 'owner' | 'description'>) {
    if (mode === 'loading') return
    if (dialog === 'edit-project' && project) {
      updateProject({ ...project, ...entry })
      setDialog(null)
      setNotice('Project details saved.')
    } else {
      const next = createProject(entry)
      update({ ...workspace, projects: [...workspace.projects, next] })
      selectProject(next.id)
      setNotice('Project created with the standard APQP document set.')
    }
  }

  function removeProject() {
    if (!project) return
    const projects = workspace.projects.filter((item) => item.id !== project.id)
    update({ ...workspace, projects })
    selectProject(projects[0]?.id ?? '')
    setNotice('Project deleted.')
  }

  function exportWorkspace() {
    const blob = new Blob([JSON.stringify(workspace) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `gatekeeper-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Workspace exported.')
  }

  async function prepareImport(file: File | undefined) {
    if (!file) return
    setImportError('')
    setPendingImport(null)
    if (file.size > 64 * 1024 * 1024) {
      setImportError('Choose a backup smaller than 64 MB.')
      return
    }
    try {
      const parsed = workspaceSchema.safeParse(JSON.parse(await file.text()))
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid workspace.')
      setPendingImport({ name: file.name, workspace: parsed.data })
    } catch (error) {
      setImportError(`Invalid Gatekeeper backup. ${error instanceof Error ? error.message : ''}`)
    }
  }

  function confirmImport() {
    if (!pendingImport) return
    update(pendingImport.workspace)
    selectProject(pendingImport.workspace.projects[0]?.id ?? '')
    setPendingImport(null)
    setNotice('Workspace imported.')
  }

  const query = search.trim().toLowerCase()
  const matchedDocuments = project?.documents.filter((item) => !query ||
    [item.code, item.title, item.owner].some((value) => value.toLowerCase().includes(query))).slice(0, 7) ?? []
  const matchedViews = query ? navigation.filter((item) => item.label.toLowerCase().includes(query)) : []
  const blocked = Boolean(storage.saveError?.conflict)
  const content = project && {
    dashboard: <Dashboard project={project} onNavigate={navigate} onOpenDocument={setDocumentId} />,
    documents: <Documents project={project} onOpen={setDocumentId} onCreate={() => setDocumentId(null)} />,
    rtm: <RTMTable project={project} onChange={updateProject} />,
    dvpr: <DVPRTracker project={project} onChange={updateProject} />,
    gates: <GateReviews key={gateId} project={project} initialGate={gateId} onChange={updateProject} onOpenDocument={setDocumentId} />,
  }[view]

  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation">
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={23} strokeWidth={2.2} /></div>
          <div><span>Gatekeeper</span><small>ENGINEERING WORKSPACE</small></div>
          <button type="button" className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={19} /></button>
        </div>

        <button type="button" className="project-switcher" onClick={() => open('projects')}>
          <div className="project-mark"><Factory size={18} strokeWidth={1.8} /></div>
          <span><strong>{project?.name ?? 'Projects'}</strong><small>{project?.code ?? 'Select or create a project'}</small></span>
          <ChevronsUpDown size={16} className="project-chevron" />
        </button>

        <div className="nav-label">PROGRAM WORKSPACE</div>
        <nav className="side-nav">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={view === id ? 'nav-active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}>
              <Icon size={18} strokeWidth={1.8} />{label}{view === id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <nav className="side-nav" aria-label="Workspace settings">
            <button type="button" onClick={() => open('projects')}><FolderKanban size={18} strokeWidth={1.8} />Manage projects</button>
            <button type="button" onClick={() => open('data')}><Settings2 size={18} strokeWidth={1.8} />Data & settings</button>
            <button type="button" onClick={() => open('help')}><CircleHelp size={18} strokeWidth={1.8} />Workspace guide</button>
          </nav>
          <div className="sidebar-person">
            <div className="avatar">{initials(project?.owner ?? '')}</div>
            <div><strong>{project?.owner || 'Workspace'}</strong><span>Program owner</span></div>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21} /></button>
            <span className="breadcrumb-home">Workspace</span>
            <ChevronRight size={14} className="breadcrumb-home" />
            <span className="breadcrumb-id">{project?.code ?? 'Projects'}</span>
            <ChevronRight size={14} className="breadcrumb-page" />
            <strong className="breadcrumb-page">{navigation.find((item) => item.id === view)?.label}</strong>
          </div>
          <div className="top-tools">
            <button type="button" className="search-trigger" aria-label="Search workspace" onClick={() => open('search')}>
              <Search size={17} /><span>Search workspace</span><kbd>⌘ K</kbd>
            </button>
            <button type="button" className="storage-indicator" onClick={() => open('data')} title="Storage settings">
              <span className={`connection-dot ${storage.saveError || storage.connectionError ? 'connection-error' : ''}`} />
              <span>{mode === 'server' ? storage.saving ? 'Saving' : 'PostgreSQL' : mode === 'local' ? 'Browser storage' : 'Connecting'}</span>
              <ChevronDown size={13} />
            </button>
          </div>
        </header>

        <main className="content" id="main-content">
          {storage.saveError && <div className="notice-bar" role="alert">
            <span>{storage.saveError.message}</span>
            <div className="notice-actions">
              <button className="button secondary small-button" onClick={() => open('keep-draft')}>Keep draft in browser</button>
              {blocked
                ? <button className="button secondary small-button" onClick={storage.resolveConflict}>Load shared copy</button>
                : <button className="button secondary small-button" onClick={storage.retrySave}>Retry save</button>}
            </div>
          </div>}
          {mode === 'local' && storage.localWarning && <div className="notice-bar" role="status">{storage.localWarning}</div>}
          {mode === 'loading' ? (
            <section className="panel">
              <EmptyState title={storage.connectionError ? 'Shared workspace unavailable' : 'Opening workspace'}
                description={storage.connectionError || 'Checking the configured storage connection.'}
                action={storage.connectionError && <div className="inline-actions">
                  <button className="button secondary" onClick={() => storage.useLocal()}>Use browser storage</button>
                  <button className="button primary" onClick={() => void storage.useServer()} disabled={storage.connecting}>Retry connection</button>
                </div>} />
            </section>
          ) : content ? <div key={project.id + view}>{content}</div> : (
            <>
              <PageHeading eyebrow="WORKSPACE" title="Projects" description="Run document control, traceability and gate reviews for every development program." />
              <section className="panel"><EmptyState title="Create a project" description="Each project starts with the standard APQP document set."
                action={<button className="button primary" onClick={() => open('new-project')}><Plus size={17} /> New project</button>} /></section>
            </>
          )}
        </main>
      </div>

      {project && documentId !== undefined && <DocumentModal key={project.id + (documentId ?? 'new')}
        project={project} documentId={documentId} onClose={() => setDocumentId(undefined)} onOpen={setDocumentId} onChange={updateProject} />}

      {dialog === 'projects' && <Modal title="Manage projects" description="Switch between independent APQP program workspaces." onClose={() => setDialog(null)}>
        <div className="project-list">
          {workspace.projects.map((item) => <button type="button" className="project-list-row" key={item.id} onClick={() => selectProject(item.id)}>
            <div className="list-icon"><FolderKanban size={20} /></div>
            <span><strong>{item.name}</strong><small>{item.code}{item.owner ? ' · ' + item.owner : ''}</small></span>
            {item.id === project?.id ? <Check size={19} className="text-green" /> : <ChevronRight size={18} />}
          </button>)}
        </div>
        <div className="form-actions">
          {project && <button className="button secondary" disabled={mode === 'loading'} onClick={() => open('edit-project')}>Edit current project</button>}
          <button className="button primary" disabled={mode === 'loading'} onClick={() => open('new-project')}><Plus size={17} /> New project</button>
        </div>
      </Modal>}

      {(dialog === 'new-project' || dialog === 'edit-project') && <ProjectForm
        project={dialog === 'edit-project' ? project : undefined}
        existingCodes={workspace.projects.filter((item) => dialog !== 'edit-project' || item.id !== project?.id).map((item) => item.code)}
        onClose={() => setDialog(null)} onSave={saveProject} onDelete={removeProject}
      />}

      {dialog === 'keep-draft' && <Modal title="Keep the shared draft in this browser"
        description="This replaces the workspace currently saved in this browser. The shared database keeps its latest saved version." onClose={() => setDialog(null)}>
        <div className="form-actions">
          <button className="button secondary" onClick={() => setDialog(null)}>Cancel</button>
          <button className="button secondary" onClick={exportWorkspace}><Download size={17} /> Export draft</button>
          <button className="button primary" onClick={() => { storage.useLocal(true); setDialog(null) }}>Replace browser workspace</button>
        </div>
      </Modal>}

      {dialog === 'data' && <Modal title="Data & settings" description="Select the storage mode or move a workspace using a JSON backup." onClose={() => setDialog(null)}>
        <div className="storage-options">
          <button type="button" className={`storage-option ${mode === 'local' ? 'option-selected' : ''}`}
            disabled={storage.saving || storage.connecting || (mode === 'server' && storage.dirty)}
            onClick={() => storage.useLocal()}>
            <div className="list-icon"><HardDrive size={21} /></div><span><strong>Browser storage</strong><small>Saved in this browser. Works without a database.</small></span>
            {mode === 'local' && <Check size={19} className="text-green" />}
          </button>
          <button type="button" className={`storage-option ${mode === 'server' ? 'option-selected' : ''}`}
            disabled={storage.connecting || mode === 'server'} onClick={() => void storage.useServer()}>
            <div className="list-icon"><Database size={21} /></div><span><strong>PostgreSQL</strong><small>{storage.serverAvailable === false ? 'Server unavailable · retry connection' : 'Shared workspace stored on the application server.'}</small></span>
            {mode === 'server' && <Check size={19} className="text-green" />}
          </button>
        </div>
        {storage.connectionError && <p role="alert" className="form-error">{storage.connectionError}</p>}
        <div className="settings-backup">
          <h3>Workspace backup</h3>
          <p className="muted">Move projects between browsers and PostgreSQL. Import replaces the workspace in the active storage mode.</p>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={exportWorkspace}><Download size={17} /> Export JSON</button>
            <button type="button" className="button secondary" disabled={mode === 'loading' || blocked} onClick={() => fileInput.current?.click()}><Upload size={17} /> Import JSON</button>
            <input className="sr-only" tabIndex={-1} ref={fileInput} type="file" accept=".json,application/json" onChange={(event) => {
              void prepareImport(event.currentTarget.files?.[0])
              event.currentTarget.value = ''
            }} />
          </div>
          {importError && <p className="form-error" role="alert">{importError}</p>}
          {pendingImport && <div className="notice-bar import-confirm">
            <span><strong>{pendingImport.name}</strong> contains {pendingImport.workspace.projects.length} project(s). Replace the active workspace?</span>
            <button className="button primary" onClick={confirmImport}>Replace workspace</button>
          </div>}
        </div>
      </Modal>}

      {dialog === 'search' && <Modal title="Search workspace" onClose={() => setDialog(null)}>
        <label className="search-field"><Search size={19} /><input autoFocus className="input" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="Search documents or modules" aria-label="Search documents or modules" /></label>
        <div className="project-list search-results">
          {matchedViews.map((item) => <button className="project-list-row" type="button" key={item.id} onClick={() => { navigate(item.id); setDialog(null) }}>
            <div className="list-icon"><item.icon size={19} /></div><span><strong>{item.label}</strong><small>Workspace module</small></span><ArrowRight size={17} />
          </button>)}
          {matchedDocuments.map((item) => <button className="project-list-row" type="button" key={item.id} onClick={() => { setDialog(null); setDocumentId(item.id) }}>
            <div className="list-icon"><FileText size={19} /></div><span><strong>{item.title}</strong><small>{item.code} · {item.status}</small></span><ArrowRight size={17} />
          </button>)}
          {!matchedDocuments.length && !matchedViews.length && <EmptyState title="No matches" description="Try a document code or a module name." />}
        </div>
      </Modal>}

      {dialog === 'help' && <Modal title="Workspace guide" description="Run the APQP lifecycle from planning through production." onClose={() => setDialog(null)}>
        <div className="help-list">
          <p><BookOpen size={19} /><span><strong>Control documents</strong>Use the repository to edit metadata, record revisions, and link related work.</span></p>
          <p><GitBranch size={19} /><span><strong>Establish traceability</strong>Link a system requirement to a DFMEA failure mode, then link a DVP&R test to that mode.</span></p>
          <p><FlaskConical size={19} /><span><strong>Record verification</strong>A requirement passes when all the tests linked through its failure modes pass. Any failed test marks it failed.</span></p>
          <p><List size={19} /><span><strong>Review a gate</strong>Approve or release its mandatory documents before recording sign-off.</span></p>
        </div>
      </Modal>}

      {notice && <div className="toast" role="status"><Check size={18} />{notice}</div>}
    </div>
  )
}

function ProjectForm({ project, existingCodes, onClose, onSave, onDelete }: {
  project?: Project
  existingCodes: string[]
  onClose: () => void
  onSave: (project: Pick<Project, 'name' | 'code' | 'owner' | 'description'>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [code, setCode] = useState(project?.code ?? '')
  const [owner, setOwner] = useState(project?.owner ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [error, setError] = useState('')
  const [deleteText, setDeleteText] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedCode = code.trim().toUpperCase()
    if (!name.trim() || !trimmedCode || !owner.trim()) {
      setError('Enter a project name, code, and owner.')
      return
    }
    if (existingCodes.some((value) => value.toUpperCase() === trimmedCode)) {
      setError('That project code is already in use.')
      return
    }
    onSave({ name: name.trim(), code: trimmedCode, owner: owner.trim(), description: description.trim() })
  }

  return <Modal title={project ? 'Edit project' : 'New project'}
    description={project ? project.code : 'Start with the standard APQP document set.'} onClose={onClose}>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="field field-wide">Project name<input autoFocus className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
        <label className="field">Project code<input className="input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="PRG-025" required maxLength={32} /></label>
        <label className="field">Program owner<input className="input" value={owner} onChange={(event) => setOwner(event.target.value)} required maxLength={100} /></label>
        <label className="field field-wide">Description<textarea className="input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {project && <button className="button ghost delete-project" type="button" onClick={() => setDeleteText('')}>Delete project</button>}
        <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit">{project ? 'Save changes' : 'Create project'}</button>
      </div>
      {project && deleteText !== null && <div className="notice-bar import-confirm">
        <label className="field">Type {project.code} to delete this project and all its records.
          <input className="input" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} />
        </label>
        <button className="button danger" type="button" disabled={deleteText !== project.code} onClick={onDelete}>Delete permanently</button>
      </div>}
    </form>
  </Modal>
}
