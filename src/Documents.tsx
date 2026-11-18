import { useState } from 'react';
import { ArrowUpRight, FileText, Plus, Search } from 'lucide-react';
import { documentStatuses, formatDate, gates } from './domain';
import type { DocumentStatus, GateId, Project } from './domain';
import { Badge, EmptyState, PageHeading } from './ui';
import './documents.css';

interface DocumentsProps {
  project: Project;
  onCreate: () => void;
  onOpen: (id: string) => void;
}

export default function Documents({ project, onCreate, onOpen }: DocumentsProps) {
  const [search, setSearch] = useState('');
  const [gate, setGate] = useState('');
  const [status, setStatus] = useState('');
  const query = search.trim().toLowerCase();
  const filtered = project.documents.filter((document) => {
    const text = [document.code, document.title, document.owner, document.description].join(' ').toLowerCase();
    return text.includes(query)
      && (!gate || document.gates.includes(Number(gate) as GateId))
      && (!status || document.status === (status as DocumentStatus));
  });
  const clearFilters = () => {
    setSearch('');
    setGate('');
    setStatus('');
  };

  return (
    <div className="document-page">
      <PageHeading
        title="Documents"
        description="Manage program documents, revisions, and approval status across APQP gates."
        actions={<button type="button" className="button primary" onClick={onCreate}><Plus size={16} /> New document</button>}
      />
      <section className="panel document-repository" aria-label="Document repository">
        <div className="toolbar document-toolbar">
          <label className="document-search">
            <Search size={16} aria-hidden="true" />
            <input
              className="input"
              type="search"
              aria-label="Search documents"
              placeholder="Search documents…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select className="input document-filter" aria-label="Filter documents by gate" value={gate} onChange={(event) => setGate(event.target.value)}>
            <option value="">All gates</option>
            {gates.map(({ id, name }) => <option key={id} value={id}>Gate {id} · {name}</option>)}
          </select>
          <select className="input document-filter" aria-label="Filter documents by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {documentStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <span className="muted document-count" role="status">
            {filtered.length === project.documents.length
              ? `${filtered.length} documents`
              : `${filtered.length} of ${project.documents.length} documents`}
          </span>
        </div>
        {filtered.length > 0 ? (
          <div className="table-scroll document-table-scroll">
            <table className="data-table document-table">
              <thead>
                <tr><th>Document</th><th>Gate</th><th>Owner</th><th>Version</th><th>Status</th><th>Updated</th><th><span className="document-visually-hidden">Open</span></th></tr>
              </thead>
              <tbody>
                {filtered.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <button type="button" className="document-entry" onClick={() => onOpen(document.id)}>
                        <span className="document-file-icon"><FileText size={17} aria-hidden="true" /></span>
                        <span className="document-entry-text">
                          <strong>{document.title}</strong>
                          <span className="mono muted">{document.code}</span>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="chip" title={document.gates.map((id) => `Gate ${id}`).join(', ')}>Gate {document.gate}{document.gates.length > 1 && ` +${document.gates.length - 1}`}</span>
                    </td>
                    <td>{document.owner || <span className="muted">Unassigned</span>}</td>
                    <td><span className="mono">{document.version}</span></td>
                    <td><Badge status={document.status} /></td>
                    <td>{formatDate(document.updatedAt)}</td>
                    <td>
                      <button type="button" className="icon-button" aria-label={`Open ${document.code}`} onClick={() => onOpen(document.id)}><ArrowUpRight size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={project.documents.length ? 'No matching documents' : 'No documents yet'}
            description={project.documents.length ? 'Try a different search or filter.' : 'Add a document to start building your program repository.'}
            action={project.documents.length
              ? <button type="button" className="button secondary" onClick={clearFilters}>Clear filters</button>
              : <button type="button" className="button primary" onClick={onCreate}><Plus size={16} /> New document</button>}
          />
        )}
      </section>
    </div>
  );
}
