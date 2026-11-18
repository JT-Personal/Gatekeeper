import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workspaceSchema, type Workspace } from '../src/domain.ts'
import { type FinanceActor } from '../src/finance.ts'
import {
  calculatePeriod, getPayLedger, payLedgerSchema, stampPayChanges,
  validatePayLedgerChanges, validatePayWorkspaceChanges,
  type PayExpense, type PayLedger, type PayPayment, type PayPeriod,
} from '../src/payPeriods.ts'
import { createProject, initialWorkspace } from '../src/seed.ts'

const alex: FinanceActor = { id: 'founder-a', name: 'Alex', role: 'admin' }
const blair: FinanceActor = { id: 'founder-b', name: 'Blair', role: 'founder' }
const cam: FinanceActor = { id: 'founder-c', name: 'Cam', role: 'founder' }
const drew: FinanceActor = { id: 'founder-d', name: 'Drew', role: 'founder' }
const date = '2026-11-18'
const time = `${date}T12:00:00Z`
const serverTime = `${date}T12:00:01Z`

function member({ id, name }: FinanceActor) {
  return { id, name }
}

function period(opener = alex, people = [alex, blair], id = 'period-1'): PayPeriod {
  return { id, label: 'Prototype sprint', openedAt: time, openedById: opener.id, openedByName: opener.name, members: people.map(member), expenses: [], payments: [] }
}

function ledger(...periods: PayPeriod[]): PayLedger {
  return { currency: 'USD', periods }
}

function expense(actor: FinanceActor, amountMinor = 10_000): PayExpense {
  return { id: `expense-${actor.id}`, memberId: actor.id, amountMinor, date, description: 'Fixture parts', createdAt: time }
}

function payment(from: FinanceActor, to: FinanceActor, amountMinor: number, enteredBy = from, id = 'payment-1'): PayPayment {
  return { id, fromId: from.id, toId: to.id, amountMinor, date, note: 'Bank transfer', createdAt: time, recordedById: enteredBy.id, recordedByName: enteredBy.name }
}

function closed(carry: boolean) {
  return { at: time, byId: alex.id, byName: alex.name, carry }
}

function voided(by = alex) {
  return { at: time, byId: by.id, byName: by.name, reason: 'Duplicate entry' }
}

test('splits whole cents exactly and distributes remainders by member ID', () => {
  const seeded = { ...period(alex, [cam, blair, alex]), expenses: [expense(cam, 10_001)] }
  const result = calculatePeriod(seeded)
  assert.equal(result.spentMinor, 10_001)
  assert.deepEqual(result.balances.map(({ name, shareMinor, netMinor }) => [name, shareMinor, netMinor]), [
    ['Alex', 3334, -3334], ['Blair', 3334, -3334], ['Cam', 3333, 6668],
  ])
  assert.deepEqual(result.transfers, [
    { fromId: alex.id, toId: cam.id, amountMinor: 3334 },
    { fromId: blair.id, toId: cam.id, amountMinor: 3334 },
  ])
  assert.equal(calculatePeriod({ ...seeded, payments: [payment(blair, cam, 3334)] }).outstandingMinor, 3334)
})

test('first-period initialization, self-joining, and active display changes respect actor identity', () => {
  const first = period(blair, [blair])
  assert.equal(validatePayLedgerChanges(undefined, ledger(first), blair), null)
  assert.match(validatePayLedgerChanges(undefined, ledger(period(blair)), blair) ?? '', /starts with the member/)
  assert.match(validatePayLedgerChanges(undefined, ledger(first), null) ?? '', /signed-in member/)

  const joined = { ...first, members: [...first.members, member(alex)] }
  assert.equal(validatePayLedgerChanges(ledger(first), ledger(joined), alex), null)
  assert.match(validatePayLedgerChanges(ledger(first), ledger(joined), cam) ?? '', /own roster/)

  const renamed = { ...alex, name: 'Alex Morgan' }
  assert.equal(validatePayLedgerChanges(ledger(joined), ledger({ ...joined, members: [member(blair), member(renamed)] }), renamed), null)

  const paid = { ...joined, expenses: [expense(alex)], payments: [payment(blair, alex, 5000)] }
  assert.match(validatePayLedgerChanges(ledger(paid), ledger({ ...paid, members: [...paid.members, member(cam)] }), cam) ?? '', /first recorded payment/)
})

test('records only the acting member’s expenses and retains records when voided', () => {
  const start = period()
  const receipt = expense(blair)
  const posted = { ...start, expenses: [receipt] }
  assert.equal(validatePayLedgerChanges(ledger(start), ledger(posted), blair), null)
  assert.match(validatePayLedgerChanges(ledger(start), ledger(posted), alex) ?? '', /own expenses/)
  assert.match(validatePayLedgerChanges(ledger(posted), ledger(start), blair) ?? '', /cannot be deleted/)
  assert.match(validatePayLedgerChanges(ledger(posted), ledger({ ...posted, expenses: [{ ...receipt, amountMinor: 5001 }] }), blair) ?? '', /cannot be edited/)

  const canceled = { ...posted, expenses: [{ ...receipt, voided: voided(blair) }] }
  assert.equal(validatePayLedgerChanges(ledger(posted), ledger(canceled), blair), null)
  assert.equal(calculatePeriod(canceled).spentMinor, 0)
  assert.match(validatePayLedgerChanges(ledger(canceled), ledger(posted), blair) ?? '', /cannot be edited or reversed/)
})

test('any current debtor-to-creditor payment is allowed within both positions', () => {
  const start = { ...period(alex, [alex, blair, cam, drew]), expenses: [expense(alex), expense(blair)] }
  assert.equal(calculatePeriod(start).transfers[0].toId, alex.id)
  const paid = { ...start, payments: [payment(cam, blair, 2500)] }
  assert.equal(validatePayLedgerChanges(ledger(start), ledger(paid), cam), null)
  assert.equal(calculatePeriod(paid).outstandingMinor, 7500)
  assert.match(validatePayLedgerChanges(ledger(start), ledger(paid), blair) ?? '', /paying member/)
  assert.match(validatePayLedgerChanges(ledger(start), ledger({ ...start, payments: [payment(cam, blair, 5001)] }), cam) ?? '', /exceeds the current balance/)
  assert.equal(validatePayLedgerChanges(ledger(start), ledger({ ...start, payments: [payment(cam, blair, 2500, alex)] }), alex), null)
  const twoPayments = { ...start, payments: [payment(cam, blair, 2500), payment(cam, alex, 2501, cam, 'payment-2')] }
  assert.match(validatePayLedgerChanges(ledger(start), ledger(twoPayments), cam) ?? '', /exceeds the current balance/)
})

test('a queued payment survives a later expense that changes the live balances', () => {
  const start = { ...period(), expenses: [expense(alex)] }
  const settlement = payment(blair, alex, 5000)
  const laterExpense = { ...expense(blair), createdAt: `${date}T12:00:10Z` }
  const queued = { ...start, expenses: [...start.expenses, laterExpense], payments: [settlement] }

  assert.equal(validatePayLedgerChanges(ledger(start), ledger(queued), blair), null)
  assert.deepEqual(calculatePeriod(queued).transfers, [{ fromId: alex.id, toId: blair.id, amountMinor: 5000 }])
  assert.match(validatePayLedgerChanges(ledger(start), ledger({
    ...queued, payments: [{ ...settlement, createdAt: `${date}T12:00:20Z` }],
  }), blair) ?? '', /exceeds the current balance/)
})

test('settle-or-carry keeps historical debt intact and allows a selected next roster', () => {
  const start = { ...period(), expenses: [expense(alex)] }
  const unsettled = { ...start, closed: closed(false) }
  assert.match(validatePayLedgerChanges(ledger(start), ledger(unsettled), alex) ?? '', /Settle the balance/)

  const carried = { ...start, closed: closed(true) }
  assert.equal(validatePayLedgerChanges(ledger(start), ledger(carried), alex), null)
  assert.match(validatePayLedgerChanges(ledger(start), ledger(carried), blair) ?? '', /administrator/)
  const next = period(alex, [blair], 'period-2')
  assert.equal(validatePayLedgerChanges(ledger(carried), ledger(carried, next), alex), null)
  assert.equal(calculatePeriod(carried).outstandingMinor, 5000)
  assert.equal(calculatePeriod(next).outstandingMinor, 0)
  const unexpected = { ...next, members: [member(cam)] }
  assert.match(validatePayLedgerChanges(ledger(carried), ledger(carried, unexpected), alex) ?? '', /Select members/)

  const oldPayment = { ...carried, payments: [payment(blair, alex, 2500)] }
  assert.equal(validatePayLedgerChanges(ledger(carried, next), ledger(oldPayment, next), blair), null)
  assert.equal(calculatePeriod(oldPayment).outstandingMinor, 2500)
  assert.match(validatePayLedgerChanges(ledger(carried), ledger({ ...carried, expenses: [...carried.expenses, expense(blair)] }), blair) ?? '', /frozen/)
})

test('a closed and settled period cannot regain debt unless it was closed with carry', () => {
  const transfer = payment(blair, alex, 5000)
  const settled = { ...period(), expenses: [expense(alex)], payments: [transfer], closed: closed(false) }
  const voidTransfer = { ...transfer, voided: voided() }
  assert.match(validatePayLedgerChanges(ledger(settled), ledger({ ...settled, payments: [voidTransfer] }), alex) ?? '', /Settle the balance/)
  assert.equal(validatePayLedgerChanges(ledger(settled), ledger({
    ...settled, payments: [voidTransfer, payment(blair, alex, 5000, alex, 'replacement')],
  }), alex), null)
})

test('pay periods coexist with legacy workspace records and use authoritative audit timestamps', () => {
  const legacy = structuredClone(initialWorkspace)
  delete legacy.projects[0].payPeriods
  assert.deepEqual(getPayLedger(workspaceSchema.parse(legacy).projects[0]), ledger())
  const project = createProject({ name: 'New program', code: 'PRG-100', owner: '', description: '' })
  const before: Workspace = { schemaVersion: 1, projects: [project] }
  const solo = { ...period(alex, [alex]), expenses: [expense(alex)], closed: closed(false) }
  const after: Workspace = { schemaVersion: 1, projects: [{ ...project, payPeriods: ledger(solo) }] }
  assert.equal(validatePayWorkspaceChanges(before, after, alex), null)
  const stamped = stampPayChanges(before, after, serverTime)
  const [saved] = getPayLedger(stamped.projects[0]).periods
  assert.equal(saved.openedAt, serverTime)
  assert.equal(saved.expenses[0].createdAt, serverTime)
  assert.equal(saved.closed?.at, serverTime)
  assert.equal(validatePayWorkspaceChanges(stamped, after, null), null)
  assert.deepEqual(stampPayChanges(stamped, after, `${date}T12:02:00Z`), stamped)
  assert.match(validatePayWorkspaceChanges(stamped, { schemaVersion: 1, projects: [] }, alex) ?? '', /has pay-period history/)
  assert.equal(payLedgerSchema.safeParse(ledger({ ...solo, expenses: [expense(blair)] })).success, false)
})
