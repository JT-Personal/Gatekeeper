import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Clock3, FileText, Link2, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { documentStatuses, formatDate, gates, getRequirementTests, newId, verificationStatus } from './domain';
import type { Attachment, DocumentRecord, DocumentStatus, GateId, Project } from './domain';
import { Badge, Modal } from './ui';
import './documents.css';

interface DocumentModalProps {
  project: Project;
  documentId: string | null;
  onChange: (project: Project) => void;
  onClose: () => void;
  onOpen: (id: string) => void;
}

type Tab = 'Overview' | 'Traceability' | 'Revision history';

const tabs: Tab[] = ['Overview', 'Traceability', 'Revision history'];
const traceabilityCodes = ['SE-001', 'SE-002', 'EN-002', 'EN-004'] as const;

function newDocument(): DocumentRecord {
  return {
    id: newId(),
    code: '',
    title: '',
    owner: '',
    version: '0.1',
    gate: 1,
    gates: [1],
    status: 'Draft',
    mandatory: true,
    description: '',
    attachments: [],
    links: [],
    revisions: [],
    updatedAt: new Date().toISOString(),
  };
}

export default function DocumentModal(props: DocumentModalProps) {
  return <DocumentDetail key={`${props.project.id}/${props.documentId ?? 'new'}`} {...props} />;
}

function DocumentDetail({ project, documentId, onChange, onClose, onOpen }: DocumentModalProps) {
  const document = project.documents.find(({ id }) => id === documentId);
  const [tab, setTab] = useState<Tab>('Overview');
  const [draft, setDraft] = useState<DocumentRecord | null>(() => documentId === null ? newDocument() : null);
  const [revisionNote, setRevisionNote] = useState('');
  const [error, setError] = useState('');

  if (documentId !== null && !document) {
    return <Modal title="Document unavailable" onClose={onClose}><p>This document no longer exists in this project.</p></Modal>;
  }

  function startEditing() {
    if (!document) return;
    setDraft(document);
    setRevisionNote('');
    setError('');
  }

  function updateDraft(changes: Partial<DocumentRecord>) {
    setDraft((current) => current ? { ...current, ...changes } : current);
  }

  function addAttachment(files: FileList | null) {
    if (!files?.length) return;
    const attachments = Array.from(files, ({ name, size }) => ({ name: name.trim(), size }));
    if (attachments.some(({ name }) => !name || name.length > 200)) {
      setError('Use attachment file names between 1 and 200 characters.');
      return;
    }
    setError('');
    setDraft((current) => current ? {
      ...current,
      attachments: [...current.attachments, ...attachments],
    } : current);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    const title = draft.title.trim();
    const version = draft.version.trim();
    if (!code || !title || !version) {
      setError('Enter a document ID, title, and version.');
      return;
    }
    if (code.length > 40) {
      setError('Use a document ID of 40 characters or fewer.');
      return;
    }
    if (project.documents.some((existing) => existing.id !== draft.id && existing.code.toUpperCase() === code)) {
      setError('Another document already uses this ID.');
      return;
    }
    const at = new Date().toISOString();
    const note = revisionNote.trim() || (document
      ? document.status === draft.status ? 'Updated document details.' : `Changed status from ${document.status} to ${draft.status}.`
      : 'Created document.');
    const saved: DocumentRecord = {
      ...draft,
      code,
      title,
      version,
      owner: draft.owner.trim(),
      description: draft.description.trim(),
      updatedAt: at,
      revisions: [{ id: newId(), version, at, note }, ...draft.revisions],
    };
    onChange({
      ...project,
      documents: document
        ? project.documents.map((item) => item.id === saved.id ? saved : item)
        : [...project.documents, saved],
    });
    setError('');
    if (document) {
      setDraft(null);
      return;
    }
    onOpen(saved.id);
  }

  if (draft) {
    return (
      <Modal title={document ? `Edit ${document.code}` : 'New document'} onClose={onClose}>
        <form className="document-form" onSubmit={submit}>
          <div className="form-grid">
            <label className="field">Document ID<input required maxLength={40} className="input" value={draft.code} placeholder="EN-006" onChange={(event) => updateDraft({ code: event.target.value })} /></label>
            <label className="field">Title<input required maxLength={200} className="input" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
            <label className="field">Owner<input maxLength={500} className="input" value={draft.owner} onChange={(event) => updateDraft({ owner: event.target.value })} /></label>
            <label className="field">Version<input required maxLength={40} className="input" value={draft.version} onChange={(event) => updateDraft({ version: event.target.value })} /></label>
            <label className="field">Primary gate
              <select className="input" aria-label="Primary gate" value={draft.gate} onChange={(event) => {
                const gate = Number(event.target.value) as GateId;
                const applicable = draft.gates.length === 1
                  ? [gate]
                  : Array.from(new Set([...draft.gates, gate])).sort((left, right) => left - right);
                updateDraft({ gate, gates: applicable });
              }}>
                {gates.map(({ id, name }) => <option key={id} value={id}>Gate {id} · {name}</option>)}
              </select>
            </label>
            <label className="field">Status
              <select className="input" aria-label="Status" value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as DocumentStatus })}>
                {documentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="document-fieldset">
            <legend>Applicable gates</legend>
            <div className="document-gate-options">
              {gates.map(({ id }) => (
                <label key={id} className="document-checkbox">
                  <input
                    type="checkbox"
                    disabled={id === draft.gate}
                    checked={draft.gates.includes(id)}
                    onChange={(event) => updateDraft({
                      gates: event.target.checked ? [...draft.gates, id].sort((left, right) => left - right) : draft.gates.filter((item) => item !== id),
                    })}
                  />
                  Gate {id}
                </label>
              ))}
            </div>
            <label className="document-checkbox document-mandatory-option"><input type="checkbox" checked={draft.mandatory} onChange={(event) => updateDraft({ mandatory: event.target.checked })} /> Required for gate sign-off</label>
          </fieldset>
          <label className="field">Description<textarea className="input" rows={4} maxLength={30000} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} /></label>
          <details className="document-link-picker" open={tab === 'Traceability' ? true : undefined}>
            <summary><Link2 size={15} /> Outgoing document links <span className="muted">{draft.links.length} selected</span></summary>
            <div className="document-link-options">
              {project.documents.filter((item) => item.id !== draft.id).map((item) => (
                <label key={item.id} className="document-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.links.includes(item.id)}
                    onChange={(event) => updateDraft({
                      links: event.target.checked ? [...draft.links, item.id] : draft.links.filter((id) => id !== item.id),
                    })}
                  />
                  <span><span className="mono">{item.code}</span> · {item.title}</span>
                </label>
              ))}
              {!project.documents.some((item) => item.id !== draft.id) && <p className="muted">Add another document to create a link.</p>}
            </div>
          </details>
          <div className="document-attachment-edit">
            <div className="document-edit-label"><strong>Attachments</strong><span className="muted">Only the file name and size are saved.</span></div>
            <AttachmentList attachments={draft.attachments} onRemove={(index) => updateDraft({ attachments: draft.attachments.filter((_, item) => item !== index) })} />
            <label className="button secondary document-file-picker">
              <Plus size={15} /> Add attachment
              <input
                className="document-visually-hidden"
                type="file"
                multiple
                onChange={(event) => {
                  addAttachment(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <label className="field">Revision note<input className="input" maxLength={30000} value={revisionNote} placeholder="Summarize what changed" onChange={(event) => setRevisionNote(event.target.value)} /></label>
          {error && <p className="document-form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="button secondary" type="button" onClick={document ? () => { setDraft(null); setError(''); } : onClose}>Cancel</button>
            <button className="button primary" type="submit">{document ? 'Save changes' : 'Create document'}</button>
          </div>
        </form>
      </Modal>
    );
  }

  if (!document) return null;
  return (
    <Modal title={document.title} description={document.code} onClose={onClose}>
      <div className="document-detail-tools">
        <div className="document-tabs" role="tablist" aria-label="Document details">
          {tabs.map((item, index) => (
            <button
              key={item}
              id={`document-tab-${index}`}
              type="button"
              role="tab"
              tabIndex={item === tab ? 0 : -1}
              aria-selected={tab === item}
              aria-controls="document-tab-panel"
              onClick={() => setTab(item)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const offset = event.key === 'ArrowLeft' ? -1 : 1;
                const next = (index + offset + tabs.length) % tabs.length;
                setTab(tabs[next]);
                event.currentTarget.parentElement?.querySelectorAll('button')[next].focus();
              }}
            >{item}</button>
          ))}
        </div>
        <button type="button" className="button secondary" onClick={startEditing}><Pencil size={14} /> Edit document</button>
      </div>
      <div id="document-tab-panel" role="tabpanel" aria-labelledby={`document-tab-${tabs.indexOf(tab)}`} tabIndex={0} className="document-tab-panel">
        {tab === 'Overview' && <DocumentOverview document={document} />}
        {tab === 'Traceability' && <DocumentTraceability document={document} project={project} onOpen={onOpen} />}
        {tab === 'Revision history' && <RevisionHistory document={document} />}
      </div>
    </Modal>
  );
}

function AttachmentList({ attachments, onRemove }: { attachments: Attachment[]; onRemove?: (index: number) => void }) {
  if (!attachments.length) return <p className="muted document-empty-copy">No attachments added.</p>;
  return <ul className="document-detail-list">
    {attachments.map(({ name, size }, index) => (
      <li key={`${name}-${size}-${index}`}>
        <Paperclip size={16} aria-hidden="true" />
        <span className="document-list-text">{name}<span className="muted">{size < 1024 ? `${size} B` : `${(size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`}</span></span>
        {onRemove && <button className="icon-button" type="button" aria-label={`Remove ${name}`} onClick={() => onRemove(index)}><Trash2 size={15} /></button>}
      </li>
    ))}
  </ul>;
}

function DocumentOverview({ document }: { document: DocumentRecord }) {
  return (
    <>
      <dl className="document-metadata">
        <div><dt>Owner</dt><dd>{document.owner || 'Unassigned'}</dd></div>
        <div><dt>Version</dt><dd className="mono">{document.version}</dd></div>
        <div><dt>Status</dt><dd><Badge status={document.status} /></dd></div>
        <div><dt>Primary gate</dt><dd>Gate {document.gate} · {gates.find(({ id }) => id === document.gate)?.name}</dd></div>
        <div><dt>Applicable gates</dt><dd>{document.gates.map((id) => `Gate ${id}`).join(', ')}</dd></div>
        <div><dt>Gate sign-off</dt><dd>{document.mandatory ? 'Required' : 'Optional'}</dd></div>
      </dl>
      <section className="document-detail-section">
        <h3>Description</h3>
        <p className={document.description ? 'document-description' : 'muted'}>{document.description || 'No description added.'}</p>
      </section>
      <section className="document-detail-section">
        <h3>Attachments</h3>
        <AttachmentList attachments={document.attachments} />
      </section>
    </>
  );
}

function DocumentTraceability({ document, project, onOpen }: { document: DocumentRecord; project: Project; onOpen: (id: string) => void }) {
  const incoming = project.documents.filter((item) => item.links.includes(document.id));
  const outgoing = project.documents.filter((item) => document.links.includes(item.id));
  const role = traceabilityCodes.find((code) => {
    const template = project.documents.find((item) => item.id === `${project.id}:${code.toLowerCase()}`);
    return template ? template.id === document.id : document.code.toUpperCase() === code;
  });

  return (
    <>
      <section className="document-detail-section">
        <h3><ArrowUpRight size={16} /> Outgoing document links</h3>
        <DocumentLinks items={outgoing} onOpen={onOpen} />
      </section>
      <section className="document-detail-section">
        <h3><ArrowDownLeft size={16} /> Incoming document links</h3>
        <DocumentLinks items={incoming} onOpen={onOpen} />
      </section>
      {(role === 'SE-001' || role === 'SE-002') && (
        <section className="document-detail-section">
          <h3>System requirements</h3>
          {project.requirements.length > 0 ? <ul className="document-detail-list">
            {project.requirements.map((requirement) => {
              const tests = getRequirementTests(project, requirement);
              return <li key={requirement.id}>
                <span className="chip mono">{requirement.code}</span>
                <span className="document-list-text">{requirement.title}<span className="muted">{tests.length ? tests.map(({ code }) => code).join(', ') : 'No linked verification tests'}</span></span>
                <Badge status={verificationStatus(project, requirement)} />
              </li>;
            })}
          </ul> : <p className="muted document-empty-copy">No system requirements are recorded.</p>}
        </section>
      )}
      {role === 'EN-002' && (
        <section className="document-detail-section">
          <h3>DFMEA failure modes</h3>
          {project.failureModes.length > 0 ? <ul className="document-detail-list">
            {project.failureModes.map((mode) => {
              const requirements = project.requirements.filter((item) => item.failureModeIds.includes(mode.id));
              const tests = project.tests.filter((item) => item.failureModeIds.includes(mode.id));
              return <li key={mode.id}>
                <span className="chip mono">{mode.code}</span>
                <span className="document-list-text">
                  {mode.title}
                  <span className="muted">Requirements · {requirements.map(({ code }) => code).join(', ') || 'None'}</span>
                  <span className="muted">Tests · {tests.map(({ code }) => code).join(', ') || 'None'}</span>
                </span>
              </li>;
            })}
          </ul> : <p className="muted document-empty-copy">No failure modes are recorded.</p>}
        </section>
      )}
      {role === 'EN-004' && (
        <section className="document-detail-section">
          <h3>DVP&amp;R verification tests</h3>
          {project.tests.length > 0 ? <ul className="document-detail-list">
            {project.tests.map((test) => (
              <li key={test.id}><span className="chip mono">{test.code}</span><span className="document-list-text">{test.title}<span className="muted">{test.acceptance}</span></span><Badge status={test.status} /></li>
            ))}
          </ul> : <p className="muted document-empty-copy">No verification tests are recorded.</p>}
        </section>
      )}
    </>
  );
}

function DocumentLinks({ items, onOpen }: { items: DocumentRecord[]; onOpen: (id: string) => void }) {
  if (!items.length) return <p className="muted document-empty-copy">No documents linked.</p>;
  return <ul className="document-detail-list document-detail-links">
    {items.map((item) => (
      <li key={item.id}>
        <button type="button" onClick={() => onOpen(item.id)}>
          <FileText size={15} aria-hidden="true" />
          <span className="mono">{item.code}</span>
          <span className="document-list-text">{item.title}</span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </li>
    ))}
  </ul>;
}

function RevisionHistory({ document }: { document: DocumentRecord }) {
  const revisions = [...document.revisions].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  if (!revisions.length) return <p className="muted">No revisions recorded.</p>;
  return <ol className="document-history">
    {revisions.map(({ id, version, at, note }) => (
      <li key={id}>
        <span className="document-history-icon"><Clock3 size={15} /></span>
        <div>
          <strong>Version {version}</strong> <time className="muted" dateTime={at}>{formatDate(at)}</time>
          <p>{note}</p>
        </div>
      </li>
    ))}
  </ol>;
}
