import { useId, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  HandCoins,
  History,
  Plus,
  ReceiptText,
  Search,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { formatDate, newId, type Project } from './domain'
import {
  financeCurrencies,
  formatFinanceMoney,
  maxFinanceAmountMinor,
  parseFinanceAmount,
  type FinanceActor,
  type FinanceEntry,
} from './finance'
import {
  calculatePeriod,
  getPayLedger,
  validatePayLedgerChanges,
  type PayExpense,
  type PayLedger,
  type PayMember,
  type PayPayment,
  type PayPeriod,
  type PayTransfer,
} from './payPeriods'
import { EmptyState, Modal, PageHeading } from './ui'
import './finance.css'

type FinanceDialog =
  | { type: 'start' | 'join' | 'expense' }
  | { type: 'payment'; transfer: PayTransfer }
  | { type: 'void-expense'; expense: PayExpense }
  | { type: 'void-payment'; payment: PayPayment }
type Balances = ReturnType<typeof calculatePeriod>
type Money = (amountMinor: number) => string
type Currency = PayLedger['currency']

interface FinanceProps {
  project: Project
  onChange: (project: Project) => void
  actor: FinanceActor
  readOnly?: boolean
}

const expenseCategories = ['Materials', 'Prototyping', 'Testing', 'Manufacturing', 'Software', 'Services', 'Travel']
const legacyTypes: Record<FinanceEntry['kind'], string> = {
  contribution: 'Contribution',
  expense: 'Personal expense',
  'fund-expense': 'Pooled expense',
  reimbursement: 'Reimbursement',
}

export default function FinancePage({ project, onChange, actor, readOnly = false }: FinanceProps) {
  const [periodId, setPeriodId] = useState('')
  const [dialog, setDialog] = useState<FinanceDialog | null>(null)
  const [message, setMessage] = useState('')
  const ledger = getPayLedger(project)
  const latest = ledger.periods.at(-1)
  const current = latest?.closed ? undefined : latest
  const selectedRecord = ledger.periods.find((period) => period.id === periodId) ?? latest
  const selected = selectedRecord && !selectedRecord.closed
    ? { ...selectedRecord, members: selectedRecord.members.map((member) => member.id === actor.id ? { ...member, name: actor.name } : member) }
    : selectedRecord
  const canStart = !readOnly && (ledger.periods.length === 0 || actor.role === 'admin')
  const currentBalances = current ? calculatePeriod(current) : undefined
  const earlierBalances = ledger.periods.flatMap((period) => {
    if (!period.closed?.carry || period.id === selected?.id) return []
    const { outstandingMinor } = calculatePeriod(period)
    return outstandingMinor ? [{ period, outstandingMinor }] : []
  }).reverse()
  const earlierOutstanding = earlierBalances.reduce((total, item) => total + item.outstandingMinor, 0)
  const money: Money = (amount) => formatFinanceMoney(amount, ledger.currency)

  function saveLedger(next: PayLedger, confirmation: string) {
    if (readOnly) return 'This finance ledger is read-only.'
    const error = validatePayLedgerChanges(project.payPeriods, next, actor)
    if (error) return error
    onChange({ ...project, payPeriods: next })
    setMessage(confirmation)
    setDialog(null)
    return null
  }

  function updatePeriod(period: PayPeriod, confirmation: string) {
    const periods = ledger.periods.map((entry) => entry.id === period.id ? period : entry)
    return saveLedger({ ...ledger, periods }, confirmation)
  }

  function startPeriod(label: string, currency: Currency, members: PayMember[], carry: boolean) {
    const now = new Date().toISOString()
    const period: PayPeriod = {
      id: newId(),
      label,
      openedAt: now,
      openedById: actor.id,
      openedByName: actor.name,
      members,
      expenses: [],
      payments: [],
    }
    const periods = ledger.periods.map((item) => item.id === current?.id
      ? { ...item, closed: { at: now, byId: actor.id, byName: actor.name, carry } }
      : item)
    const error = saveLedger({ currency, periods: [...periods, period] }, 'Pay period started.')
    if (!error) setPeriodId(period.id)
    return error
  }

  function makeVoid(reason: string) {
    return { byId: actor.id, byName: actor.name, at: new Date().toISOString(), reason }
  }

  const selectedBalances = selected ? calculatePeriod(selected) : undefined
  const myBalance = selectedBalances?.balances.find((member) => member.id === actor.id)
  const isMember = Boolean(selected?.members.some((member) => member.id === actor.id))
  const canLogExpense = !readOnly && selected && !selected.closed && isMember
  const canJoin = !readOnly && selected && !selected.closed && !isMember && selected.payments.length === 0

  return (
    <div className="finance-view">
      <PageHeading
        eyebrow={project.code}
        title="Finance"
        description="Split project expenses across members and track payments for each pay period."
        actions={
          <>
            {canStart && (
              <button type="button" className={`button ${latest ? 'secondary' : 'primary'}`} onClick={() => setDialog({ type: 'start' })}>
                <CalendarDays size={16} aria-hidden="true" /> {latest ? 'Start new pay period' : 'Start first pay period'}
              </button>
            )}
            {canJoin && (
              <button type="button" className="button primary" onClick={() => setDialog({ type: 'join' })}>
                <UserPlus size={16} aria-hidden="true" /> Join pay period
              </button>
            )}
            {canLogExpense && (
              <button type="button" className="button primary" onClick={() => setDialog({ type: 'expense' })}>
                <Plus size={16} aria-hidden="true" /> Log expense
              </button>
            )}
          </>
        }
      />

      {selected && selectedBalances ? (
        <>
          <div className="finance-period-toolbar">
            <label className="finance-period-select">
              <CalendarDays size={16} aria-hidden="true" />
              <span>Pay period</span>
              <select className="input" value={selected.id} onChange={(event) => setPeriodId(event.target.value)}>
                {[...ledger.periods].reverse().map((period) => (
                  <option key={period.id} value={period.id}>{period.label} {period.closed ? '(closed)' : '(current)'}</option>
                ))}
              </select>
            </label>
            <span className="chip mono">{ledger.currency}</span>
            <span className="finance-period-date">
              {formatDate(selected.openedAt)}{selected.closed ? ` to ${formatDate(selected.closed.at)}` : ''}
            </span>
            <span className="finance-period-date finance-recording">{readOnly ? 'Read-only finance' : `Recording as ${actor.name}`}</span>
          </div>
          {!readOnly && !selected.closed && !isMember && selected.payments.length > 0 && (
            <p className="finance-member-message">This period’s roster is locked because a payment has been recorded.</p>
          )}
          <p className="finance-feedback" role="status">{message}</p>

          <section className="finance-metrics" aria-label="Pay period totals">
            <FinanceMetric label="Period spending" value={money(selectedBalances.spentMinor)} detail={`Split across ${selected.members.length} ${selected.members.length === 1 ? 'member' : 'members'}`} Icon={ReceiptText} featured />
            <FinanceMetric label="Your share" value={myBalance ? money(myBalance.shareMinor) : '—'} detail={myBalance ? `${money(myBalance.paidMinor)} paid for expenses` : 'No share in this period'} Icon={UsersRound} />
            <FinanceMetric label="Your balance" value={myBalance ? money(Math.abs(myBalance.netMinor)) : '—'} detail={myBalance ? balanceLabel(myBalance.netMinor) : 'No balance in this period'} Icon={CircleDollarSign} />
            <FinanceMetric label="Payments outstanding" value={money(selectedBalances.outstandingMinor)} detail={`${selectedBalances.transfers.length} suggested ${selectedBalances.transfers.length === 1 ? 'payment' : 'payments'}`} Icon={HandCoins} />
          </section>

          <div className="finance-balances-layout">
            <MemberBalances balances={selectedBalances} actor={actor} money={money} />
            <SuggestedPayments
              period={selected}
              transfers={selectedBalances.transfers}
              actor={actor}
              money={money}
              readOnly={readOnly}
              onRecord={(transfer) => setDialog({ type: 'payment', transfer })}
            />
          </div>

          {earlierBalances.length > 0 && (
            <section className="panel finance-panel" aria-labelledby="finance-earlier-heading">
              <div className="finance-panel-heading">
                <h2 id="finance-earlier-heading">Earlier balances</h2>
                <p>{money(earlierOutstanding)} remains to settle separately in closed pay periods.</p>
              </div>
              <ul className="finance-transfer-list">
                {earlierBalances.map(({ period, outstandingMinor }) => (
                  <li className="finance-transfer" key={period.id}>
                    <span className="finance-transfer-icon"><History size={16} aria-hidden="true" /></span>
                    <span className="finance-transfer-parties"><strong>{period.label}</strong><span>{period.closed && formatDate(period.closed.at)}</span></span>
                    <strong className="finance-entry-amount">{money(outstandingMinor)}</strong>
                    <button className="button ghost" type="button" onClick={() => { setPeriodId(period.id); window.scrollTo({ top: 0 }) }}>View period</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ExpenseHistory
            key={selected.id}
            period={selected}
            actor={actor}
            money={money}
            readOnly={readOnly}
            onVoid={(expense) => setDialog({ type: 'void-expense', expense })}
          />
          <PaymentHistory
            period={selected}
            actor={actor}
            money={money}
            readOnly={readOnly}
            onVoid={(payment) => setDialog({ type: 'void-payment', payment })}
          />
        </>
      ) : (
        <section className="panel">
          <EmptyState
            title="No pay period yet"
            description="Start a pay period to track and split this project’s expenses."
          />
        </section>
      )}

      {!!project.finance?.entries.length && <LegacyFinance entries={project.finance.entries} currency={project.finance.currency} />}

      {!readOnly && dialog?.type === 'start' && canStart && (
        <StartPeriodModal
          actor={actor}
          previous={latest}
          currency={ledger.currency}
          outstandingMinor={currentBalances?.outstandingMinor ?? 0}
          onStart={startPeriod}
          onClose={() => setDialog(null)}
        />
      )}
      {!readOnly && selected && dialog?.type === 'join' && canJoin && (
        <JoinPeriodModal
          period={selected}
          onJoin={() => updatePeriod({ ...selected, members: [...selected.members, { id: actor.id, name: actor.name }] }, 'Joined pay period.')}
          onClose={() => setDialog(null)}
        />
      )}
      {!readOnly && selected && dialog?.type === 'expense' && canLogExpense && (
        <TransactionModal
          currency={ledger.currency}
          onRecord={({ amountMinor, date, text, category }) => updatePeriod({
            ...selected,
            expenses: [...selected.expenses, {
              id: newId(), memberId: actor.id, amountMinor, date, description: text,
              ...(category && { category }), createdAt: new Date().toISOString(),
            }],
          }, 'Expense logged.')}
          onClose={() => setDialog(null)}
        />
      )}
      {!readOnly && selected && dialog?.type === 'payment' && (
        <TransactionModal
          currency={ledger.currency}
          transfer={dialog.transfer}
          period={selected}
          onRecord={({ amountMinor, date, text }) => updatePeriod({
            ...selected,
            payments: [...selected.payments, {
              id: newId(), fromId: dialog.transfer.fromId, toId: dialog.transfer.toId, amountMinor, date,
              note: text, recordedById: actor.id, recordedByName: actor.name, createdAt: new Date().toISOString(),
            }],
          }, 'Payment recorded.')}
          onClose={() => setDialog(null)}
        />
      )}
      {!readOnly && selected && dialog?.type === 'void-expense' && (
        <VoidModal
          kind="expense"
          summary={dialog.expense.description}
          amount={money(dialog.expense.amountMinor)}
          onVoid={(reason) => updatePeriod({
            ...selected,
            expenses: selected.expenses.map((expense) => expense.id === dialog.expense.id ? { ...expense, voided: makeVoid(reason) } : expense),
          }, 'Expense voided.')}
          onClose={() => setDialog(null)}
        />
      )}
      {!readOnly && selected && dialog?.type === 'void-payment' && (
        <VoidModal
          kind="payment"
          summary={`${memberName(selected, dialog.payment.fromId)} to ${memberName(selected, dialog.payment.toId)}`}
          amount={money(dialog.payment.amountMinor)}
          onVoid={(reason) => updatePeriod({
            ...selected,
            payments: selected.payments.map((payment) => payment.id === dialog.payment.id ? { ...payment, voided: makeVoid(reason) } : payment),
          }, 'Payment voided.')}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function balanceLabel(amount: number) {
  if (amount > 0) return 'Receives'
  if (amount < 0) return 'Owes'
  return 'Settled'
}

function memberName(period: PayPeriod, id: string) {
  return period.members.find((member) => member.id === id)?.name ?? 'Unknown member'
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

function MemberBalances({ balances, actor, money }: { balances: Balances; actor: FinanceActor; money: Money }) {
  return (
    <section className="panel finance-panel" aria-labelledby="finance-members-heading">
      <div className="finance-panel-heading">
        <h2 id="finance-members-heading">Member balances</h2>
        <p>Equal shares are adjusted in cents so they add up to total spending.</p>
      </div>
      <div className="table-scroll finance-table-scroll">
        <table className="data-table finance-members-table" aria-label="Member balances">
          <thead>
            <tr><th scope="col">Member</th><th scope="col">Paid</th><th scope="col">Equal share</th><th scope="col">Net balance</th></tr>
          </thead>
          <tbody>
            {balances.balances.map((member) => (
              <tr key={member.id}>
                <th scope="row">{member.name} {member.id === actor.id && <span className="finance-you">You</span>}</th>
                <td>{money(member.paidMinor)}</td>
                <td>{money(member.shareMinor)}</td>
                <td>
                  <span className="finance-net" data-tone={balanceLabel(member.netMinor)}>
                    {member.netMinor ? `${balanceLabel(member.netMinor)} ${money(Math.abs(member.netMinor))}` : 'Settled'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SuggestedPayments({ period, transfers, actor, money, readOnly, onRecord }: {
  period: PayPeriod
  transfers: PayTransfer[]
  actor: FinanceActor
  money: Money
  readOnly: boolean
  onRecord: (transfer: PayTransfer) => void
}) {
  return (
    <section className="panel finance-panel" aria-labelledby="finance-payments-heading">
      <div className="finance-panel-heading">
        <h2 id="finance-payments-heading">Suggested payments</h2>
        <p>Record each transfer after the members have paid.</p>
      </div>
      {transfers.length ? (
        <ul className="finance-transfer-list">
          {transfers.map((transfer) => (
            <li className="finance-transfer" key={`${transfer.fromId}:${transfer.toId}`}>
              <span className="finance-transfer-icon"><HandCoins size={16} aria-hidden="true" /></span>
              <span className="finance-transfer-parties">
                <strong>{memberName(period, transfer.fromId)}</strong>
                <span>to {memberName(period, transfer.toId)}</span>
              </span>
              <strong className="finance-entry-amount">{money(transfer.amountMinor)}</strong>
              {!readOnly && (actor.role === 'admin' || actor.id === transfer.fromId) && (
                <button type="button" className="button secondary" onClick={() => onRecord(transfer)}>Record payment</button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No payments due" description="Everyone’s balance is settled for this period." />
      )}
    </section>
  )
}

function ExpenseHistory({ period, actor, money, readOnly, onVoid }: {
  period: PayPeriod
  actor: FinanceActor
  money: Money
  readOnly: boolean
  onVoid: (expense: PayExpense) => void
}) {
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const expenses = period.expenses
    .filter((expense) => [expense.description, expense.category, memberName(period, expense.memberId)]
      .some((text) => text?.toLowerCase().includes(search)))
    .sort((left, right) => right.date.localeCompare(left.date) || Date.parse(right.createdAt) - Date.parse(left.createdAt))

  return (
    <section className="panel finance-panel" aria-labelledby="finance-expense-history">
      <div className="finance-panel-heading finance-history-heading">
        <div>
          <h2 id="finance-expense-history">Expense history</h2>
          <p>{period.expenses.length} {period.expenses.length === 1 ? 'entry' : 'entries'} in this period</p>
        </div>
        {period.expenses.length > 0 && (
          <div className="finance-search">
            <Search size={16} aria-hidden="true" />
            <input className="input" type="search" aria-label="Search expenses" placeholder="Search expenses…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        )}
      </div>
      {expenses.length ? (
        <div className="table-scroll finance-table-scroll">
          <table className="data-table finance-ledger-table" aria-label="Expense history">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Paid by</th><th scope="col">Amount</th><th scope="col">Status</th></tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id} className={expense.voided ? 'finance-voided' : undefined}>
                  <td className="finance-date">{formatDate(expense.date)}</td>
                  <td className="finance-entry-detail">
                    <strong>{expense.description}</strong>
                    {expense.category && <span>{expense.category}</span>}
                    {expense.voided && <VoidDetails record={expense.voided} />}
                  </td>
                  <td>{memberName(period, expense.memberId)}</td>
                  <td className="finance-entry-amount">{money(expense.amountMinor)}</td>
                  <td>{expense.voided ? <span className="badge">Voided</span> : !readOnly && !period.closed && (actor.role === 'admin' || expense.memberId === actor.id) && (
                    <button type="button" className="button ghost finance-void-button" onClick={() => onVoid(expense)}>Void expense</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={period.expenses.length ? 'No matching expenses' : 'No expenses logged'} description={period.expenses.length ? 'Try a different search.' : undefined} />
      )}
    </section>
  )
}

function PaymentHistory({ period, actor, money, readOnly, onVoid }: {
  period: PayPeriod
  actor: FinanceActor
  money: Money
  readOnly: boolean
  onVoid: (payment: PayPayment) => void
}) {
  const payments = [...period.payments]
    .sort((left, right) => right.date.localeCompare(left.date) || Date.parse(right.createdAt) - Date.parse(left.createdAt))
  const canVoid = !readOnly && actor.role === 'admin' && (!period.closed || period.closed.carry)

  return (
    <section className="panel finance-panel" aria-labelledby="finance-payment-history">
      <div className="finance-panel-heading">
        <h2 id="finance-payment-history">Payment history</h2>
        <p>{payments.length} {payments.length === 1 ? 'payment' : 'payments'} recorded in this period</p>
      </div>
      {payments.length ? (
        <div className="table-scroll finance-table-scroll">
          <table className="data-table finance-ledger-table" aria-label="Payment history">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Amount</th><th scope="col">Record</th></tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className={payment.voided ? 'finance-voided' : undefined}>
                  <td className="finance-date">{formatDate(payment.date)}</td>
                  <td>{memberName(period, payment.fromId)}</td>
                  <td>{memberName(period, payment.toId)}</td>
                  <td className="finance-entry-amount">{money(payment.amountMinor)}</td>
                  <td className="finance-entry-detail">
                    <strong>Recorded by {payment.recordedByName}</strong>
                    {payment.note && <span>{payment.note}</span>}
                    {payment.voided ? <VoidDetails record={payment.voided} /> : canVoid && (
                      <button type="button" className="button ghost finance-void-button" onClick={() => onVoid(payment)}>Void payment</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="No payments recorded" />}
    </section>
  )
}

function VoidDetails({ record }: { record: NonNullable<PayExpense['voided']> }) {
  return <span>Voided by {record.byName} on {formatDate(record.at)}. {record.reason}</span>
}

function LegacyFinance({ entries, currency }: { entries: FinanceEntry[]; currency: Currency }) {
  return (
    <details className="panel finance-panel finance-legacy">
      <summary>Previous ledger entries <span className="chip mono">{currency}</span></summary>
      <div className="table-scroll finance-table-scroll">
        <table className="data-table finance-ledger-table" aria-label="Previous ledger entries">
          <thead>
            <tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Type</th><th scope="col">Member</th><th scope="col">Amount</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={entry.voided ? 'finance-voided' : undefined}>
                <td className="finance-date">{formatDate(entry.date)}</td>
                <td className="finance-entry-detail">
                  <strong>{entry.description}</strong>
                  {entry.category && <span>{entry.category}</span>}
                  {entry.voided && <VoidDetails record={entry.voided} />}
                </td>
                <td>{legacyTypes[entry.kind]}</td>
                <td>{entry.memberName}</td>
                <td className="finance-entry-amount">{formatFinanceMoney(entry.amountMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function StartPeriodModal({ actor, previous, currency, outstandingMinor, onStart, onClose }: {
  actor: FinanceActor
  previous?: PayPeriod
  currency: Currency
  outstandingMinor: number
  onStart: (label: string, currency: Currency, members: PayMember[], carry: boolean) => string | null
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [selectedCurrency, setSelectedCurrency] = useState(currency)
  const [carry, setCarry] = useState(false)
  const [error, setError] = useState('')
  const [memberIds, setMemberIds] = useState(() => new Set(previous?.members.map((member) => member.id) ?? [actor.id]))
  const formerMembers = previous?.members ?? []
  const members = [
    ...formerMembers.filter((member) => member.id !== actor.id),
    { id: actor.id, name: actor.name },
  ]

  function toggleMember(id: string, included: boolean) {
    setMemberIds((current) => {
      const updated = new Set(current)
      if (included) updated.add(id)
      else updated.delete(id)
      return updated
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!label.trim()) {
      setError('Enter a name for the new pay period.')
      return
    }
    const roster = members.filter((member) => memberIds.has(member.id))
    if (roster.length === 0) {
      setError('Select at least one member for the new period.')
      return
    }
    if (outstandingMinor > 0 && !carry) {
      setError('Settle the remaining payments or carry the unpaid balances.')
      return
    }
    setError(onStart(label.trim(), selectedCurrency, roster, carry) ?? '')
  }

  return (
    <Modal
      title={previous ? 'Start new pay period' : 'Start first pay period'}
      description={previous ? 'The new period starts at zero. Earlier expenses and payments remain in their original period.' : 'Members can join before a payment is recorded.'}
      onClose={onClose}
    >
      <form className="finance-form" onSubmit={submit}>
        <label className="field">
          Pay period name
          <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. November 16–30" maxLength={120} required autoFocus />
        </label>
        {!previous && (
          <label className="field">
            Currency
            <select className="input" value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value as Currency)}>
              {financeCurrencies.map((code) => <option key={code}>{code}</option>)}
            </select>
          </label>
        )}
        {previous && (
          <fieldset className="finance-roster">
            <legend>Members in the new period</legend>
            {members.map((member) => (
              <label className="finance-check" key={member.id}>
                <input type="checkbox" checked={memberIds.has(member.id)} onChange={(event) => toggleMember(member.id, event.target.checked)} />
                <span>{member.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        {outstandingMinor > 0 && (
          <label className="finance-check finance-carry">
            <input type="checkbox" checked={carry} onChange={(event) => setCarry(event.target.checked)} />
            <span>
              <strong>Carry unpaid balances</strong>
              <small>{formatFinanceMoney(outstandingMinor, currency)} will remain payable in the closed period.</small>
            </span>
          </label>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary">Start pay period</button>
        </div>
      </form>
    </Modal>
  )
}

function JoinPeriodModal({ period, onJoin, onClose }: { period: PayPeriod; onJoin: () => string | null; onClose: () => void }) {
  const [error, setError] = useState('')
  return (
    <Modal title="Join pay period?" description={period.label} onClose={onClose}>
      <p className="muted">Joining recalculates each member’s equal share of expenses in this period.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="button primary" onClick={() => setError(onJoin() ?? '')}>Join pay period</button>
      </div>
    </Modal>
  )
}

function localDate() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function TransactionModal({ currency, transfer, period, onRecord, onClose }: {
  currency: Currency
  transfer?: PayTransfer
  period?: PayPeriod
  onRecord: (entry: { amountMinor: number; date: string; text: string; category: string }) => string | null
  onClose: () => void
}) {
  const [amount, setAmount] = useState(transfer ? (Math.min(transfer.amountMinor, maxFinanceAmountMinor) / 100).toFixed(2) : '')
  const [text, setText] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState(localDate)
  const [error, setError] = useState('')
  const [amountError, setAmountError] = useState('')
  const categoryId = useId()
  const amountId = useId()
  const title = transfer ? 'Record payment' : 'Log expense'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const amountMinor = parseFinanceAmount(amount)
    if (amountMinor === null) {
      setAmountError(`Enter a positive amount up to ${formatFinanceMoney(maxFinanceAmountMinor, currency)} with at most two decimal places.`)
      return
    }
    setAmountError('')
    if (!transfer && !text.trim()) {
      setError('Enter a description for this expense.')
      return
    }
    setError(onRecord({ amountMinor, date, text: text.trim(), category: category.trim() }) ?? '')
  }

  return (
    <Modal
      title={title}
      description={transfer && period ? `${memberName(period, transfer.fromId)} pays ${memberName(period, transfer.toId)}.` : 'Record a project expense you paid personally.'}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor={amountId}>Amount</label>
            <div className="finance-amount-input">
              <input
                id={amountId}
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                maxLength={24}
                value={amount}
                onChange={(event) => { setAmount(event.target.value); setAmountError('') }}
                aria-invalid={Boolean(amountError)}
                aria-describedby={amountError ? `${amountId}-error` : undefined}
                required
                autoFocus
              />
              <span className="mono">{currency}</span>
            </div>
            {amountError && <p className="finance-amount-error" id={`${amountId}-error`} role="alert">{amountError}</p>}
          </div>
          <label className="field">Date<input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label className="field field-wide">
            {transfer ? 'Note' : 'Description'}
            <textarea className="input" rows={3} maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} required={!transfer} />
          </label>
          {!transfer && (
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
          <button type="submit" className="button primary">{title} {transfer && <ArrowRight size={15} aria-hidden="true" />}</button>
        </div>
      </form>
    </Modal>
  )
}

function VoidModal({ kind, summary, amount, onClose, onVoid }: {
  kind: 'expense' | 'payment'
  summary: string
  amount: string
  onClose: () => void
  onVoid: (reason: string) => string | null
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason.trim()) {
      setError('Enter a reason for voiding this entry.')
      return
    }
    setError(onVoid(reason.trim()) ?? '')
  }

  return (
    <Modal title={`Void ${kind}?`} description="Voiding keeps the record and recalculates balances." onClose={onClose}>
      <p className="finance-void-context"><strong>{amount}</strong> · {summary}</p>
      <form onSubmit={submit}>
        <label className="field">
          Void reason
          <textarea className="input" rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} required autoFocus />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="button finance-danger">Void {kind}</button>
        </div>
      </form>
    </Modal>
  )
}
