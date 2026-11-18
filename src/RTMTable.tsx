import { useState } from 'react';
import type { FormEvent } from 'react';
import { Check, CheckCircle2, CircleDashed, Link2, ListChecks, Plus, ShieldAlert } from 'lucide-react';
import { gates, getRequirementTests, newId, testStatuses, verificationStatus } from './domain';
import type { FailureMode, GateId, Project, Requirement } from './domain';
import { Badge, EmptyState, Modal, PageHeading } from './ui';
import { TestEditor } from './DVPRTracker';
import { codeExists, EditorActions, LinkChecklist, nextCode, readText, RelatedRecords, SearchField } from './TraceControls';
import './verification.css';

type ProjectProps = { project: Project; onChange: (project: Project) => void };
type Editor = { kind: 'requirement' | 'failureMode' | 'test'; id?: string };
type View = 'requirements' | 'failureModes';

function RequirementEditor({
  project, onChange, requirement, onClose,
}: ProjectProps & { requirement?: Requirement; onClose: () => void }) {
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = readText(form, 'code').toUpperCase();
    const title = readText(form, 'title');
    if (!code || !title) return setError('Enter a requirement ID and a title.');
    if (codeExists(project.requirements, code, requirement?.id)) return setError('This requirement ID is already in use.');

    const record: Requirement = {
      id: requirement?.id ?? newId(),
      code,
      title,
      description: readText(form, 'description'),
      owner: readText(form, 'owner'),
      gate: Number(form.get('gate')) as GateId,
      failureModeIds: form.getAll('failureModes').map(String),
    };
    const requirements = requirement
      ? project.requirements.map((item) => item.id === requirement.id ? record : item)
      : [...project.requirements, record];
    onChange({ ...project, requirements });
    onClose();
  }

  function remove() {
    onChange({ ...project, requirements: project.requirements.filter((item) => item.id !== requirement?.id) });
    onClose();
  }

  return (
    <Modal
      title={requirement ? `Edit ${requirement.code}` : 'New requirement'}
      description="SE-001 · System Requirements Specification"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field">Requirement ID
            <input className="input" name="code" defaultValue={requirement?.code ?? nextCode(project.requirements, 'REQ-')} maxLength={40} required />
          </label>
          <label className="field">Title
            <input className="input" name="title" defaultValue={requirement?.title} maxLength={180} required />
          </label>
          <label className="field">Owner
            <input className="input" name="owner" defaultValue={requirement?.owner} maxLength={120} />
          </label>
          <label className="field">Gate
            <select className="input" name="gate" aria-label="Gate" defaultValue={requirement?.gate ?? 1}>
              {gates.map((gate) => <option key={gate.id} value={gate.id}>Gate {gate.id} · {gate.name}</option>)}
            </select>
          </label>
          <label className="field field-wide">Requirement statement
            <textarea className="input" name="description" aria-label="Requirement statement" defaultValue={requirement?.description} rows={3} maxLength={4000} />
          </label>
        </div>
        <LinkChecklist
          legend="Linked DFMEA failure modes"
          name="failureModes"
          records={project.failureModes}
          selected={requirement?.failureModeIds ?? []}
          empty="Create a failure mode in the DFMEA tab to add a verification path."
        />
        <EditorActions onClose={onClose} onDelete={requirement ? remove : undefined} saveLabel={requirement ? 'Save changes' : 'Create requirement'} error={error} />
      </form>
    </Modal>
  );
}

function FailureModeEditor({
  project, onChange, mode, onClose,
}: ProjectProps & { mode?: FailureMode; onClose: () => void }) {
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = readText(form, 'code').toUpperCase();
    const title = readText(form, 'title');
    const severity = Number(form.get('severity'));
    if (!code || !title) return setError('Enter a failure mode ID and a title.');
    if (codeExists(project.failureModes, code, mode?.id)) return setError('This failure mode ID is already in use.');
    if (!Number.isInteger(severity) || severity < 1 || severity > 10) return setError('Enter a severity from 1 to 10.');

    const record: FailureMode = {
      id: mode?.id ?? newId(),
      code,
      title,
      description: readText(form, 'description'),
      severity,
    };
    const failureModes = mode
      ? project.failureModes.map((item) => item.id === mode.id ? record : item)
      : [...project.failureModes, record];
    onChange({ ...project, failureModes });
    onClose();
  }

  function remove() {
    if (!mode) return;
    const unlinked = <T extends { failureModeIds: string[] }>(item: T): T => ({
      ...item,
      failureModeIds: item.failureModeIds.filter((id) => id !== mode.id),
    });
    onChange({
      ...project,
      failureModes: project.failureModes.filter((item) => item.id !== mode.id),
      requirements: project.requirements.map(unlinked),
      tests: project.tests.map(unlinked),
    });
    onClose();
  }

  return (
    <Modal
      title={mode ? `Edit ${mode.code}` : 'New failure mode'}
      description="EN-002 · Design Failure Mode and Effects Analysis"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field">Failure mode ID
            <input className="input" name="code" defaultValue={mode?.code ?? nextCode(project.failureModes, 'FM-')} maxLength={40} required />
          </label>
          <label className="field">Title
            <input className="input" name="title" defaultValue={mode?.title} maxLength={180} required />
          </label>
          <label className="field">Severity
            <input className="input" name="severity" defaultValue={mode?.severity ?? 5} type="number" min={1} max={10} step={1} required />
          </label>
          <label className="field field-wide">Failure effect / description
            <textarea className="input" name="description" aria-label="Failure effect / description" defaultValue={mode?.description} rows={3} maxLength={4000} />
          </label>
        </div>
        <EditorActions onClose={onClose} onDelete={mode ? remove : undefined} saveLabel={mode ? 'Save changes' : 'Create failure mode'} error={error} />
      </form>
    </Modal>
  );
}

export default function RTMTable({ project, onChange }: ProjectProps) {
  const [view, setView] = useState<View>('requirements');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const requirement = project.requirements.find((item) => item.id === editor?.id);
  const mode = project.failureModes.find((item) => item.id === editor?.id);
  const test = project.tests.find((item) => item.id === editor?.id);
  const closeEditor = () => setEditor(null);
  const requirementsView = view === 'requirements';
  const query = search.trim().toLowerCase();
  const requirementRows = project.requirements.map((item) => ({
    item,
    status: verificationStatus(project, item),
    modes: project.failureModes.filter((entry) => item.failureModeIds.includes(entry.id)),
    tests: getRequirementTests(project, item),
  }));
  const visibleRequirements = requirementRows.filter(({ item, status, modes, tests }) => (
    (!statusFilter || status === statusFilter) &&
    [item.code, item.title, item.owner, item.description, ...modes.map((x) => x.code), ...tests.map((x) => x.code)]
      .some((value) => value.toLowerCase().includes(query))
  ));
  const visibleModes = project.failureModes.filter((item) => (
    [item.code, item.title, item.description].some((value) => value.toLowerCase().includes(query))
  ));
  const recordCount = requirementsView ? visibleRequirements.length : visibleModes.length;
  const hasRecords = requirementsView ? project.requirements.length > 0 : project.failureModes.length > 0;
  const verified = requirementRows.filter(({ status }) => status === 'Passed').length;
  const covered = requirementRows.filter(({ tests }) => tests.length > 0).length;
  const addRecord = (
    <button className="button primary" type="button" onClick={() => setEditor({ kind: requirementsView ? 'requirement' : 'failureMode' })}>
      <Plus size={17} aria-hidden="true" />{requirementsView ? 'New requirement' : 'New failure mode'}
    </button>
  );

  function showView(next: View) {
    setView(next);
    setSearch('');
  }

  return (
    <section className="trace-view">
      <PageHeading
        title="Requirements Traceability"
        description="Trace requirements through DFMEA and DVP&R. A requirement passes when all its linked tests pass."
        actions={addRecord}
      />

      <div className="trace-metrics trace-metrics-three">
        <div className="panel trace-metric">
          <span className="trace-metric-icon trace-tone-green-neutral"><ListChecks size={18} aria-hidden="true" /></span>
          <div><span className="trace-metric-label">System requirements</span><strong>{project.requirements.length}</strong></div>
        </div>
        <div className="panel trace-metric">
          <span className="trace-metric-icon trace-tone-green"><CheckCircle2 size={18} aria-hidden="true" /></span>
          <div><span className="trace-metric-label">Verified requirements</span><strong>{verified}</strong></div>
        </div>
        <div className="panel trace-metric">
          <span className="trace-metric-icon trace-tone-amber"><CircleDashed size={18} aria-hidden="true" /></span>
          <div><span className="trace-metric-label">Missing test coverage</span><strong>{project.requirements.length - covered}</strong></div>
        </div>
      </div>

      <section className="panel trace-panel">
        <div className="trace-navigation" aria-label="Traceability views">
          <button type="button" aria-pressed={requirementsView} onClick={() => showView('requirements')}><Link2 size={16} aria-hidden="true" /> Requirements matrix</button>
          <button type="button" aria-pressed={!requirementsView} onClick={() => showView('failureModes')}><ShieldAlert size={16} aria-hidden="true" /> DFMEA failure modes</button>
        </div>
        <div className="toolbar trace-toolbar">
          <div className="trace-panel-title">
            <h2>{requirementsView ? 'Requirements' : 'Failure modes'}</h2>
            <span className="chip">{recordCount}</span>
          </div>
          <div className="trace-filters">
            <SearchField value={search} onChange={setSearch} placeholder={requirementsView ? 'Search requirements…' : 'Search failure modes…'} />
            {requirementsView && (
              <select className="input trace-filter" aria-label="Filter requirements by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                {testStatuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            )}
          </div>
        </div>
        {recordCount ? (
          <div className="table-scroll">
            {requirementsView ? (
              <table className="data-table trace-table trace-rtm-table">
                <thead>
                  <tr>
                    <th scope="col">System requirement</th>
                    <th scope="col">DFMEA failure modes</th>
                    <th scope="col">DVP&amp;R tests</th>
                    <th scope="col">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRequirements.map(({ item, status, modes, tests }) => (
                    <tr key={item.id}>
                      <td>
                        <button type="button" className="trace-record-button" onClick={() => setEditor({ kind: 'requirement', id: item.id })}>
                          {status === 'Passed' && <span className="trace-check" aria-label="Verified"><Check size={13} aria-hidden="true" /></span>}
                          <span className="mono trace-record-code">{item.code}</span>
                          <span className="trace-record-title">{item.title}</span>
                        </button>
                        <span className="trace-secondary">Gate {item.gate}{item.owner ? ` · ${item.owner}` : ''}</span>
                      </td>
                      <td>
                        <RelatedRecords records={modes} empty="Unlinked" onOpen={(entry) => setEditor({ kind: 'failureMode', id: entry.id })} />
                      </td>
                      <td><RelatedRecords records={tests} empty="No tests" onOpen={(entry) => setEditor({ kind: 'test', id: entry.id })} /></td>
                      <td><Badge status={status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="data-table trace-table trace-rtm-table">
                <thead>
                  <tr>
                    <th scope="col">Failure mode</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Linked requirements</th>
                    <th scope="col">Verification tests</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleModes.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button type="button" className="trace-record-button" onClick={() => setEditor({ kind: 'failureMode', id: item.id })}>
                          <span className="mono trace-record-code">{item.code}</span>
                          <span className="trace-record-title">{item.title}</span>
                        </button>
                        {item.description && <span className="trace-secondary trace-clamp">{item.description}</span>}
                      </td>
                      <td><span className={`trace-severity ${item.severity >= 8 ? 'trace-tone-red' : 'trace-tone-amber'}`}>{item.severity} / 10</span></td>
                      <td>
                        <RelatedRecords records={project.requirements.filter((entry) => entry.failureModeIds.includes(item.id))} empty="Unlinked" onOpen={(entry) => setEditor({ kind: 'requirement', id: entry.id })} />
                      </td>
                      <td>
                        <RelatedRecords records={project.tests.filter((entry) => entry.failureModeIds.includes(item.id))} empty="No tests" onOpen={(entry) => setEditor({ kind: 'test', id: entry.id })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <EmptyState
            title={hasRecords ? 'No matching records' : requirementsView ? 'No system requirements' : 'No DFMEA failure modes'}
            description={hasRecords ? 'Try changing your search or filter.' : requirementsView ? 'Add a requirement and link its design risks to verification tests.' : 'Record a design failure mode to connect requirements with verification tests.'}
            action={hasRecords ? undefined : addRecord}
          />
        )}
      </section>

      {editor?.kind === 'requirement' && (!editor.id || requirement) && (
        <RequirementEditor key={requirement?.id ?? project.id} project={project} onChange={onChange} requirement={requirement} onClose={closeEditor} />
      )}
      {editor?.kind === 'failureMode' && (!editor.id || mode) && (
        <FailureModeEditor key={mode?.id ?? project.id} project={project} onChange={onChange} mode={mode} onClose={closeEditor} />
      )}
      {editor?.kind === 'test' && test && (
        <TestEditor key={test.id} project={project} onChange={onChange} test={test} onClose={closeEditor} />
      )}
    </section>
  );
}
