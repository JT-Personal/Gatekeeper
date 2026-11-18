import { useState } from 'react';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

type CodedRecord = { id: string; code: string; title: string };

export type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

export function SearchField({ value, onChange, placeholder }: SearchFieldProps) {
  return (
    <label className="trace-search">
      <Search size={16} aria-hidden="true" />
      <input
        className="input"
        aria-label={placeholder}
        placeholder={placeholder}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function LinkChecklist({
  legend, name, records, selected, empty,
}: {
  legend: string;
  name: string;
  records: CodedRecord[];
  selected: string[];
  empty: string;
}) {
  return (
    <fieldset className="trace-link-field">
      <legend>{legend}</legend>
      {records.length ? (
        <div className="trace-link-options">
          {records.map((record) => (
            <label className="trace-link-option" key={record.id}>
              <input type="checkbox" name={name} value={record.id} defaultChecked={selected.includes(record.id)} />
              <span className="mono">{record.code}</span>
              <span>{record.title}</span>
            </label>
          ))}
        </div>
      ) : <p className="muted trace-note">{empty}</p>}
    </fieldset>
  );
}

export function RelatedRecords<T extends CodedRecord>({
  records,
  empty,
  onOpen,
}: {
  records: T[];
  empty: string;
  onOpen?: (record: T) => void;
}) {
  if (!records.length) return <span className="muted trace-note">{empty}</span>;

  return (
    <div className="trace-related">
      {records.map((record) => onOpen ? (
        <button
          className="chip trace-record-chip"
          type="button"
          key={record.id}
          aria-label={`Open ${record.code} ${record.title}`}
          title={record.title}
          onClick={() => onOpen(record)}
        >
          {record.code}
        </button>
      ) : (
        <span className="chip trace-record-chip" key={record.id} title={record.title}>{record.code}</span>
      ))}
    </div>
  );
}

export function EditorActions({
  onClose, onDelete, deleteLabel, saveLabel, error,
}: {
  onClose: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  saveLabel: string;
  error?: ReactNode;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      {deleting && (
        <p className="form-error" role="alert">Delete this record and remove its links from this project?</p>
      )}
      <div className="form-actions trace-editor-actions">
        {onDelete && !deleting && (
          <button className="button ghost trace-delete" type="button" onClick={() => setDeleting(true)}>
            {deleteLabel ?? 'Delete'}
          </button>
        )}
        {deleting ? (
          <>
            <button className="button secondary" type="button" onClick={() => setDeleting(false)}>Keep record</button>
            <button className="button danger" type="button" onClick={onDelete}>Confirm delete</button>
          </>
        ) : (
          <>
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary" type="submit">{saveLabel}</button>
          </>
        )}
      </div>
    </>
  );
}

export function readText(form: FormData, field: string) {
  return String(form.get(field) ?? '').trim();
}

export function codeExists(records: CodedRecord[], code: string, currentId?: string) {
  return records.some((record) => record.id !== currentId && record.code.toUpperCase() === code);
}

export function nextCode(records: CodedRecord[], prefix: string) {
  let highest = 0;
  for (const record of records) {
    const index = record.code.toUpperCase().startsWith(prefix) && Number(record.code.slice(prefix.length));
    if (typeof index === 'number' && Number.isSafeInteger(index)) highest = Math.max(highest, index);
  }
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
