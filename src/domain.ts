import { z } from 'zod'
import { financeLedgerSchema } from './finance.ts'
import { payLedgerSchema } from './payPeriods.ts'

export type GateId = 1 | 2 | 3 | 4 | 5

export const gates: ReadonlyArray<{ id: GateId; name: string; description: string }> = [
  { id: 1, name: 'Initiation & Planning', description: 'Define scope, establish requirements, and plan verification.' },
  { id: 2, name: 'Design & Development', description: 'Develop the product design and assess failure risks.' },
  { id: 3, name: 'Process Development', description: 'Design manufacturing and inspection processes.' },
  { id: 4, name: 'Validation & PPAP', description: 'Validate production capability and prepare the PPAP submission.' },
  { id: 5, name: 'Production & Continuous Improvement', description: 'Monitor production and close corrective actions.' },
]

export const documentStatuses = ['Draft', 'In Review', 'Approved', 'Released'] as const
export const testStatuses = ['Untested', 'In Progress', 'Passed', 'Failed'] as const

const gateIdSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
const id = z.string().min(1).max(128)
const code = z.string().trim().min(1).max(40)
const title = z.string().trim().min(1).max(200)
const shortText = z.string().max(500)
const longText = z.string().max(30_000)
const timestamp = z.string().datetime({ offset: true })
const dateOnly = z.string().refine((value) => {
  if (value === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}, 'Enter a date in YYYY-MM-DD format.')

const attachmentSchema = z.object({ name: z.string().min(1).max(255), size: z.number().int().nonnegative() })
const revisionSchema = z.object({ id, version: code, at: timestamp, note: longText })
const documentSchema = z.object({
  id,
  code,
  title,
  owner: shortText,
  version: code,
  gate: gateIdSchema,
  gates: z.array(gateIdSchema).min(1).max(5),
  status: z.enum(documentStatuses),
  mandatory: z.boolean(),
  description: longText,
  attachments: z.array(attachmentSchema),
  links: z.array(id),
  revisions: z.array(revisionSchema),
  updatedAt: timestamp,
})

const requirementSchema = z.object({
  id,
  code,
  title,
  description: longText,
  owner: shortText,
  gate: gateIdSchema,
  failureModeIds: z.array(id),
})

const failureModeSchema = z.object({
  id,
  code,
  title,
  description: longText,
  severity: z.number().int().min(1).max(10),
})

const verificationTestSchema = z.object({
  id,
  code,
  title,
  method: longText,
  conditions: longText,
  acceptance: longText,
  sampleSize: z.number().int().min(1),
  dueDate: dateOnly,
  testHouse: shortText,
  status: z.enum(testStatuses),
  result: longText,
  failureModeIds: z.array(id),
})

const signoffSchema = z.object({ gate: gateIdSchema, by: title, at: timestamp, note: longText })
const projectSchema = z.object({
  id,
  code,
  name: title,
  description: longText,
  owner: shortText,
  createdAt: timestamp,
  documents: z.array(documentSchema),
  requirements: z.array(requirementSchema),
  failureModes: z.array(failureModeSchema),
  tests: z.array(verificationTestSchema),
  signoffs: z.array(signoffSchema),
  finance: financeLedgerSchema.optional(),
  payPeriods: payLedgerSchema.optional(),
})

export const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(projectSchema),
}).superRefine((workspace, context) => {
  const issue = (path: (string | number)[], message: string) => {
    context.addIssue({ code: 'custom', path, message })
  }

  const unique = (values: (string | number)[], path: (string | number)[], message: string) => {
    if (new Set(values).size !== values.length) issue(path, message)
  }

  const uniqueRecords = (records: { id: string; code: string }[], path: (string | number)[]) => {
    unique(records.map((record) => record.id), path, 'Record IDs must be unique.')
    unique(records.map((record) => record.code.toUpperCase()), path, 'Record codes must be unique.')
  }

  uniqueRecords(workspace.projects, ['projects'])
  unique(workspace.projects.flatMap((project) => project.finance?.entries.map((entry) => entry.id) ?? []), ['projects'], 'Ledger entry IDs must be unique across projects.')
  workspace.projects.forEach((project, projectIndex) => {
    const path = ['projects', projectIndex]
    uniqueRecords(project.documents, [...path, 'documents'])
    uniqueRecords(project.requirements, [...path, 'requirements'])
    uniqueRecords(project.failureModes, [...path, 'failureModes'])
    uniqueRecords(project.tests, [...path, 'tests'])
    unique(project.signoffs.map((signoff) => signoff.gate), [...path, 'signoffs'], 'Each gate can have one active sign-off.')

    const documentIds = new Set(project.documents.map((document) => document.id))
    const failureModeIds = new Set(project.failureModes.map((mode) => mode.id))

    project.documents.forEach((document, index) => {
      const documentPath = [...path, 'documents', index]
      unique(document.gates, [...documentPath, 'gates'], 'Applicable gates must be unique.')
      unique(document.links, [...documentPath, 'links'], 'Linked documents must be unique.')
      unique(document.revisions.map((revision) => revision.id), [...documentPath, 'revisions'], 'Revision IDs must be unique.')
      if (!document.gates.includes(document.gate)) {
        issue([...documentPath, 'gates'], 'Applicable gates must include the primary gate.')
      }
      if (document.links.some((link) => link === document.id || !documentIds.has(link))) {
        issue([...documentPath, 'links'], 'Documents must link to other documents in the same project.')
      }
    })

    for (const collection of ['requirements', 'tests'] as const) {
      project[collection].forEach((item, index) => {
        const linkPath = [...path, collection, index, 'failureModeIds']
        unique(item.failureModeIds, linkPath, 'Linked failure modes must be unique.')
        if (item.failureModeIds.some((link) => !failureModeIds.has(link))) {
          issue(linkPath, 'Failure modes must belong to the same project.')
        }
      })
    }
  })
})

export type DocumentStatus = typeof documentStatuses[number]
export type TestStatus = typeof testStatuses[number]
export type Attachment = z.infer<typeof attachmentSchema>
export type Revision = z.infer<typeof revisionSchema>
export type DocumentRecord = z.infer<typeof documentSchema>
export type Requirement = z.infer<typeof requirementSchema>
export type FailureMode = z.infer<typeof failureModeSchema>
export type VerificationTest = z.infer<typeof verificationTestSchema>
export type Signoff = z.infer<typeof signoffSchema>
export type Project = z.infer<typeof projectSchema>
export type Workspace = z.infer<typeof workspaceSchema>

export function newId(): string {
  const crypto = globalThis.crypto
  // randomUUID requires a secure context, while LAN deployments may use HTTP.
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('')
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})

export function formatDate(date: string): string {
  if (!date) return '—'
  const parsedDate = new Date(date)
  return Number.isNaN(parsedDate.valueOf()) ? '—' : dateFormatter.format(parsedDate)
}

export function getRequirementTests(project: Project, requirement: Requirement): VerificationTest[] {
  const linkedModes = new Set(requirement.failureModeIds)
  return project.tests.filter((test) => test.failureModeIds.some((id) => linkedModes.has(id)))
}

export function verificationStatus(project: Project, requirement: Requirement): TestStatus {
  const tests = getRequirementTests(project, requirement)
  if (tests.some((test) => test.status === 'Failed')) return 'Failed'
  if (tests.length === 0 || tests.every((test) => test.status === 'Untested')) return 'Untested'

  // Every planned test needs to pass, so one result cannot mask an open test.
  return tests.every((test) => test.status === 'Passed') ? 'Passed' : 'In Progress'
}

export function isDocumentApproved(document: DocumentRecord): boolean {
  return document.status === 'Approved' || document.status === 'Released'
}

export function gateProgress(project: Project, gateId: GateId) {
  const documents = project.documents.filter((document) => document.gates.includes(gateId))
  const required = documents.filter((document) => document.mandatory)
  const total = required.length
  const approved = required.filter(isDocumentApproved).length

  return {
    approved,
    total,
    percent: total > 0 ? Math.round(approved / total * 100) : 0,
    ready: total > 0 && approved === total,
    signedOff: project.signoffs.some((signoff) => signoff.gate === gateId),
    documents,
  }
}
