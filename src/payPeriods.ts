import { z } from 'zod'
import type { Workspace } from './domain.ts'
import { financeCurrencies, maxFinanceAmountMinor, type FinanceActor } from './finance.ts'

const identity = z.string().min(1).max(200)
const name = z.string().trim().min(1).max(200)
const timestamp = z.iso.datetime({ offset: true })
const voidSchema = z.object({
  byId: identity,
  byName: name,
  at: timestamp,
  reason: z.string().trim().min(1).max(1000),
})
const recordFields = {
  id: identity,
  amountMinor: z.number().int().min(1).max(maxFinanceAmountMinor),
  date: z.iso.date(),
  createdAt: timestamp,
  voided: voidSchema.optional(),
}

const memberSchema = z.object({ id: identity, name })
const expenseSchema = z.object({
  ...recordFields,
  memberId: identity,
  description: z.string().trim().min(1).max(4000),
  category: z.string().trim().max(120).optional(),
})
const paymentSchema = z.object({
  ...recordFields,
  fromId: identity,
  toId: identity,
  note: z.string().trim().max(4000),
  recordedById: identity,
  recordedByName: name,
})
const periodSchema = z.object({
  id: identity,
  label: z.string().trim().min(1).max(120),
  openedAt: timestamp,
  openedById: identity,
  openedByName: name,
  members: z.array(memberSchema).min(1),
  expenses: z.array(expenseSchema),
  payments: z.array(paymentSchema),
  closed: z.object({ at: timestamp, byId: identity, byName: name, carry: z.boolean() }).optional(),
})

export type PayMember = z.infer<typeof memberSchema>
export type PayExpense = z.infer<typeof expenseSchema>
export type PayPayment = z.infer<typeof paymentSchema>
export type PayPeriod = z.infer<typeof periodSchema>
export type PayTransfer = Pick<PayPayment, 'fromId' | 'toId' | 'amountMinor'>

function periodBalances(period: PayPeriod) {
  const paidByMember = new Map(period.members.map(({ id }) => [id, 0]))
  let spentMinor = 0
  for (const expense of period.expenses) {
    if (expense.voided) continue
    spentMinor += expense.amountMinor
    paidByMember.set(expense.memberId, (paidByMember.get(expense.memberId) ?? 0) + expense.amountMinor)
  }

  const members = [...period.members].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  const baseShare = Math.floor(spentMinor / members.length)
  const remainder = spentMinor % members.length
  const balances = members.map(({ id, name }, index) => {
    const paidMinor = paidByMember.get(id) ?? 0
    const shareMinor = baseShare + (index < remainder ? 1 : 0)
    return { id, name, paidMinor, shareMinor, netMinor: paidMinor - shareMinor }
  })
  const byId = new Map(balances.map((balance) => [balance.id, balance]))
  for (const payment of period.payments) {
    if (payment.voided) continue
    const sender = byId.get(payment.fromId)
    const recipient = byId.get(payment.toId)
    if (sender && recipient) {
      sender.netMinor += payment.amountMinor
      recipient.netMinor -= payment.amountMinor
    }
  }
  return { spentMinor, balances }
}

export function calculatePeriod(period: PayPeriod) {
  const { spentMinor, balances } = periodBalances(period)
  const senders = balances.filter(({ netMinor }) => netMinor < 0).map(({ id, netMinor }) => ({ id, due: -netMinor }))
  const recipients = balances.filter(({ netMinor }) => netMinor > 0).map(({ id, netMinor }) => ({ id, due: netMinor }))
  const outstandingMinor = recipients.reduce((total, { due }) => total + due, 0)
  const transfers: PayTransfer[] = []
  let senderIndex = 0
  let recipientIndex = 0
  while (senderIndex < senders.length && recipientIndex < recipients.length) {
    const sender = senders[senderIndex]
    const recipient = recipients[recipientIndex]
    const amountMinor = Math.min(sender.due, recipient.due)
    transfers.push({ fromId: sender.id, toId: recipient.id, amountMinor })
    sender.due -= amountMinor
    recipient.due -= amountMinor
    if (!sender.due) senderIndex++
    if (!recipient.due) recipientIndex++
  }
  return { spentMinor, balances, transfers, outstandingMinor }
}

export const payLedgerSchema = z.object({
  currency: z.enum(financeCurrencies),
  periods: z.array(periodSchema),
}).superRefine(({ periods }, context) => {
  const periodIds = new Set<string>()
  const recordIds = new Set<string>()
  let recordCount = 0
  periods.forEach((period, index) => {
    const periodPath = ['periods', index]
    const issue = (field: string, message: string) => context.addIssue({ code: 'custom', path: [...periodPath, field], message })
    if (periodIds.has(period.id)) issue('id', 'Pay period IDs must be unique.')
    periodIds.add(period.id)
    if (!period.closed && index !== periods.length - 1) issue('closed', 'Close the current period before opening another.')

    const memberIds = new Set(period.members.map(({ id }) => id))
    if (memberIds.size !== period.members.length) issue('members', 'Members can only be added once per period.')
    if (period.expenses.some(({ memberId }) => !memberIds.has(memberId))) issue('expenses', 'Expenses must belong to a member of this period.')
    if (period.payments.some(({ fromId, toId }) => fromId === toId || !memberIds.has(fromId) || !memberIds.has(toId))) {
      issue('payments', 'Payments must be between two different members of this period.')
    }
    for (const record of [...period.expenses, ...period.payments]) {
      if (recordIds.has(record.id)) issue('id', 'Expense and payment IDs must be unique.')
      recordIds.add(record.id)
      recordCount++
    }
    if (period.closed && !period.closed.carry && calculatePeriod(period).outstandingMinor > 0) {
      issue('closed', 'Settle the balance or choose to carry it forward before closing the period.')
    }
  })
  // Bounds exact integer totals across all expenses and payments in the ledger.
  if (recordCount > 25_000) {
    context.addIssue({ code: 'custom', path: ['periods'], message: 'The project ledger has reached its 25,000-record limit.' })
  }
})

export type PayLedger = z.infer<typeof payLedgerSchema>

const emptyLedger = (): PayLedger => ({ currency: 'USD', periods: [] })

export function getPayLedger(project?: { payPeriods?: PayLedger }): PayLedger {
  return project?.payPeriods ?? emptyLedger()
}

type AuditedRecord = { id: string; createdAt: string; voided?: z.infer<typeof voidSchema> }

function validateRecordHistory<Record extends AuditedRecord>(
  previous: Record[],
  next: Record[],
  fields: readonly (keyof Record)[],
  actor: FinanceActor | null,
  canVoid: (entry: Record, actor: FinanceActor) => boolean,
  kind: string,
): string | null {
  if (next.length < previous.length) return `${kind} records cannot be deleted.`
  for (const [index, record] of next.entries()) {
    const old = previous[index]
    if (old && fields.some((field) => old[field] !== record[field])) return `${kind} records cannot be edited or reordered.`
    if (old?.voided) {
      if (!record.voided || old.voided.byId !== record.voided.byId || old.voided.byName !== record.voided.byName || old.voided.reason !== record.voided.reason) {
        return 'A recorded void cannot be edited or reversed.'
      }
    } else if (record.voided && (!actor || record.voided.byId !== actor.id || record.voided.byName !== actor.name || !canVoid(record, actor))) {
      return `The signed-in member cannot void this ${kind.toLowerCase()}.`
    }
  }
  return null
}

const expenseFields = ['id', 'memberId', 'amountMinor', 'date', 'description', 'category'] as const
const paymentFields = ['id', 'fromId', 'toId', 'amountMinor', 'date', 'note', 'recordedById', 'recordedByName'] as const

function validateRosterChanges(previous: PayPeriod, next: PayPeriod, actor: FinanceActor | null): string | null {
  if (next.members.length < previous.members.length) return 'Members cannot be removed from a period in progress.'
  for (const [index, member] of next.members.entries()) {
    const old = previous.members[index]
    if (old && member.id !== old.id) return 'Members cannot be removed or reordered.'
    if (old?.name === member.name) continue
    if (previous.closed) return 'The member roster is frozen when a period closes.'
    if (!actor || member.id !== actor.id || member.name !== actor.name) return 'Members can only update their own roster membership.'
    if (!old && previous.payments.length) return 'The roster is locked after the first recorded payment.'
  }
  return null
}

function pendingRecords<Record extends AuditedRecord>(previous: Record[], next: Record[]) {
  const changes: { record: Record; added: boolean; at: number }[] = []
  for (const [index, record] of next.entries()) {
    const old = previous[index]
    const createdAt = Date.parse(record.createdAt)
    if (!old) changes.push({ record, added: true, at: createdAt })
    if (record.voided && !old?.voided) {
      const voidedAt = Date.parse(record.voided.at)
      changes.push({ record, added: false, at: old ? voidedAt : Math.max(createdAt, voidedAt) })
    }
  }
  return changes
}

function validateSettlementAmounts(previous: PayPeriod, next: PayPeriod): string | null {
  // The client can combine consecutive actions while it waits for a save. Replay the pending
  // actions against the persisted balance so a later expense cannot invalidate an earlier payment.
  const opening = periodBalances({ ...previous, members: next.members })
  const balances = new Map(opening.balances.map((balance, index) => [balance.id, {
    index, paidMinor: balance.paidMinor, paymentsMinor: balance.netMinor - balance.paidMinor + balance.shareMinor,
  }]))
  let spentMinor = opening.spentMinor
  const pending = [
    ...pendingRecords(previous.expenses, next.expenses).map((change) => ({ ...change, type: 'expense' as const })),
    ...pendingRecords(previous.payments, next.payments).map((change) => ({ ...change, type: 'payment' as const })),
  ].sort((left, right) => left.at - right.at)

  for (const { record, added, type } of pending) {
    const amount = added ? record.amountMinor : -record.amountMinor
    if (type === 'expense') {
      spentMinor += amount
      balances.get(record.memberId)!.paidMinor += amount
      continue
    }

    const from = balances.get(record.fromId)!
    const to = balances.get(record.toId)!
    if (added) {
      const baseShare = Math.floor(spentMinor / balances.size)
      const remainder = spentMinor % balances.size
      const net = (balance: typeof from) => balance.paidMinor + balance.paymentsMinor - baseShare - (balance.index < remainder ? 1 : 0)
      if (amount > Math.min(-net(from), net(to))) return 'The payment exceeds the current balance between these members.'
    }
    from.paymentsMinor += amount
    to.paymentsMinor -= amount
  }
  return null
}

function validatePeriodChanges(previous: PayPeriod, next: PayPeriod, actor: FinanceActor | null): string | null {
  if (previous.id !== next.id || previous.label !== next.label || previous.openedById !== next.openedById || previous.openedByName !== next.openedByName) {
    return 'Pay periods cannot be edited or reordered.'
  }
  if (previous.closed) {
    if (!next.closed || previous.closed.byId !== next.closed.byId || previous.closed.byName !== next.closed.byName || previous.closed.carry !== next.closed.carry) {
      return 'A closed pay period cannot be reopened or changed.'
    }
  } else if (next.closed && (actor?.role !== 'admin' || next.closed.byId !== actor.id || next.closed.byName !== actor.name)) {
    return 'An administrator must close the pay period.'
  }

  const rosterProblem = validateRosterChanges(previous, next, actor)
  if (rosterProblem) return rosterProblem

  const expenseProblem = validateRecordHistory(previous.expenses, next.expenses, expenseFields, actor,
    (expense, member) => !previous.closed && (member.role === 'admin' || expense.memberId === member.id), 'Expense')
  if (expenseProblem) return expenseProblem
  const newExpenses = next.expenses.slice(previous.expenses.length)
  if (newExpenses.length && previous.closed) return 'Expenses are frozen when a period closes.'
  if (newExpenses.some((expense) => expense.memberId !== actor?.id)) return 'Members can only record their own expenses.'

  const paymentProblem = validateRecordHistory(previous.payments, next.payments, paymentFields, actor,
    (_, member) => member.role === 'admin', 'Payment')
  if (paymentProblem) return paymentProblem

  const newPayments = next.payments.slice(previous.payments.length)
  if (!newPayments.length) return null
  if (!actor || newPayments.some((payment) => payment.recordedById !== actor.id ||
      payment.recordedByName !== actor.name || (actor.role !== 'admin' && payment.fromId !== actor.id))) {
    return 'Only the paying member or an administrator can record a settlement.'
  }
  return validateSettlementAmounts(previous, next)
}

function validateNewPeriod(period: PayPeriod, prior: PayPeriod | undefined, actor: FinanceActor | null): string | null {
  if (!actor || period.openedById !== actor.id || period.openedByName !== actor.name) return 'A signed-in member must open the pay period.'
  if (!prior) {
    if (period.members.length !== 1 || period.members[0].id !== actor.id || period.members[0].name !== actor.name) {
      return 'The first period starts with the member who opens it.'
    }
  } else {
    if (actor.role !== 'admin' || !prior.closed) return 'An administrator must close the previous period before opening the next one.'
    const eligible = new Map(prior.members.map(({ id, name }) => [id, name]))
    if (period.members.some(({ id, name }) => name !== eligible.get(id) && (id !== actor.id || name !== actor.name))) {
      return 'Select members from the previous period or include the administrator opening this one.'
    }
  }
  return validatePeriodChanges({ ...period, expenses: [], payments: [], closed: undefined }, period, actor)
}

export function validatePayLedgerChanges(before: PayLedger | undefined, after: PayLedger | undefined, actor: FinanceActor | null): string | null {
  const previous = before ?? emptyLedger()
  const result = payLedgerSchema.safeParse(after ?? emptyLedger())
  if (!result.success) return result.error.issues[0].message
  const next = result.data
  if (previous.currency !== next.currency) {
    if (previous.periods.length) return 'Project currency is fixed after the first pay period is opened.'
    if (!actor || (!next.periods.length && actor.role !== 'admin')) return 'An administrator must change the project currency.'
  }
  if (next.periods.length < previous.periods.length) return 'Pay periods cannot be deleted.'

  for (const [index, period] of next.periods.entries()) {
    const old = previous.periods[index]
    const problem = old ? validatePeriodChanges(old, period, actor) : validateNewPeriod(period, next.periods[index - 1], actor)
    if (problem) return problem
  }
  return null
}

export function validatePayWorkspaceChanges(current: Workspace, next: Workspace, actor: FinanceActor | null): string | null {
  const currentProjects = new Map(current.projects.map((project) => [project.id, project]))
  const nextIds = new Set(next.projects.map((project) => project.id))
  for (const project of current.projects) {
    if (project.payPeriods?.periods.length && !nextIds.has(project.id)) return `${project.name} has pay-period history and cannot be deleted.`
  }
  for (const project of next.projects) {
    const problem = validatePayLedgerChanges(currentProjects.get(project.id)?.payPeriods, project.payPeriods, actor)
    if (problem) return `${project.name}. ${problem}`
  }
  return null
}

function stampRecords<Record extends AuditedRecord>(previous: Record[], next: Record[], at: string): Record[] {
  return next.map((record, index) => ({
    ...record,
    createdAt: previous[index]?.createdAt ?? at,
    ...(record.voided && { voided: { ...record.voided, at: previous[index]?.voided?.at ?? at } }),
  }))
}

export function stampPayChanges(current: Workspace, next: Workspace, at: string): Workspace {
  const previousProjects = new Map(current.projects.map(({ id, payPeriods }) => [id, payPeriods]))
  return {
    ...next,
    projects: next.projects.map((project) => {
      if (!project.payPeriods) return project
      const previous = previousProjects.get(project.id)?.periods ?? []
      return {
        ...project,
        payPeriods: {
          ...project.payPeriods,
          periods: project.payPeriods.periods.map((period, index) => ({
            ...period,
            openedAt: previous[index]?.openedAt ?? at,
            expenses: stampRecords(previous[index]?.expenses ?? [], period.expenses, at),
            payments: stampRecords(previous[index]?.payments ?? [], period.payments, at),
            ...(period.closed && { closed: { ...period.closed, at: previous[index]?.closed?.at ?? at } }),
          })),
        },
      }
    }),
  }
}
