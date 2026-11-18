import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ClipboardCheck,
  FileCheck2,
  FileText,
  GitPullRequest,
  Layers3,
  ListChecks,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  formatDate,
  gateProgress,
  gates,
  isDocumentApproved,
  verificationStatus,
} from './domain'
import type { GateId, Project } from './domain'
import { Badge, PageHeading } from './ui'
import './gate-dashboard.css'

type View = 'dashboard' | 'documents' | 'rtm' | 'dvpr' | 'gates'

interface DashboardProps {
  project: Project
  onNavigate: (view: View, gate?: GateId) => void
  onOpenDocument: (id: string) => void
}

type GateProgress = ReturnType<typeof gateProgress>

function gateState(progress: GateProgress) {
  if (progress.signedOff && progress.ready) return 'Signed off'
  if (progress.signedOff) return 'Review required'
  if (progress.ready) return 'Ready for review'
  if (progress.approved > 0) return 'In progress'
  return 'Not started'
}

export function GateStateBadge({ progress }: { progress: GateProgress }) {
  const state = gateState(progress)
  return (
    <span className="gate-state-badge" data-state={state}>
      {state === 'Signed off' ? <Check size={13} aria-hidden="true" /> : <span aria-hidden="true" />}
      {state}
    </span>
  )
}

export function GateProgressBar({
  value,
  label,
}: {
  value: number
  label: string
}) {
  return (
    <span
      className="gate-progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span style={{ width: `${value}%` }} />
    </span>
  )
}

function Metric({
  label,
  value,
  total,
  detail,
  Icon,
  onClick,
}: {
  label: string
  value: number | string
  total?: number
  detail: string
  Icon: LucideIcon
  onClick: () => void
}) {
  return (
    <button type="button" className="panel dashboard-metric" onClick={onClick}>
      <span className="dashboard-metric-top">
        <span className="dashboard-metric-icon"><Icon size={18} aria-hidden="true" /></span>
        <ArrowUpRight size={15} className="dashboard-metric-arrow" aria-hidden="true" />
      </span>
      <span className="dashboard-metric-label">{label}</span>
      <span className="dashboard-metric-value">
        {value}
        {total !== undefined && <span> / {total}</span>}
      </span>
      <span className="dashboard-metric-detail">{detail}</span>
    </button>
  )
}

export default function Dashboard({ project, onNavigate, onOpenDocument }: DashboardProps) {
  const progress = gates.map((gate) => ({ gate, progress: gateProgress(project, gate.id) }))
  const signedOff = progress.filter((item) => item.progress.signedOff && item.progress.ready).length
  const active = progress.find((item) => !item.progress.signedOff || !item.progress.ready) ?? progress[progress.length - 1]
  const allSignedOff = signedOff === gates.length
  const verified = project.requirements.filter((requirement) => verificationStatus(project, requirement) === 'Passed').length
  const approved = project.documents.filter(isDocumentApproved).length
  const openChanges = project.documents.filter((document) =>
    ['CM-001', 'CM-002'].includes(document.code.toUpperCase()) && document.status !== 'Released',
  ).length
  const recentDocuments = [...project.documents]
    .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))
    .slice(0, 5)
  const gatePercent = Math.round(signedOff / gates.length * 100)
  const activeGateNumber = String(active.gate.id).padStart(2, '0')
  const requiredDocuments = project.documents.filter((document) => document.mandatory)
  const heroApprovals = allSignedOff
    ? { approved: requiredDocuments.filter(isDocumentApproved).length, total: requiredDocuments.length, percent: 100 }
    : active.progress

  return (
    <div className="dashboard-view">
      <PageHeading
        eyebrow={project.code}
        title={project.name}
        description={project.description}
        actions={
          <>
            <button className="button secondary" type="button" onClick={() => onNavigate('documents')}>
              <FileText size={16} aria-hidden="true" /> Documents
            </button>
            <button className="button primary" type="button" onClick={() => onNavigate('gates', active.gate.id)}>
              <ClipboardCheck size={17} aria-hidden="true" /> Gate review
            </button>
          </>
        }
      />

      <section className="dashboard-hero" aria-labelledby="dashboard-current-gate">
        <div className="dashboard-hero-art" aria-hidden="true">
          <span className="hero-art-ring hero-art-ring-outer" />
          <span className="hero-art-ring hero-art-ring-middle" />
          <span className="hero-art-ring hero-art-ring-inner" />
          <span className="hero-art-marker"><ArrowDownRight size={21} strokeWidth={1.25} /></span>
        </div>
        <div className="dashboard-hero-main">
          <span className="dashboard-hero-label">
            <span className="dashboard-hero-status-dot" aria-hidden="true" />
            {allSignedOff ? 'PROGRAM STATUS' : 'CURRENT PHASE'}
            {!allSignedOff && <span className="dashboard-hero-gate-mobile"> · GATE {activeGateNumber}</span>}
          </span>
          <h2 id="dashboard-current-gate">
            {allSignedOff ? 'All gates signed off' : active.gate.name}
          </h2>
          <p>{allSignedOff ? 'All required gate documents are approved or released.' : active.gate.description}</p>
          <div className="dashboard-hero-readiness">
            <div>
              <span>Document readiness</span>
              <strong>{heroApprovals.approved} of {heroApprovals.total} approved</strong>
            </div>
            <GateProgressBar value={heroApprovals.percent} label={allSignedOff ? 'Program document readiness' : `Gate ${active.gate.id} document readiness`} />
          </div>
        </div>
        <div className="dashboard-hero-phase" aria-hidden={allSignedOff || undefined}>
          <span>{allSignedOff ? <Check size={62} strokeWidth={1.5} /> : activeGateNumber}</span>
          <span>{allSignedOff ? `${gates.length} / ${gates.length} SIGNED OFF` : `OF ${String(gates.length).padStart(2, '0')} GATES`}</span>
        </div>
      </section>

      <section className="dashboard-metrics" aria-label="Program metrics">
        <Metric label="Requirements verified" value={verified} total={project.requirements.length} detail="Passed verification" Icon={ListChecks} onClick={() => onNavigate('rtm')} />
        <Metric label="Documents approved" value={approved} total={project.documents.length} detail="Approved or released" Icon={FileCheck2} onClick={() => onNavigate('documents')} />
        <Metric label="Gate completion" value={`${gatePercent}%`} detail={`${signedOff} of ${gates.length} gates signed off`} Icon={Layers3} onClick={() => onNavigate('gates')} />
        <Metric label="Open changes" value={openChanges} detail="CM-001 and CM-002" Icon={GitPullRequest} onClick={() => onNavigate('documents')} />
      </section>

      <div className="dashboard-detail-grid">
        <section className="panel dashboard-detail-panel" aria-labelledby="dashboard-gate-readiness">
          <div className="dashboard-panel-heading">
            <div>
              <h2 id="dashboard-gate-readiness">Gate readiness</h2>
              <p>Mandatory document approvals by phase</p>
            </div>
            <button className="dashboard-panel-link" type="button" onClick={() => onNavigate('gates')}>
              Review <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="dashboard-gate-list">
            {progress.map(({ gate, progress: item }) => (
              <button className="dashboard-gate-row" type="button" key={gate.id} onClick={() => onNavigate('gates', gate.id)}>
                <span className="dashboard-gate-number">{String(gate.id).padStart(2, '0')}</span>
                <span className="dashboard-gate-name">
                  <strong>{gate.name}</strong>
                  <span>{item.approved} of {item.total} approved</span>
                </span>
                <GateProgressBar value={item.percent} label={`Gate ${gate.id} readiness`} />
                <GateStateBadge progress={item} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel dashboard-detail-panel" aria-labelledby="dashboard-recent-documents">
          <div className="dashboard-panel-heading">
            <div>
              <h2 id="dashboard-recent-documents">Recent documents</h2>
              <p>Latest updates across all gates</p>
            </div>
            <button className="dashboard-panel-link" type="button" onClick={() => onNavigate('documents')}>
              View all <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="dashboard-document-list">
            {recentDocuments.map((document) => (
              <button className="dashboard-document-row" type="button" key={document.id} onClick={() => onOpenDocument(document.id)}>
                <span className="dashboard-document-icon"><FileText size={17} aria-hidden="true" /></span>
                <span className="dashboard-document-name">
                  <strong>{document.title}</strong>
                  <span><span className="mono">{document.code}</span> · {formatDate(document.updatedAt)}</span>
                </span>
                <Badge status={document.status} />
              </button>
            ))}
            {recentDocuments.length === 0 && <p className="dashboard-empty-documents">No documents have been added to this project.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
