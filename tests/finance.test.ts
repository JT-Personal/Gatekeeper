import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workspaceSchema, type Workspace } from '../src/domain.ts'
import {
  calculateFinance,
  demoFinanceActor,
  financeLedgerSchema,
  getLedger,
  parseFinanceAmount,
  stampFinanceChanges,
  validateFinanceChanges,
  validateFinanceLedgerChanges,
  type FinanceActor,
  type FinanceEntry,
  type FinanceLedger,
} from '../src/finance.ts'
import { createProject, initialWorkspace } from '../src/seed.ts'

const admin = demoFinanceActor
const founder: FinanceActor = { id: 'demo-daniel', name: 'Daniel Park', role: 'founder' }
const date = '2026-11-18'
const clientTime = `${date}T12:00:00Z`
const serverTime = `${date}T12:01:00Z`

const daniel = { id: 'demo-daniel', name: 'Daniel Park' }
const financeRecords: [FinanceEntry['kind'], number, string, string, string, { id: string; name: string }][] = [
  ['contribution', 185_000, '2026-10-12', 'Maya’s founding contribution', 'Funding', demoFinanceActor],
  ['contribution', 115_000, '2026-10-13', 'Daniel’s founding contribution', 'Funding', daniel],
  ['expense', 84_640, '2026-10-26', 'Prototype housing machining and materials', 'Prototypes', demoFinanceActor],
  ['expense', 67_000, '2026-11-04', 'Dynamometer fixture and instrumentation', 'Test equipment', daniel],
  ['reimbursement', 37_500, '2026-11-10', 'Partial reimbursement for prototype housings', 'Prototypes', demoFinanceActor],
  ['reimbursement', 22_500, '2026-11-11', 'Partial reimbursement for test equipment', 'Test equipment', daniel],
  ['fund-expense', 25_000, '2026-11-16', 'Environmental lab reservation deposit', 'Testing', demoFinanceActor],
]

const legacyFinance: FinanceLedger = {
  currency: 'USD',
  entries: financeRecords.map(([kind, amountMinor, date, description, category, member], index) => {
    const recorder = kind === 'reimbursement' ? demoFinanceActor : member
    return {
      id: `orion-drive:finance-${index + 1}`, kind, amountMinor, date, description, category,
      memberId: member.id, memberName: member.name, recordedById: recorder.id, recordedByName: recorder.name,
      createdAt: `${date}T15:00:00Z`,
    }
  }),
}


function record(id: string, kind: FinanceEntry['kind'], actor: FinanceActor, overrides: Partial<FinanceEntry> = {}): FinanceEntry {
  return {
    id, kind, date, amountMinor: 10_000, description: 'Prototype tooling',
    memberId: actor.id, memberName: actor.name, recordedById: actor.id, recordedByName: actor.name,
    createdAt: clientTime, ...overrides,
  }
}

function append(ledger: FinanceLedger, ...entries: FinanceEntry[]): FinanceLedger {
  return { ...ledger, entries: [...ledger.entries, ...entries] }
}

function markVoid(entry: FinanceEntry, actor: FinanceActor): FinanceEntry {
  return { ...entry, voided: { byId: actor.id, byName: actor.name, at: clientTime, reason: 'Duplicate receipt' } }
}

function demo() {
  return workspaceSchema.parse({
    ...initialWorkspace,
    projects: [{ ...initialWorkspace.projects[0], finance: legacyFinance }],
  })
}

test('legacy APQP workspaces open with a default empty ledger and samples round-trip', () => {
  const workspace = demo()
  delete workspace.projects[0].finance
  assert.deepEqual(getLedger(workspaceSchema.parse(workspace).projects[0]), { currency: 'USD', entries: [] })

  const imported = JSON.parse(JSON.stringify(initialWorkspace))
  assert.deepEqual(workspaceSchema.parse(imported), initialWorkspace)
})

test('the ledger tracks pooled cash, founder obligations, and spending without counting reimbursements twice', () => {
  const ledger = getLedger(demo().projects[0])
  const totals = calculateFinance(ledger)
  assert.equal(totals.contributionsMinor, 300_000)
  assert.equal(totals.cashMinor, 215_000)
  assert.equal(totals.expenseMinor, 176_640)
  assert.equal(totals.fundExpenseMinor, 25_000)
  assert.equal(totals.outOfPocketMinor, 151_640)
  assert.equal(totals.reimbursementMinor, 60_000)
  assert.equal(totals.owedMinor, 91_640)
  assert.deepEqual(totals.members.map(({ name, owedMinor }) => [name, owedMinor]), [['Maya Chen', 47_140], ['Daniel Park', 44_500]])

  const expense = record('new-expense', 'expense', founder)
  const added = append(ledger, expense)
  assert.equal(calculateFinance(added).owedMinor, totals.owedMinor + expense.amountMinor)
  assert.deepEqual(calculateFinance(append(ledger, markVoid(expense, founder))), totals)
})

test('amount parsing and ledger imports reject fractional minor units, invalid dates, and duplicate IDs', () => {
  assert.equal(parseFinanceAmount(' 123.45 '), 12_345)
  assert.equal(parseFinanceAmount('.07'), 7)
  assert.equal(parseFinanceAmount('1.2'), 120)
  for (const value of ['0', '-1', '1.001', '1e4', '1,100', '1000000000.01']) {
    assert.equal(parseFinanceAmount(value), null, value)
  }

  const ledger = getLedger(demo().projects[0])
  assert.equal(financeLedgerSchema.safeParse(append(ledger, ledger.entries[0])).success, false)
  assert.equal(financeLedgerSchema.safeParse(append(ledger, record('bad-date', 'expense', founder, { date: '2026-02-31' }))).success, false)
  assert.equal(financeLedgerSchema.safeParse(append(ledger, record('bad-minor', 'expense', founder, { amountMinor: 1.1 }))).success, false)
})

test('a founder can post their own transactions while protected payments require an administrator', () => {
  const ledger = getLedger(demo().projects[0])
  const expense = record('new-expense', 'expense', founder)
  const contribution = record('new-contribution', 'contribution', founder)
  assert.equal(validateFinanceLedgerChanges(ledger, append(ledger, expense, contribution), founder), null)
  assert.match(validateFinanceLedgerChanges(ledger, append(ledger, expense), null) ?? '', /signed-in/)
  assert.match(validateFinanceLedgerChanges(ledger, append(ledger, { ...expense, recordedById: admin.id }), founder) ?? '', /attributed/)
  assert.match(validateFinanceLedgerChanges(ledger, append(ledger, { ...expense, memberId: admin.id }), founder) ?? '', /belong/)
  assert.match(validateFinanceLedgerChanges(ledger, append(ledger, record('fund', 'fund-expense', founder)), founder) ?? '', /administrator/)
  assert.match(validateFinanceLedgerChanges(ledger, append(ledger, record('repay', 'reimbursement', founder)), founder) ?? '', /administrator/)
})

test('administrators can pay current founder obligations and spend project funds within balances', () => {
  const ledger = getLedger(demo().projects[0])
  const reimbursement = record('repay', 'reimbursement', admin, { memberId: founder.id, memberName: founder.name })
  const pooledExpense = record('pooled', 'fund-expense', admin)
  assert.equal(validateFinanceLedgerChanges(ledger, append(ledger, reimbursement, pooledExpense), admin), null)
  assert.match(validateFinanceLedgerChanges(ledger, append(ledger, { ...reimbursement, memberName: 'Wrong founder' }), admin) ?? '', /Choose a founder/)
  assert.match(validateFinanceLedgerChanges(ledger, append(ledger, { ...reimbursement, amountMinor: 44_501 }), admin) ?? '', /reimbursements exceed/i)
  assert.match(validateFinanceLedgerChanges(ledger, append(ledger, { ...pooledExpense, amountMinor: 215_001 }), admin) ?? '', /available project funds/)

  const empty: FinanceLedger = { currency: 'USD', entries: [] }
  const funding = record('funding', 'contribution', admin)
  assert.match(validateFinanceLedgerChanges(empty, append(empty, pooledExpense, funding), admin) ?? '', /available project funds/)
  assert.equal(validateFinanceLedgerChanges(empty, append(empty, funding, pooledExpense), admin), null)
})

test('entries are append-only and a void requires authorization and an intact final ledger', () => {
  const ledger = getLedger(demo().projects[0])
  const rewritten = { ...ledger, entries: [{ ...ledger.entries[0], amountMinor: 200_000 }, ...ledger.entries.slice(1)] }
  assert.match(validateFinanceLedgerChanges(ledger, rewritten, admin) ?? '', /cannot be edited/)
  assert.match(validateFinanceLedgerChanges(ledger, { ...ledger, entries: ledger.entries.slice(0, -1) }, admin) ?? '', /cannot be deleted/)

  const expense = record('new-expense', 'expense', founder)
  const posted = append(ledger, expense)
  const voided = append(ledger, markVoid(expense, founder))
  assert.equal(validateFinanceLedgerChanges(posted, voided, founder), null)
  assert.match(validateFinanceLedgerChanges(voided, posted, founder) ?? '', /cannot be edited or reversed/)
  const anotherFounderExpense = record('other-expense', 'expense', admin)
  assert.match(validateFinanceLedgerChanges(append(ledger, anotherFounderExpense), append(ledger, markVoid(anotherFounderExpense, founder)), founder) ?? '', /own expenses/)

  const priorExpense = ledger.entries.find((entry) => entry.kind === 'expense' && entry.memberId === founder.id)
  assert.ok(priorExpense)
  const removesReimbursedExpense = { ...ledger, entries: ledger.entries.map((entry) => entry === priorExpense ? markVoid(entry, founder) : entry) }
  assert.match(validateFinanceLedgerChanges(ledger, removesReimbursedExpense, founder) ?? '', /reimbursements exceed/i)
  const replacement = record('replacement', 'expense', founder, { amountMinor: priorExpense.amountMinor })
  assert.equal(validateFinanceLedgerChanges(ledger, append(removesReimbursedExpense, replacement), founder), null)
})

test('currency stays fixed after posting and financial projects cannot be deleted or re-identified', () => {
  const current = demo()
  const [project] = current.projects
  const ledger = getLedger(project)
  assert.match(validateFinanceLedgerChanges(ledger, { ...ledger, currency: 'CAD' }, admin) ?? '', /fixed/)
  assert.match(validateFinanceLedgerChanges(undefined, { currency: 'CAD', entries: [] }, founder) ?? '', /administrator/)
  assert.equal(validateFinanceLedgerChanges(undefined, { currency: 'CAD', entries: [] }, admin), null)
  assert.match(validateFinanceChanges(current, { schemaVersion: 1, projects: [] }, admin) ?? '', /financial history/)
  assert.match(validateFinanceChanges(current, { schemaVersion: 1, projects: [{ ...project, id: 'different-project' }] }, admin) ?? '', /financial history/)
  assert.equal(validateFinanceChanges(current, { schemaVersion: 1, projects: [{ ...project, name: 'Updated project title' }] }, null), null)

  const unrelated = createProject({ code: 'UNR-01', name: 'Unrelated', owner: '', description: '' })
  unrelated.finance = { currency: 'USD', entries: [ledger.entries[0]] }
  assert.equal(workspaceSchema.safeParse({ ...current, projects: [project, unrelated] }).success, false)
})

test('server reconciliation stamps new actions and preserves existing authoritative timestamps', () => {
  const current = demo()
  const [project] = current.projects
  const ledger = getLedger(project)
  const expense = record('new-expense', 'expense', founder)
  const draft: Workspace = { schemaVersion: 1, projects: [{ ...project, finance: append(ledger, markVoid(expense, founder)) }] }
  assert.equal(validateFinanceChanges(current, draft, founder), null)

  const saved = stampFinanceChanges(current, draft, serverTime)
  const savedRecord = getLedger(saved.projects[0]).entries.at(-1)
  assert.equal(savedRecord?.createdAt, serverTime)
  assert.equal(savedRecord?.voided?.at, serverTime)

  const queued: Workspace = { ...draft, projects: [{ ...draft.projects[0], name: 'Queued APQP edit' }] }
  assert.equal(validateFinanceChanges(saved, queued, founder), null)
  const reconciled = stampFinanceChanges(saved, queued, `${date}T12:02:00Z`)
  assert.deepEqual(getLedger(reconciled.projects[0]), getLedger(saved.projects[0]))
})
