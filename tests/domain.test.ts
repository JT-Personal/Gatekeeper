import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gateProgress, getRequirementTests, verificationStatus, workspaceSchema } from '../src/domain.ts'
import { createProject, initialWorkspace } from '../src/seed.ts'

function findRecord<T extends { code: string }>(records: T[], code: string): T {
  const record = records.find((item) => item.code === code)
  assert.ok(record, `${code} should be present in the project`)
  return record
}

function newProject() {
  return createProject({ code: ' new-001 ', name: 'New Program', owner: '', description: '' })
}

test('new projects include the standard APQP repository and preserve cross-gate coverage', () => {
  const project = newProject()

  assert.equal(project.code, 'NEW-001')
  assert.deepEqual(project.documents.map(({ code, title, gate, gates }) => [code, title, gate, gates]), [
    ['PM-001', 'Project Charter & Business Case', 1, [1]],
    ['PM-002', 'Program Timeline / APQP Plan', 1, [1]],
    ['SE-001', 'System Requirements Specification', 1, [1]],
    ['SE-002', 'Requirements Traceability Matrix (RTM)', 1, [1]],
    ['EN-004', 'Design Verification Plan & Report (DVP&R)', 1, [1, 2]],
    ['SE-003', 'System Architecture / Interface Control', 2, [2]],
    ['EN-001', 'Concept Selection / Trade Study', 2, [2]],
    ['EN-002', 'Design FMEA (DFMEA)', 2, [2]],
    ['EN-003', 'Design Calculations / Technical Reports', 2, [2]],
    ['EN-005', 'Design Review Record', 2, [1, 2, 3, 4]],
    ['CM-001', 'Engineering Change Request / Order', 2, [2, 3, 4, 5]],
    ['CM-002', 'Released Product Configuration / BOM', 2, [2, 3, 4, 5]],
    ['MF-001', 'Process Flow Diagram', 3, [2, 3]],
    ['MF-002', 'Process FMEA (PFMEA)', 3, [3]],
    ['MF-003', 'Manufacturing Control Plan', 3, [3]],
    ['MF-004', 'Work Instructions / Inspection Plan', 3, [3]],
    ['QA-001', 'MSA / Process Capability Reports', 4, [4]],
    ['QA-002', 'Production Validation / PPAP Package', 4, [4]],
    ['QA-003', 'Nonconformance / 8D Report', 5, [5]],
  ])
  assert.ok(project.documents.every(({ status }) => status === 'Draft'))
  assert.equal(project.requirements.length, 0)
  assert.equal(project.tests.length, 0)
  assert.equal(project.signoffs.length, 0)
})

test('requirement verification follows linked test results, including a failed rerun', () => {
  const [project] = workspaceSchema.parse(initialWorkspace).projects
  const requirement = findRecord(project.requirements, 'REQ-012')
  const vibration = findRecord(project.tests, 'DVP-006')
  const corrosion = findRecord(project.tests, 'DVP-008')

  vibration.status = 'Untested'
  assert.equal(verificationStatus(project, requirement), 'Untested')
  vibration.status = 'In Progress'
  assert.equal(verificationStatus(project, requirement), 'In Progress')
  vibration.status = 'Passed'
  assert.equal(verificationStatus(project, requirement), 'In Progress')
  corrosion.status = 'Passed'
  assert.equal(verificationStatus(project, requirement), 'Passed')
  vibration.status = 'Failed'
  assert.equal(verificationStatus(project, requirement), 'Failed')
  assert.equal(verificationStatus(project, { ...requirement, failureModeIds: [] }), 'Untested')
})

test('a test covering two failure modes appears once for their shared requirement', () => {
  const [project] = workspaceSchema.parse(initialWorkspace).projects
  const requirement = findRecord(project.requirements, 'REQ-012')
  const vibration = findRecord(project.tests, 'DVP-006')
  const corrosion = findRecord(project.tests, 'DVP-008')

  vibration.failureModeIds = [...requirement.failureModeIds]
  assert.deepEqual(getRequirementTests(project, requirement).map(({ id }) => id), [vibration.id, corrosion.id])
})

test('gate readiness counts mandatory documents across gates and accepts approval or release', () => {
  const [project] = workspaceSchema.parse(initialWorkspace).projects
  const gateOne = gateProgress(project, 1)
  assert.equal(gateOne.signedOff, true)
  assert.equal(gateOne.ready, true)

  const gateTwo = gateProgress(project, 2)
  assert.equal(gateTwo.total, 8)
  assert.equal(gateTwo.approved, 4)
  assert.equal(gateTwo.ready, false)
  assert.ok(gateTwo.documents.some(({ code, gate }) => code === 'MF-001' && gate === 3))

  gateTwo.documents.filter(({ mandatory }) => mandatory).forEach((document) => {
    document.status = document.code === 'EN-004' ? 'Released' : 'Approved'
  })
  assert.equal(findRecord(project.documents, 'CM-001').status, 'In Review')
  assert.equal(gateProgress(project, 2).ready, true)
  assert.equal(gateProgress(project, 2).percent, 100)
})

test('a workspace round trip preserves valid links and rejects cross-project links', () => {
  const workspace = workspaceSchema.parse(initialWorkspace)
  const [demo] = workspace.projects
  const project = newProject()
  workspace.projects.push(project)

  assert.deepEqual(workspaceSchema.parse(JSON.parse(JSON.stringify(workspace))), workspace)
  findRecord(project.documents, 'PM-001').links.push(findRecord(demo.documents, 'PM-002').id)
  findRecord(demo.tests, 'DVP-001').failureModeIds.push('missing-failure-mode')

  const result = workspaceSchema.safeParse(workspace)
  assert.equal(result.success, false)
  assert.deepEqual(result.error.issues.map(({ path }) => path), [
    ['projects', 0, 'tests', 0, 'failureModeIds'],
    ['projects', 1, 'documents', 0, 'links'],
  ])
})
