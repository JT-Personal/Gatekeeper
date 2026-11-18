import { z } from 'zod'
import type { Workspace } from './domain.ts'

export const financeCurrencies = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'CHF'] as const
export const maxFinanceAmountMinor = 100_000_000_000
const maxLedgerEntries = 25_000 // Keeps aggregate minor-unit amounts within the safe integer range.

export type FinanceActor = { id: string; name: string; role: 'founder' | 'admin' }
export const demoFinanceActor: FinanceActor = { id: 'demo-maya', name: 'Maya Chen', role: 'admin' }

const identity = z.string().min(1).max(200)
const displayName = z.string().trim().min(1).max(200)
const timestamp = z.iso.datetime({ offset: true })
const voidSchema = z.object({
  byId: identity,
  byName: displayName,
  at: timestamp,
  reason: z.string().trim().min(1).max(1000),
})

const entrySchema = z.object({
  id: identity,
  kind: z.enum(['expense', 'contribution', 'reimbursement', 'fund-expense']),
  amountMinor: z.number().int().min(1).max(maxFinanceAmountMinor),
  date: z.iso.date(),
  description: z.string().trim().min(1).max(4000),
  category: z.string().trim().max(120).optional(),
  memberId: identity,
  memberName: displayName,
  recordedById: identity,
  recordedByName: displayName,
  createdAt: timestamp,
  voided: voidSchema.optional(),
})

export type FinanceEntry = z.infer<typeof entrySchema>

type FounderBalance = {
  id: string
  name: string
  contributionsMinor: number
  expenseMinor: number
  reimbursementMinor: number
  owedMinor: number
}

function emptyTotals() {
  return {
    contributionsMinor: 0,
    outOfPocketMinor: 0,
    fundExpenseMinor: 0,
    expenseMinor: 0,
    reimbursementMinor: 0,
    cashMinor: 0,
    owedMinor: 0,
    members: new Map<string, FounderBalance>(),
  }
}

type Totals = ReturnType<typeof emptyTotals>

function applyEntry(totals: Totals, entry: FinanceEntry) {
  if (entry.voided) return
  const amount = entry.amountMinor

  if (entry.kind === 'fund-expense') {
    totals.cashMinor -= amount
    totals.expenseMinor += amount
    totals.fundExpenseMinor += amount
    return
  }

  const member = totals.members.get(entry.memberId) ?? {
    id: entry.memberId, name: entry.memberName, contributionsMinor: 0, expenseMinor: 0, reimbursementMinor: 0, owedMinor: 0,
  }
  member.name = entry.memberName
  totals.members.set(member.id, member)

  switch (entry.kind) {
    case 'contribution':
      totals.contributionsMinor += amount
      totals.cashMinor += amount
      member.contributionsMinor += amount
      break
    case 'expense':
      totals.expenseMinor += amount
      totals.outOfPocketMinor += amount
      totals.owedMinor += amount
      member.expenseMinor += amount
      member.owedMinor += amount
      break
    case 'reimbursement':
      totals.reimbursementMinor += amount
      totals.cashMinor -= amount
      totals.owedMinor -= amount
      member.reimbursementMinor += amount
      member.owedMinor -= amount
      break
  }
}

function balanceProblem(totals: Totals) {
  if (totals.cashMinor < 0) return 'Recorded payments exceed the available project funds.'
  if (Array.from(totals.members.values()).some((member) => member.owedMinor < 0)) {
    return 'A founder’s reimbursements exceed their recorded out-of-pocket expenses.'
  }
  return null
}

function tally(entries: FinanceEntry[]) {
  const totals = emptyTotals()
  entries.forEach((entry) => applyEntry(totals, entry))
  return totals
}

export const financeLedgerSchema = z.object({
  currency: z.enum(financeCurrencies),
  entries: z.array(entrySchema).max(maxLedgerEntries),
}).superRefine(({ entries }, context) => {
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    context.addIssue({ code: 'custom', path: ['entries'], message: 'Ledger entry IDs must be unique.' })
  }
  const problem = balanceProblem(tally(entries))
  if (problem) context.addIssue({ code: 'custom', path: ['entries'], message: problem })
})

export type FinanceLedger = z.infer<typeof financeLedgerSchema>

const emptyLedger = (): FinanceLedger => ({ currency: 'USD', entries: [] })

export function getLedger(project: { finance?: FinanceLedger }): FinanceLedger {
  return project.finance ?? emptyLedger()
}

export function calculateFinance(ledger: FinanceLedger) {
  const { members, ...totals } = tally(ledger.entries)
  return { ...totals, members: [...members.values()] }
}

export function parseFinanceAmount(value: string): number | null {
  const normalized = value.trim()
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(normalized)) return null
  const [units, fraction = ''] = normalized.split('.')
  const amount = Number(units) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount > 0 && amount <= maxFinanceAmountMinor ? amount : null
}

const moneyFormatters = new Map<FinanceLedger['currency'], Intl.NumberFormat>()

export function formatFinanceMoney(amountMinor: number, currency: FinanceLedger['currency']): string {
  let formatter = moneyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    moneyFormatters.set(currency, formatter)
  }
  return formatter.format(amountMinor / 100)
}

const immutableFields = [
  'id', 'kind', 'amountMinor', 'date', 'description', 'category',
  'memberId', 'memberName', 'recordedById', 'recordedByName',
] as const satisfies readonly (keyof FinanceEntry)[]

function authorizeVoid(entry: FinanceEntry, actor: FinanceActor | null) {
  const { voided } = entry
  if (!voided) return null
  if (!actor || voided.byId !== actor.id || voided.byName !== actor.name) {
    return 'The void must be attributed to the signed-in member.'
  }
  if (actor.role !== 'admin' && (entry.memberId !== actor.id || !['expense', 'contribution'].includes(entry.kind))) {
    return 'Founders can void their own expenses and contributions.'
  }
  return null
}

function authorizeNewEntry(entry: FinanceEntry, actor: FinanceActor | null, totals: Totals) {
  if (!actor) return 'Finance changes require a signed-in founder or administrator.'
  if (entry.recordedById !== actor.id || entry.recordedByName !== actor.name) {
    return 'New entries must be attributed to the signed-in member.'
  }

  if (entry.kind === 'reimbursement' || entry.kind === 'fund-expense') {
    if (actor.role !== 'admin') return 'An administrator must record payments from the project fund.'
    if (entry.amountMinor > totals.cashMinor) return 'This payment exceeds the available project funds.'
  }

  if (entry.kind === 'reimbursement') {
    const recipient = totals.members.get(entry.memberId)
    if (!recipient || entry.memberName !== recipient.name) return 'Choose a founder from the current project ledger.'
    if (entry.amountMinor > recipient.owedMinor) return 'This reimbursement exceeds the amount owed to this founder.'
  } else if (entry.memberId !== actor.id || entry.memberName !== actor.name) {
    return 'The expense or contribution must belong to the signed-in member.'
  }

  return authorizeVoid(entry, actor)
}

function beforePendingVoids(entry: FinanceEntry, wasVoided = false): FinanceEntry {
  if (entry.voided && !wasVoided && (entry.kind === 'expense' || entry.kind === 'contribution')) {
    return { ...entry, voided: undefined }
  }
  return entry
}

export function validateFinanceLedgerChanges(
  previousLedger: FinanceLedger | undefined,
  nextLedger: FinanceLedger | undefined,
  actor: FinanceActor | null,
): string | null {
  const previous = previousLedger ?? emptyLedger()
  const result = financeLedgerSchema.safeParse(nextLedger ?? emptyLedger())
  if (!result.success) return result.error.issues[0].message
  const next = result.data

  if (previous.currency !== next.currency) {
    if (previous.entries.length) return 'Project currency is fixed after the first ledger entry.'
    if (actor?.role !== 'admin') return 'An administrator must change the project currency.'
  }
  if (next.entries.length < previous.entries.length) return 'Ledger entries cannot be deleted. Void an incorrect entry instead.'

  for (const [index, entry] of previous.entries.entries()) {
    const updated = next.entries[index]
    // Save requests may carry client timestamps from an optimistic update. Storage preserves its own timestamps.
    if (immutableFields.some((key) => entry[key] !== updated[key])) {
      return 'Ledger entries cannot be edited or reordered. Void an incorrect entry instead.'
    }
    if (entry.voided) {
      if (!updated.voided || entry.voided.byId !== updated.voided.byId ||
          entry.voided.byName !== updated.voided.byName || entry.voided.reason !== updated.voided.reason) {
        return 'A recorded void cannot be edited or reversed.'
      }
    } else {
      const problem = authorizeVoid(updated, actor)
      if (problem) return problem
    }
  }

  // A save can combine a replacement and a void. The final ledger was validated above.
  // Defer removing prior funding or expenses until new entries have been checked in order.
  const totals = tally(previous.entries.map((entry, index) => beforePendingVoids(next.entries[index], Boolean(entry.voided))))

  for (const entry of next.entries.slice(previous.entries.length)) {
    const problem = authorizeNewEntry(entry, actor, totals)
    if (problem) return problem
    applyEntry(totals, beforePendingVoids(entry))
  }
  return null
}

export function validateFinanceChanges(current: Workspace, next: Workspace, actor: FinanceActor | null): string | null {
  const currentProjects = new Map(current.projects.map((project) => [project.id, project]))
  const nextProjectIds = new Set(next.projects.map((project) => project.id))
  for (const project of current.projects) {
    if (project.finance?.entries.length && !nextProjectIds.has(project.id)) {
      return `${project.name} has a financial history and cannot be deleted.`
    }
  }

  for (const project of next.projects) {
    const problem = validateFinanceLedgerChanges(currentProjects.get(project.id)?.finance, project.finance, actor)
    if (problem) return `${project.name}. ${problem}`
  }
  return null
}

export function stampFinanceChanges(current: Workspace, next: Workspace, at: string): Workspace {
  const currentProjects = new Map(current.projects.map((project) => [project.id, project]))
  return {
    ...next,
    projects: next.projects.map((project) => {
      if (!project.finance) return project
      const previous = currentProjects.get(project.id)?.finance?.entries ?? []
      return {
        ...project,
        finance: {
          ...project.finance,
          entries: project.finance.entries.map((entry, index) => ({
            ...entry,
            createdAt: previous[index]?.createdAt ?? at,
            ...(entry.voided && { voided: { ...entry.voided, at: previous[index]?.voided?.at ?? at } }),
          })),
        },
      }
    }),
  }
}
