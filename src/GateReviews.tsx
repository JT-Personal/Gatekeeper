import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  ClipboardCheck,
  FileText,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { formatDate, gateProgress, gates, isDocumentApproved } from './domain'
import type { GateId, Project } from './domain'
import { GateProgressBar, GateStateBadge } from './Dashboard'
import { Badge, EmptyState, Modal, PageHeading } from './ui'
import './gate-dashboard.css'

interface GateReviewsProps {
  project: Project
  initialGate?: GateId
  onChange: (project: Project) => void
  onOpenDocument: (id: string) => void
}

export default function GateReviews({ project, initialGate, onChange, onOpenDocument }: GateReviewsProps) {
  const [selectedGate, setSelectedGate] = useState<GateId | undefined>(initialGate)
  const [dialog, setDialog] = useState<'signoff' | 'reopen' | null>(null)
  const [reviewer, setReviewer] = useState('')
  const [note, setNote] = useState('')

  const stages = gates.map((gate) => ({ gate, progress: gateProgress(project, gate.id) }))
  const firstOpen = stages.find(({ progress }) => !progress.signedOff || !progress.ready)
  const selected = stages.find(({ gate }) => gate.id === selectedGate) ?? firstOpen ?? stages[stages.length - 1]
  const { gate, progress } = selected
  const requiredDocuments = progress.documents.filter((document) => document.mandatory)
  const signoff = project.signoffs.find((record) => record.gate === gate.id)
  const blocked = progress.total - progress.approved

  function openSignoff() {
    setReviewer('')
    setNote('')
    setDialog('signoff')
  }

  function recordSignoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = reviewer.trim()
    if (!progress.ready || signoff || !name) return

    onChange({
      ...project,
      signoffs: [...project.signoffs, { gate: gate.id, by: name, at: new Date().toISOString(), note: note.trim() }],
    })
    setSelectedGate(gate.id)
    setDialog(null)
  }

  function reopenGate() {
    onChange({ ...project, signoffs: project.signoffs.filter((record) => record.gate !== gate.id) })
    setSelectedGate(gate.id)
    setDialog(null)
  }

  return (
    <div className="gate-review-view">
      <PageHeading
        eyebrow={project.code}
        title="Gate reviews"
        description="Review mandatory documents and record sign-off as each development phase becomes ready."
      />

      <div className="gate-review-stages" aria-label="Development gates">
        {stages.map(({ gate: stage, progress: status }) => (
          <button
            type="button"
            key={stage.id}
            className="panel gate-review-stage"
            aria-pressed={stage.id === gate.id}
            onClick={() => setSelectedGate(stage.id)}
          >
            <span className="gate-review-stage-top">
              <span>Gate {stage.id}</span>
              {status.signedOff && status.ready && <Check size={15} aria-label="Signed off" />}
            </span>
            <strong>{stage.name}</strong>
            <GateProgressBar value={status.percent} label={`Gate ${stage.id} document readiness`} />
          </button>
        ))}
      </div>

      <div className="gate-review-layout">
        <section className="panel gate-review-checklist" aria-labelledby="gate-checklist-heading">
          <div className="dashboard-panel-heading">
            <div>
              <span className="gate-panel-eyebrow">GATE {String(gate.id).padStart(2, '0')}</span>
              <h2 id="gate-checklist-heading">{gate.name}</h2>
              <p>{gate.description}</p>
            </div>
            <GateStateBadge progress={progress} />
          </div>
          <div className="gate-checklist-label">Mandatory documents</div>
          {requiredDocuments.length ? (
            <div className="table-scroll">
              <table className="data-table gate-checklist-table">
                <thead>
                  <tr><th scope="col">Document</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Approval</th></tr>
                </thead>
                <tbody>
                  {requiredDocuments.map((document) => {
                    const approved = isDocumentApproved(document)
                    return (
                      <tr key={document.id}>
                        <td>
                          <button className="gate-document-link" type="button" onClick={() => onOpenDocument(document.id)}>
                            <span className="dashboard-document-icon"><FileText size={17} aria-hidden="true" /></span>
                            <span className="gate-document-text">
                              <span className="mono">{document.code}</span>
                              <strong>{document.title}</strong>
                            </span>
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </button>
                        </td>
                        <td>{document.owner || 'Unassigned'}</td>
                        <td><Badge status={document.status} /></td>
                        <td>
                          <span className="gate-document-approval" data-approved={approved}>
                            {approved ? <Check size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
                            {approved ? 'Complete' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No mandatory documents" description="Add a mandatory document to this gate in the repository to enable sign-off." />
          )}
        </section>

        <section className="panel gate-review-summary" aria-labelledby="gate-signoff-heading">
          <span className="gate-review-summary-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
          <h2 id="gate-signoff-heading">Gate sign-off</h2>
          <div className="gate-review-summary-count"><strong>{progress.approved}</strong> / {progress.total}</div>
          <p>Mandatory documents approved or released</p>
          <GateProgressBar value={progress.percent} label="Mandatory document approval" />
          {signoff ? (
            <>
              {!progress.ready && (
                <div className="gate-review-message" data-tone="warning">
                  <CircleAlert size={17} aria-hidden="true" />
                  <span>Document approval is incomplete. Review the checklist to restore gate readiness.</span>
                </div>
              )}
              <dl className="gate-signoff-record">
                <div><dt>Signed by</dt><dd>{signoff.by}</dd></div>
                <div><dt>Signed on</dt><dd>{formatDate(signoff.at)}</dd></div>
                {signoff.note && <div><dt>Review note</dt><dd>{signoff.note}</dd></div>}
              </dl>
              <button type="button" className="button secondary" onClick={() => setDialog('reopen')}>
                <RotateCcw size={16} aria-hidden="true" /> Reopen gate
              </button>
            </>
          ) : (
            <>
              <div className="gate-review-message" data-tone={progress.ready ? 'ready' : 'warning'}>
                {progress.ready ? <Check size={17} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}
                <span>{gateReviewMessage(progress.ready, blocked)}</span>
              </div>
              <button type="button" className="button primary" onClick={openSignoff} disabled={!progress.ready}>
                <ClipboardCheck size={17} aria-hidden="true" /> Sign off gate
              </button>
            </>
          )}
        </section>
      </div>

      {dialog === 'signoff' && (
        <Modal title={`Sign off Gate ${gate.id}`} description={gate.name} onClose={() => setDialog(null)}>
          <form className="gate-signoff-form" onSubmit={recordSignoff}>
            <label className="field">
              <span>Reviewer name</span>
              <input className="input" value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={120} required autoFocus />
            </label>
            <label className="field">
              <span>Review note <span className="muted">(optional)</span></span>
              <textarea className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} />
            </label>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setDialog(null)}>Cancel</button>
              <button type="submit" className="button primary" disabled={!reviewer.trim() || !progress.ready}>Record sign-off</button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'reopen' && (
        <Modal title={`Reopen Gate ${gate.id}?`} onClose={() => setDialog(null)}>
          <div className="gate-signoff-form">
            <p className="muted">Reopening removes the recorded sign-off and returns the gate to review.</p>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setDialog(null)}>Cancel</button>
              <button type="button" className="button primary" onClick={reopenGate}>Reopen gate</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function gateReviewMessage(ready: boolean, blocked: number) {
  if (ready) return 'All mandatory documents are ready for sign-off.'
  if (blocked === 0) return 'Add a mandatory document to enable sign-off.'
  return blocked === 1 ? '1 mandatory document needs approval.' : `${blocked} mandatory documents need approval.`
}
