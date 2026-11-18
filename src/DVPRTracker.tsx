import { useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarDays, CheckCircle2, ChevronDown, ClipboardCheck, Plus, Timer, TriangleAlert } from 'lucide-react';
import { formatDate, newId, testStatuses } from './domain';
import type { Project, VerificationTest } from './domain';
import { EmptyState, Modal, PageHeading } from './ui';
import { codeExists, EditorActions, LinkChecklist, nextCode, readText, SearchField } from './TraceControls';
import './verification.css';

type TestStatus = VerificationTest['status'];
type ProjectProps = { project: Project; onChange: (project: Project) => void };

export function TestEditor({
  project, onChange, test, onClose,
}: ProjectProps & { test?: VerificationTest; onClose: () => void }) {
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = readText(form, 'code').toUpperCase();
    const title = readText(form, 'title');
    const sampleSize = Number(form.get('sampleSize'));
    if (!code || !title) return setError('Enter a test ID and a title.');
    if (codeExists(project.tests, code, test?.id)) return setError('This test ID is already in use.');
    if (!Number.isSafeInteger(sampleSize) || sampleSize < 1) return setError('Enter a whole-number sample size of at least 1.');

    const record: VerificationTest = {
      id: test?.id ?? newId(),
      code,
      title,
      method: readText(form, 'method'),
      conditions: readText(form, 'conditions'),
      acceptance: readText(form, 'acceptance'),
      sampleSize,
      dueDate: readText(form, 'dueDate'),
      testHouse: readText(form, 'testHouse'),
      status: readText(form, 'status') as TestStatus,
      result: readText(form, 'result'),
      failureModeIds: form.getAll('failureModes').map(String),
    };
    const tests = test ? project.tests.map((item) => item.id === test.id ? record : item) : [...project.tests, record];
    onChange({ ...project, tests });
    onClose();
  }

  function remove() {
    onChange({ ...project, tests: project.tests.filter((item) => item.id !== test?.id) });
    onClose();
  }

  return (
    <Modal
      title={test ? `Edit ${test.code}` : 'New verification test'}
      description="EN-004 · Design Verification Plan & Report"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field">Test ID
            <input className="input" name="code" defaultValue={test?.code ?? nextCode(project.tests, 'VAL-')} maxLength={40} required />
          </label>
          <label className="field">Title
            <input className="input" name="title" defaultValue={test?.title} maxLength={180} required />
          </label>
          <label className="field">Verification method
            <input className="input" name="method" defaultValue={test?.method} placeholder="e.g. thermal cycling" maxLength={200} />
          </label>
          <label className="field">Test house
            <input className="input" name="testHouse" defaultValue={test?.testHouse} maxLength={120} />
          </label>
          <label className="field">Sample size
            <input className="input" name="sampleSize" defaultValue={test?.sampleSize ?? 1} type="number" min={1} step={1} required />
          </label>
          <label className="field">Target completion date
            <input className="input" name="dueDate" defaultValue={test?.dueDate} type="date" max="9999-12-31" />
          </label>
          <label className="field field-wide">Test conditions
            <textarea className="input" name="conditions" aria-label="Test conditions" defaultValue={test?.conditions} rows={2} maxLength={4000} />
          </label>
          <label className="field field-wide">Acceptance criteria
            <textarea className="input" name="acceptance" aria-label="Acceptance criteria" defaultValue={test?.acceptance} rows={2} maxLength={4000} />
          </label>
          <label className="field">Status
            <select className="input" name="status" aria-label="Status" defaultValue={test?.status ?? 'Untested'}>
              {testStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label className="field field-wide">Result / evidence
            <textarea className="input" name="result" aria-label="Result / evidence" defaultValue={test?.result} rows={2} maxLength={8000} />
          </label>
        </div>
        <LinkChecklist
          legend="Linked DFMEA failure modes"
          name="failureModes"
          records={project.failureModes}
          selected={test?.failureModeIds ?? []}
          empty="Create a failure mode in the Requirements workspace to link it here."
        />
        <EditorActions onClose={onClose} onDelete={test ? remove : undefined} saveLabel={test ? 'Save changes' : 'Create test'} error={error} />
      </form>
    </Modal>
  );
}

const testSummary = [
  { label: 'Verification tests', icon: ClipboardCheck, status: null, color: 'green-neutral' },
  { label: 'In progress', icon: Timer, status: 'In Progress', color: 'amber' },
  { label: 'Passed', icon: CheckCircle2, status: 'Passed', color: 'green' },
  { label: 'Failed', icon: TriangleAlert, status: 'Failed', color: 'red' },
] as const;

export default function DVPRTracker({ project, onChange }: ProjectProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TestStatus | ''>('');
  const [editor, setEditor] = useState<{ id?: string } | null>(null);
  const test = project.tests.find((item) => item.id === editor?.id);
  const query = search.trim().toLowerCase();
  const visible = project.tests.filter((item) => {
    const searchable = [item.code, item.title, item.method, item.testHouse, item.acceptance, item.conditions];
    return (!statusFilter || item.status === statusFilter) && searchable.some((value) => value.toLowerCase().includes(query));
  });

  function changeStatus(id: string, status: TestStatus) {
    const tests = project.tests.map((item) => item.id === id ? { ...item, status } : item);
    onChange({ ...project, tests });
  }

  const addTest = (
    <button className="button primary" type="button" onClick={() => setEditor({})}>
      <Plus size={17} aria-hidden="true" /> New test
    </button>
  );

  return (
    <section className="trace-view">
      <PageHeading
        title="DVP&R Tracker"
        description="Plan verification tests, record evidence, and track results against system requirements."
        actions={addTest}
      />
      <div className="trace-metrics">
        {testSummary.map(({ label, icon: Icon, status, color }) => (
          <div className="panel trace-metric" key={label}>
            <span className={`trace-metric-icon trace-tone-${color}`}><Icon size={18} aria-hidden="true" /></span>
            <div>
              <span className="trace-metric-label">{label}</span>
              <strong>{status ? project.tests.filter((item) => item.status === status).length : project.tests.length}</strong>
            </div>
          </div>
        ))}
      </div>

      <section className="panel trace-panel">
        <div className="toolbar trace-toolbar">
          <div className="trace-panel-title">
            <h2>Verification plan</h2>
            <span className="chip">{visible.length}</span>
          </div>
          <div className="trace-filters">
            <SearchField value={search} onChange={setSearch} placeholder="Search tests…" />
            <select
              className="input trace-filter"
              aria-label="Filter tests by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TestStatus | '')}
            >
              <option value="">All statuses</option>
              {testStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </div>
        </div>

        {visible.length ? (
          <div className="table-scroll">
            <table className="data-table trace-table trace-test-table">
              <thead>
                <tr>
                  <th scope="col">Test / method</th>
                  <th scope="col">Conditions / acceptance</th>
                  <th scope="col">Samples</th>
                  <th scope="col">Target date</th>
                  <th scope="col">Test house</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button type="button" className="trace-record-button" onClick={() => setEditor({ id: item.id })}>
                        <span className="mono trace-record-code">{item.code}</span>
                        <span className="trace-record-title">{item.title}</span>
                      </button>
                      {item.method && <span className="trace-secondary">{item.method}</span>}
                    </td>
                    <td className="trace-detail-cell">
                      <span className="trace-clamp">{item.conditions || item.acceptance || '—'}</span>
                      {item.conditions && item.acceptance && <span className="trace-secondary trace-clamp">{item.acceptance}</span>}
                    </td>
                    <td className="trace-nowrap">{item.sampleSize}</td>
                    <td>
                      {item.dueDate ? (
                        <span className="trace-date"><CalendarDays size={14} aria-hidden="true" />{formatDate(item.dueDate)}</span>
                      ) : '—'}
                    </td>
                    <td>{item.testHouse || '—'}</td>
                    <td>
                      <label className={`trace-result trace-result-${item.status.toLowerCase().replace(' ', '-')}`}>
                        <span className="trace-result-dot" aria-hidden="true" />
                        <select
                          aria-label={`Status for ${item.code}`}
                          value={item.status}
                          onChange={(event) => changeStatus(item.id, event.target.value as TestStatus)}
                        >
                          {testStatuses.map((status) => <option key={status}>{status}</option>)}
                        </select>
                        <ChevronDown size={13} aria-hidden="true" />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={project.tests.length ? 'No matching tests' : 'No verification tests'}
            description={project.tests.length ? 'Try a different search or status.' : 'Add a test to build your verification plan.'}
            action={project.tests.length ? undefined : addTest}
          />
        )}
      </section>
      {editor && (!editor.id || test) && (
        <TestEditor key={test?.id ?? project.id} project={project} onChange={onChange} test={test} onClose={() => setEditor(null)} />
      )}
    </section>
  );
}
