import { useId, useState, type FormEvent } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  HandCoins,
  Plus,
  ReceiptText,
  Search,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { formatDate, newId, type Project } from './domain'
import {
  calculateFinance,
  financeCurrencies,
  formatFinanceMoney,
  getLedger,
  maxFinanceAmountMinor,
  parseFinanceAmount,
  validateFinanceLedgerChanges,
  type FinanceActor,
  type FinanceEntry,
  type FinanceLedger,
} from './finance'
import { EmptyState, Modal, PageHeading } from './ui'
import './finance.css'

type EntryKind = FinanceEntry['kind']
type FormKind = 'contribution' | 'expense' | 'reimbursement'
type FinanceDialog = { type: 'record'; kind: FormKind } | { type: 'void'; id: string }
type Balances = ReturnType<typeof calculateFinance>
type Money = (amountMinor: number) => string

const entryLabels: Record<EntryKind, string> = {
  contribution: 'Contribution',
  expense: 'Founder expense',
  'fund-expense': 'Pooled expense',
  reimbursement: 'Reimbursement',
}

const formTitles: Record<FormKind, string> = {
  contribution: 'Record contribution',
  expense: 'Record expense',
  reimbursement: 'Record reimbursement',
}

const formDescriptions: Record<FormKind, string> = {
  contribution: 'Record funds you added to the project pool.',
  expense: 'Record what was spent and how it was paid.',
  reimbursement: 'Record a payment from the pool to a founder.',
}

const expenseCategories = ['Materials', 'Prototyping', 'Testing', 'Manufacturing', 'Software', 'Services', 'Travel']

interface FinanceProps {
  project: Project
  onChange: (project: Project) => void
  actor: FinanceActor
  readOnly?: boolean
}

export default function Finance({ project, onChange, actor, readOnly = false }: FinanceProps) {
  const [dialog, setDialog] = useState<FinanceDialog | null>(null)
  const [query, setQuery] = useState('')
  const [entryKind, setEntryKind] = useState<EntryKind | 'all'>('all')
  const [founderId, setFounderId] = useState('')
  const [entryStatus, setEntryStatus] = useState('all')
  const [message, setMessage] = useState('')
  const [currencyError, setCurrencyError] = useState('')
  const ledger = getLedger(project)
  const { currency, entries } = ledger
  const balances = calculateFinance(ledger)
  const canManage = actor.role === 'admin' && !readOnly
  const reimbursementBlock = balances.owedMinor === 0
    ? 'No founder has an outstanding balance.'
    : balances.cashMinor === 0 ? 'The project pool has no cash available.' : ''
  const money: Money = (amount) => formatFinanceMoney(amount, currency)
  const founderOptions = new Map<string, string>()
  for (const entry of entries) {
    if (entry.kind !== 'fund-expense') founderOptions.set(entry.memberId, entry.memberName)
  }
  const search = query.trim().toLowerCase()
  const shownEntries = entries
    .filter((entry) => {
      const matchesText = [entry.description, entry.category, entry.memberName, entryLabels[entry.kind]]
        .some((text) => text?.toLowerCase().includes(search))
      const matchesKind = entryKind === 'all' || entryKind === entry.kind
      const matchesFounder = !founderId || (entry.kind !== 'fund-expense' && founderId === entry.memberId)
      const matchesStatus = entryStatus === 'all' || Boolean(entry.voided) === (entryStatus === 'voided')
      return matchesText && matchesKind && matchesFounder && matchesStatus
    })
    .sort((left, right) => right.date.localeCompare(left.date) || Date.parse(right.createdAt) - Date.parse(left.createdAt))

  function updateLedger(next: FinanceLedger) {
    if (readOnly) return 'This workspace is read-only.'
    const error = validateFinanceLedgerChanges(project.finance, next, actor)
    if (!error) onChange({ ...project, finance: next })
    return error
  }

  function recordEntry(entry: FinanceEntry) {
    const error = updateLedger({ ...ledger, entries: [...entries, entry] })
    if (error) return error
    setMessage(`${entryLabels[entry.kind]} recorded.`)
    setDialog(null)
    return null
  }

  function voidEntry(entry: FinanceEntry, reason: string) {
    if (!canVoidEntry(entry, actor)) return 'This entry cannot be voided by your account.'
    const voided = { byId: actor.id, byName: actor.name, at: new Date().toISOString(), reason }
    const error = updateLedger({
      ...ledger,
      entries: entries.map((item) => item.id === entry.id ? { ...item, voided } : item),
    })
    if (error) return error
    setMessage('Entry voided.')
    setDialog(null)
    return null
  }

  function changeCurrency(value: FinanceLedger['currency']) {
    const error = updateLedger({ ...ledger, currency: value })
    setCurrencyError(error ?? '')
    if (!error) setMessage(`Ledger currency set to ${value}.`)
  }

  function clearFilters() {
    setQuery('')
    setEntryKind('all')
    setFounderId('')
    setEntryStatus('all')
  }

  const voidTarget = dialog?.type === 'void' ? entries.find((entry) => entry.id === dialog.id) : undefined

  return (
    <div className="finance-view">
      <PageHeading
        eyebrow={project.code}
        title="Founder finance"
        description="Track pooled funds, project spending, and outstanding reimbursements."
        actions={!readOnly && (
          <>
            <button type="button" className="button secondary" onClick={() => setDialog({ type: 'record', kind: 'contribution' })}>
              <ArrowDownLeft size={16} aria-hidden="true" /> Record contribution
            </button>
            {canManage && (
              <button type="button" className="button secondary" disabled={Boolean(reimbursementBlock)} title={reimbursementBlock || undefined} onClick={() => setDialog({ type: 'record', kind: 'reimbursement' })}>
                <HandCoins size={16} aria-hidden="true" /> Record reimbursement
              </button>
            )}
            <button type="button" className="button primary" onClick={() => setDialog({ type: 'record', kind: 'expense' })}>
              <Plus size={16} aria-hidden="true" /> Add expense
            </button>
          </>
        )}
      />

      <div className="finance-ledger-meta">
        <span className="finance-actor">{readOnly ? 'Read-only ledger' : `Recording as ${actor.name}`}</span>
        {canManage && entries.length === 0 ? (
          <label className="finance-currency">
            Ledger currency
            <select className="input" value={currency} onChange={(event) => changeCurrency(event.target.value as FinanceLedger['currency'])}>
              {financeCurrencies.map((code) => <option key={code}>{code}</option>)}
            </select>
          </label>
        ) : <span className="chip mono">{currency}</span>}
      </div>
      {currencyError && <p className="form-error" role="alert">{currencyError}</p>}
      <p className="finance-feedback" role="status">{message}</p>

      <section className="finance-metrics" aria-label="Finance totals">
        <FinanceMetric label="Pooled cash" value={money(balances.cashMinor)} detail="Available in the project pool" Icon={Wallet} featured />
        <FinanceMetric label="Total contributions" value={money(balances.contributionsMinor)} detail="Capital added by founders" Icon={CircleDollarSign} />
        <FinanceMetric label="Total spending" value={money(balances.expenseMinor)} detail={`${money(balances.fundExpenseMinor)} paid from the pool`} Icon={ReceiptText} />
        <FinanceMetric label="Reimbursements due" value={money(balances.owedMinor)} detail={`${money(balances.reimbursementMinor)} reimbursed so far`} Icon={HandCoins} />
      </section>

      <section className="panel finance-panel" aria-labelledby="finance-founders-heading">
        <div className="finance-panel-heading">
          <h2 id="finance-founders-heading">Founder balances</h2>
          <p>Capital contributions, out-of-pocket spending, and amounts owed.</p>
        </div>
        {balances.members.length === 0 ? (
          <EmptyState title="No founder activity" description="Record a contribution or a founder-paid expense to start tracking balances." />
        ) : (
          <div className="table-scroll finance-table-scroll">
            <table className="data-table finance-founders-table" aria-label="Founder balances">
              <thead>
                <tr>
                  <th scope="col">Founder</th>
                  <th scope="col">Contributed</th>
                  <th scope="col">Paid personally</th>
                  <th scope="col">Reimbursed</th>
                  <th scope="col">Owed</th>
                </tr>
              </thead>
              <tbody>
                {balances.members.map((member) => (
                  <tr key={member.id}>
                    <th scope="row">{member.name}</th>
                    <td>{money(member.contributionsMinor)}</td>
                    <td>{money(member.expenseMinor)}</td>
                    <td>{money(member.reimbursementMinor)}</td>
                    <td className="finance-balance-owed">{money(member.owedMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel finance-panel" aria-labelledby="finance-ledger-heading">
        <div className="finance-panel-heading">
          <h2 id="finance-ledger-heading">Transaction ledger</h2>
          <p>{shownEntries.length} of {entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
        </div>
        <div className="toolbar finance-filters" role="group" aria-label="Filter transactions">
          <div className="finance-search">
            <Search size={16} aria-hidden="true" />
            <input className="input" type="search" aria-label="Search transactions" placeholder="Search transactions…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <select className="input" aria-label="Transaction type" value={entryKind} onChange={(event) => setEntryKind(event.target.value as EntryKind | 'all')}>
            <option value="all">All types</option>
            {Object.entries(entryLabels).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}
          </select>
          <select className="input" aria-label="Filter by founder" value={founderId} onChange={(event) => setFounderId(event.target.value)}>
            <option value="">All founders</option>
            {Array.from(founderOptions, ([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select>
          <select className="input" aria-label="Transaction status" value={entryStatus} onChange={(event) => setEntryStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="voided">Voided</option>
          </select>
          {(query || founderId || entryKind !== 'all' || entryStatus !== 'all') && (
            <button className="button ghost" type="button" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
        {shownEntries.length === 0 ? (
          <EmptyState
            title={entries.length ? 'No matching transactions' : 'No transactions yet'}
            description={entries.length ? 'Try adjusting the ledger filters.' : 'Record a contribution or expense to add your first entry.'}
          />
        ) : (
          <div className="table-scroll finance-table-scroll">
            <table className="data-table finance-ledger-table" aria-label="Transaction ledger">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Type</th>
                  <th scope="col">Founder</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shownEntries.map((entry) => (
                  <tr key={entry.id} className={entry.voided ? 'finance-voided' : undefined}>
                    <td className="finance-date">{formatDate(entry.date)}</td>
                    <td className="finance-entry-detail">
                      <strong>{entry.description}</strong>
                      {entry.category && <span>{entry.category}</span>}
                      {entry.recordedById !== entry.memberId || entry.kind === 'fund-expense' ? <span>Recorded by {entry.recordedByName}</span> : null}
                      {entry.voided && <span>Voided by {entry.voided.byName} on {formatDate(entry.voided.at)}. {entry.voided.reason}</span>}
                    </td>
                    <td>
                      <span className="finance-entry-type" data-kind={entry.kind}>{entryLabels[entry.kind]}</span>
                    </td>
                    <td>{entry.kind === 'fund-expense' ? '—' : entry.memberName}</td>
                    <td className="finance-entry-amount">{money(entry.amountMinor)}</td>
                    <td>
                      {entry.voided ? <span className="badge">Voided</span> : !readOnly && canVoidEntry(entry, actor) && (
                        <button type="button" className="button ghost finance-void-button" onClick={() => setDialog({ type: 'void', id: entry.id })}>Void</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!readOnly && dialog?.type === 'record' && (
        <RecordEntryModal
          kind={dialog.kind}
          actor={actor}
          currency={currency}
          balances={balances}
          money={money}
          onClose={() => setDialog(null)}
          onRecord={recordEntry}
        />
      )}
      {!readOnly && voidTarget && !voidTarget.voided && (
        <VoidEntryModal entry={voidTarget} money={money} onClose={() => setDialog(null)} onVoid={voidEntry} />
      )}
    </div>
  )
}

function FinanceMetric({ label, value, detail, Icon, featured = false }: {
  label: string
  value: string
  detail: string
  Icon: LucideIcon
  featured?: boolean
}) {
  return (
    <div className={`panel finance-metric${featured ? ' finance-metric-featured' : ''}`}>
      <span className="finance-metric-icon"><Icon size={19} aria-hidden="true" /></span>
      <span className="finance-metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="finance-metric-detail">{detail}</span>
    </div>
  )
}

function canVoidEntry(entry: FinanceEntry, actor: FinanceActor) {
  if (entry.voided) return false
  return actor.role === 'admin' || (
    (entry.kind === 'expense' || entry.kind === 'contribution') && actor.id === entry.memberId
  )
}

function localDate() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function RecordEntryModal({ kind, actor, currency, balances, money, onClose, onRecord }: {
  kind: FormKind
  actor: FinanceActor
  currency: FinanceLedger['currency']
  balances: Balances
  money: Money
  onClose: () => void
  onRecord: (entry: FinanceEntry) => string | null
}) {
  const reimbursementMembers = balances.members.filter((member) => member.owedMinor > 0)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState(localDate)
  const [paidFrom, setPaidFrom] = useState<'founder' | 'pool'>('founder')
  const [founder, setFounder] = useState(reimbursementMembers[0]?.id ?? '')
  const [error, setError] = useState('')
  const [amountError, setAmountError] = useState('')
  const categoryId = useId()
  const amountErrorId = useId()
  const selectedFounder = reimbursementMembers.find((member) => member.id === founder)
  const paymentLimit = kind === 'reimbursement' && selectedFounder
    ? Math.min(selectedFounder.owedMinor, balances.cashMinor)
    : kind === 'expense' && paidFrom === 'pool' ? balances.cashMinor : undefined

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const amountMinor = parseFinanceAmount(amount)
    if (amountMinor === null) {
      setAmountError(`Enter a positive amount up to ${money(maxFinanceAmountMinor)} with at most two decimal places.`)
      return
    }
    setAmountError('')
    if (!description.trim()) {
      setError('Enter a description for this transaction.')
      return
    }
    if (kind === 'reimbursement' && !selectedFounder) {
      setError('Select a founder with an outstanding balance.')
      return
    }

    const entryKind = kind === 'expense' && paidFrom === 'pool' ? 'fund-expense' : kind
    const result = onRecord({
      id: newId(),
      kind: entryKind,
      amountMinor,
      date,
      description: description.trim(),
      ...(category.trim() ? { category: category.trim() } : {}),
      memberId: kind === 'reimbursement' && selectedFounder ? selectedFounder.id : actor.id,
      memberName: kind === 'reimbursement' && selectedFounder ? selectedFounder.name : actor.name,
      recordedById: actor.id,
      recordedByName: actor.name,
      createdAt: new Date().toISOString(),
    })
    if (result) setError(result)
  }

  return (
    <Modal
      title={formTitles[kind]}
      description={kind === 'expense' && actor.role === 'founder' ? 'Record a project cost you paid personally.' : formDescriptions[kind]}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          {kind === 'reimbursement' && (
            <label className="field field-wide">
              Founder
              <select className="input" value={founder} onChange={(event) => setFounder(event.target.value)} required>
                {!reimbursementMembers.length && <option value="">No outstanding balances</option>}
                {reimbursementMembers.map((member) => <option key={member.id} value={member.id}>{member.name} · {money(member.owedMinor)} owed</option>)}
              </select>
            </label>
          )}
          {kind === 'expense' && actor.role === 'admin' && (
            <label className="field field-wide">
              Paid from
              <select className="input" value={paidFrom} onChange={(event) => setPaidFrom(event.target.value as 'founder' | 'pool')}>
                <option value="founder">Founder paid</option>
                <option value="pool">Pooled funds</option>
              </select>
            </label>
          )}
          <div className="field">
            <label htmlFor={`${amountErrorId}-input`}>Amount</label>
            <div className="finance-amount-input">
              <input
                id={`${amountErrorId}-input`}
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                maxLength={24}
                value={amount}
                onChange={(event) => { setAmount(event.target.value); setAmountError('') }}
                aria-invalid={Boolean(amountError)}
                aria-describedby={amountError ? amountErrorId : paymentLimit !== undefined ? `${amountErrorId}-limit` : undefined}
                required
                autoFocus
              />
              <span className="mono">{currency}</span>
            </div>
            {amountError && <p className="finance-amount-error" id={amountErrorId} role="alert">{amountError}</p>}
            {paymentLimit !== undefined && <span className="finance-limit" id={`${amountErrorId}-limit`}>{money(paymentLimit)} available</span>}
          </div>
          <label className="field">
            Date
            <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label className="field field-wide">
            Description
            <textarea className="input" rows={3} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} required />
          </label>
          {kind === 'expense' && (
            <label className="field field-wide">
              <span>Category <span className="muted finance-optional">(optional)</span></span>
              <input className="input" list={categoryId} maxLength={120} value={category} onChange={(event) => setCategory(event.target.value)} />
              <datalist id={categoryId}>{expenseCategories.map((option) => <option value={option} key={option} />)}</datalist>
            </label>
          )}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary" disabled={kind === 'reimbursement' && !selectedFounder}>
            <ArrowUpRight size={16} aria-hidden="true" /> {formTitles[kind]}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function VoidEntryModal({ entry, money, onClose, onVoid }: {
  entry: FinanceEntry
  money: Money
  onClose: () => void
  onVoid: (entry: FinanceEntry, reason: string) => string | null
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason.trim()) {
      setError('Enter a reason for voiding this entry.')
      return
    }
    setError(onVoid(entry, reason.trim()) ?? '')
  }

  return (
    <Modal title="Void transaction" description="Voiding keeps an audit record and removes this entry from the balances." onClose={onClose}>
      <p className="finance-void-context"><strong>{money(entry.amountMinor)}</strong> · {entry.description}</p>
      <form onSubmit={submit}>
        <label className="field">
          Void reason
          <textarea className="input" rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} required autoFocus />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="button finance-danger">Void entry</button>
        </div>
      </form>
    </Modal>
  )
}
