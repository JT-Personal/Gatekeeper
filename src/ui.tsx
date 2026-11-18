import { useEffect, useId, useRef, type ReactNode } from 'react'
import { AlertCircle, Check, Circle, Clock3, FolderOpen, X } from 'lucide-react'

export function Badge({ status }: { status: string }) {
  const tone = {
    Approved: 'positive',
    Released: 'positive',
    Passed: 'positive',
    'Signed off': 'positive',
    Ready: 'positive',
    'In Review': 'review',
    'In Progress': 'review',
    'In progress': 'review',
    Failed: 'negative',
    Blocked: 'negative',
  }[status] ?? 'neutral'
  const Icon = tone === 'positive' ? Check : tone === 'review' ? Clock3 : tone === 'negative' ? AlertCircle : Circle
  return <span className={`badge badge-${tone}`}><Icon size={13} aria-hidden="true" />{status}</span>
}

export function Modal({ title, description, onClose, children }: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const detail = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      className="modal"
      ref={ref}
      aria-labelledby={heading}
      aria-describedby={description ? detail : undefined}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <div>
            <h2 id={heading}>{title}</h2>
            {description && <p className="muted" id={detail}>{description}</p>}
          </div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </dialog>
  )
}

export function PageHeading({ eyebrow, title, description, actions }: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function EmptyState({ title, description, action }: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><FolderOpen size={24} strokeWidth={1.65} /></div>
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {action}
    </div>
  )
}
