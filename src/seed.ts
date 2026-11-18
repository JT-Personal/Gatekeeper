import { newId, type DocumentRecord, type DocumentStatus, type FailureMode, type GateId, type Project, type Requirement, type VerificationTest, type Workspace } from './domain.ts'
import { demoFinanceActor, type FinanceEntry } from './finance.ts'

type DocumentDefinition = {
  code: string
  title: string
  gate: GateId
  gates?: GateId[]
  mandatory?: boolean
  description: string
  links?: string[]
}

const standardDocuments: DocumentDefinition[] = [
  { code: 'PM-001', title: 'Project Charter & Business Case', gate: 1, description: 'State the program objectives, scope, business rationale, stakeholders, and decision authority.' },
  { code: 'PM-002', title: 'Program Timeline / APQP Plan', gate: 1, description: 'Track APQP milestones, gate reviews, and deliverable dates.', links: ['PM-001'] },
  { code: 'SE-001', title: 'System Requirements Specification', gate: 1, description: 'Record measurable system requirements, their owners, and applicable development gates.', links: ['EN-002'] },
  { code: 'SE-002', title: 'Requirements Traceability Matrix (RTM)', gate: 1, description: 'Trace system requirements through DFMEA failure modes to DVP&R results.', links: ['SE-001', 'EN-002', 'EN-004'] },
  { code: 'EN-004', title: 'Design Verification Plan & Report (DVP&R)', gate: 1, gates: [1, 2], description: 'Plan verification methods, sample sizes, and acceptance criteria. Record results and evidence references.' },
  { code: 'SE-003', title: 'System Architecture / Interface Control', gate: 2, description: 'Describe the system structure, interfaces, and configuration boundaries.', links: ['SE-001'] },
  { code: 'EN-001', title: 'Concept Selection / Trade Study', gate: 2, description: 'Compare candidate designs against program requirements and record the selection rationale.', links: ['SE-001', 'SE-003'] },
  { code: 'EN-002', title: 'Design FMEA (DFMEA)', gate: 2, description: 'Document design failure modes, their effects, and planned verification coverage.', links: ['EN-004'] },
  { code: 'EN-003', title: 'Design Calculations / Technical Reports', gate: 2, description: 'Keep the calculations, simulation results, and engineering analyses that support the design.', links: ['SE-003', 'EN-001'] },
  { code: 'EN-005', title: 'Design Review Record', gate: 2, gates: [1, 2, 3, 4], description: 'Record review decisions, actions, owners, and approvals across the program gates.', links: ['SE-003', 'EN-002', 'EN-004'] },
  { code: 'CM-001', title: 'Engineering Change Request / Order', gate: 2, gates: [2, 3, 4, 5], mandatory: false, description: 'Capture proposed engineering changes, impact assessments, disposition, and implementation approval.', links: ['CM-002'] },
  { code: 'CM-002', title: 'Released Product Configuration / BOM', gate: 2, gates: [2, 3, 4, 5], description: 'Maintain the released configuration baseline, bills of material, and applicable drawings.', links: ['SE-003'] },
  { code: 'MF-001', title: 'Process Flow Diagram', gate: 3, gates: [2, 3], description: 'Map manufacturing and inspection operations from incoming material through shipment.', links: ['CM-002'] },
  { code: 'MF-002', title: 'Process FMEA (PFMEA)', gate: 3, description: 'Assess process failure modes and define prevention and detection controls.', links: ['MF-001', 'EN-002'] },
  { code: 'MF-003', title: 'Manufacturing Control Plan', gate: 3, description: 'Document production controls, measurement methods, sampling, and reaction plans.', links: ['MF-001', 'MF-002'] },
  { code: 'MF-004', title: 'Work Instructions / Inspection Plan', gate: 3, description: 'Describe work sequences, inspection checks, and operator responsibilities.', links: ['MF-003'] },
  { code: 'QA-001', title: 'MSA / Process Capability Reports', gate: 4, description: 'Capture measurement system studies and process capability evidence.', links: ['MF-003', 'MF-004'] },
  { code: 'QA-002', title: 'Production Validation / PPAP Package', gate: 4, description: 'Compile production validation evidence and PPAP submission records.', links: ['EN-004', 'MF-003', 'QA-001'] },
  { code: 'QA-003', title: 'Nonconformance / 8D Report', gate: 5, description: 'Record production nonconformances, containment, root cause, and corrective action verification.', links: ['MF-003', 'QA-002'] },
]

type ProjectDetails = Pick<Project, 'name' | 'code' | 'owner' | 'description'>

function buildProject(details: ProjectDetails, id: string, createdAt: string): Project {
  const documentId = (code: string) => `${id}:${code.toLowerCase()}`
  const documents: DocumentRecord[] = standardDocuments.map((definition) => ({
    id: documentId(definition.code),
    code: definition.code,
    title: definition.title,
    owner: '',
    version: '0.1',
    gate: definition.gate,
    gates: [...(definition.gates ?? [definition.gate])],
    status: 'Draft',
    mandatory: definition.mandatory ?? true,
    description: definition.description,
    links: (definition.links ?? []).map(documentId),
    attachments: [],
    revisions: [{ id: `${documentId(definition.code)}:0.1`, version: '0.1', at: createdAt, note: 'Created from the standard APQP template.' }],
    updatedAt: createdAt,
  }))

  return { ...details, id, createdAt, documents, requirements: [], failureModes: [], tests: [], signoffs: [] }
}

export function createProject(details: ProjectDetails): Project {
  return buildProject({
    name: details.name.trim(),
    code: details.code.trim().toUpperCase(),
    owner: details.owner.trim(),
    description: details.description.trim(),
  }, newId(), new Date().toISOString())
}

const demo = buildProject({
  code: 'PRG-024',
  name: 'Orion Drive Assembly',
  owner: 'Maya Chen',
  description: 'APQP and design verification for the Orion electromechanical drive assembly.',
}, 'orion-drive', '2026-08-24T14:00:00Z')

const documentUpdates: Partial<Record<string, [DocumentStatus, string, string, string, string]>> = {
  'PM-001': ['Released', 'Maya Chen', '1.0', '2026-09-03', 'Released the program baseline and scope.'],
  'PM-002': ['Approved', 'Maya Chen', '1.1', '2026-11-17', 'Approved the updated gate review schedule.'],
  'SE-001': ['Approved', 'Daniel Park', '1.2', '2026-11-15', 'Approved the system requirement baseline.'],
  'SE-002': ['Approved', 'Daniel Park', '1.0', '2026-10-07', 'Approved the traceability matrix for design verification.'],
  'EN-004': ['Approved', 'Sofia Patel', '1.3', '2026-11-18', 'Updated test outcomes and the verification schedule.'],
  'SE-003': ['Approved', 'Daniel Park', '1.0', '2026-10-27', 'Approved the interface control baseline.'],
  'EN-001': ['Released', 'Alex Morgan', '1.0', '2026-10-30', 'Released the concept selection record.'],
  'EN-002': ['In Review', 'Alex Morgan', '0.9', '2026-11-17', 'Submitted the updated DFMEA for review.'],
  'EN-003': ['In Review', 'Alex Morgan', '0.6', '2026-11-12', 'Added housing load and thermal analyses.'],
  'EN-005': ['Approved', 'Maya Chen', '1.0', '2026-10-08', 'Approved the gate review record.'],
  'CM-001': ['In Review', 'Alex Morgan', '0.3', '2026-11-16', 'Submitted the shaft finish change for review.'],
  'CM-002': ['Draft', 'Daniel Park', '0.4', '2026-11-13', 'Updated the preliminary assembly BOM.'],
  'MF-001': ['Draft', 'Jordan Lee', '0.3', '2026-11-10', 'Added EOL torque and seal inspection steps.'],
}

demo.documents = demo.documents.map((document) => {
  const update = documentUpdates[document.code]
  if (!update) return document
  const [status, owner, version, date, note] = update
  const updatedAt = `${date}T15:00:00Z`
  return {
    ...document,
    status,
    owner,
    version,
    updatedAt,
    revisions: [{ id: `${document.id}:${version}`, version, at: updatedAt, note }, ...document.revisions],
  }
})

const modes: [string, string, string, number][] = [
  ['FM-001', 'Output shaft misalignment', 'Assembly tolerance stack increases shaft runout and bearing loads.', 8],
  ['FM-002', 'Insufficient output torque', 'The drive cannot hold commanded torque at rated load.', 9],
  ['FM-003', 'Thermal derating at rated load', 'Motor or enclosure temperature exceeds allowable limits.', 8],
  ['FM-004', 'Electrical protection failure', 'Insulation breakdown or loss of overcurrent protection damages the unit.', 9],
  ['FM-005', 'Housing seal leakage', 'Water or dust passes the housing or cable feedthrough seal.', 7],
  ['FM-006', 'Fastener loosening under vibration', 'Random vibration reduces clamp load or damages mount features.', 8],
  ['FM-007', 'Gear wear at duty cycle', 'Prolonged cycling increases backlash and reduces efficiency.', 8],
  ['FM-008', 'External corrosion', 'Surface degradation affects fit or impedes service access.', 6],
]

demo.failureModes = modes.map(([code, title, description, severity]): FailureMode => ({
  id: code.toLowerCase(), code, title, description, severity,
}))

const requirements: [string, string, string, GateId, string[]][] = [
  ['REQ-001', 'Output shaft runout', 'Shaft radial runout shall remain at or below 0.08 mm at the bearing seat.', 1, ['fm-001']],
  ['REQ-002', 'Mounting interface alignment', 'Output shaft position shall be within 0.15 mm of the mounting datum axis.', 1, ['fm-001']],
  ['REQ-003', 'Rated output torque', 'Deliver at least 32 N·m continuously at nominal supply and 1,500 rpm.', 1, ['fm-002']],
  ['REQ-004', 'Peak output torque', 'Deliver 60 N·m for at least 10 seconds without shutdown.', 2, ['fm-002']],
  ['REQ-005', 'Operating temperature range', 'Operate at rated load from −20 °C to 65 °C ambient.', 1, ['fm-003']],
  ['REQ-006', 'Enclosure touch temperature', 'Keep accessible enclosure surfaces below 70 °C at rated load and 25 °C ambient.', 2, ['fm-003']],
  ['REQ-007', 'Electrical isolation', 'Withstand 500 VDC between power circuits and the enclosure for 60 seconds.', 2, ['fm-004']],
  ['REQ-008', 'Ingress protection', 'Maintain an IP67 enclosure rating after preconditioning.', 1, ['fm-005']],
  ['REQ-009', 'Vibration durability', 'Maintain mount integrity and full function after 8 hours of random vibration per axis.', 2, ['fm-006']],
  ['REQ-010', 'Drivetrain service life', 'Complete 250,000 duty cycles with backlash below 0.35°.', 2, ['fm-007']],
  ['REQ-011', 'Corrosion resistance', 'External parts shall show no red rust after 240 hours of salt fog exposure.', 2, ['fm-008']],
  ['REQ-012', 'Mounting hardware serviceability', 'Mount fasteners shall retain at least 90% clamp torque and be removable after environmental exposure.', 2, ['fm-006', 'fm-008']],
]

demo.requirements = requirements.map(([code, title, description, gate, failureModeIds]): Requirement => ({
  id: code.toLowerCase(), code, title, description, gate, failureModeIds,
  owner: gate === 1 ? 'Daniel Park' : 'Alex Morgan',
}))

const tests: Omit<VerificationTest, 'id'>[] = [
  { code: 'DVP-001', title: 'Shaft Runout & Alignment', method: 'CMM and dial indicator inspection', conditions: 'Assembled drive at 23 ± 2 °C.', acceptance: 'Runout ≤ 0.08 mm and datum offset ≤ 0.15 mm.', sampleSize: 5, dueDate: '2026-10-24', testHouse: 'Orion Metrology', status: 'Passed', result: 'Maximum runout 0.06 mm and datum offset 0.11 mm.', failureModeIds: ['fm-001'] },
  { code: 'DVP-002', title: 'Output Torque Characterization', method: 'Dynamometer load sweep', conditions: 'Nominal input voltage and 1,500 rpm.', acceptance: 'Continuous ≥ 32 N·m and peak ≥ 60 N·m for 10 seconds.', sampleSize: 4, dueDate: '2026-10-29', testHouse: 'Vector Test Labs', status: 'Passed', result: 'Minimum continuous torque 34.2 N·m. All units sustained peak load.', failureModeIds: ['fm-002'] },
  { code: 'DVP-003', title: 'Thermal Performance', method: 'Environmental chamber and thermocouple logging', conditions: 'Rated load at −20 °C, 25 °C, and 65 °C ambient.', acceptance: 'No unintended derating. Accessible surface temperature < 70 °C at 25 °C ambient.', sampleSize: 3, dueDate: '2026-11-04', testHouse: 'Orion Reliability Lab', status: 'Passed', result: 'All units reached rated output. Highest touch temperature 62 °C.', failureModeIds: ['fm-003'] },
  { code: 'DVP-004', title: 'Electrical Isolation', method: 'DC dielectric withstand test', conditions: 'Apply 500 VDC for 60 seconds against enclosure ground.', acceptance: 'No dielectric breakdown. Leakage current ≤ 1 mA.', sampleSize: 5, dueDate: '2026-11-07', testHouse: 'Orion Reliability Lab', status: 'Passed', result: 'No breakdown. Peak leakage 0.21 mA.', failureModeIds: ['fm-004'] },
  { code: 'DVP-005', title: 'Ingress Protection', method: 'IEC 60529 IP67 verification', conditions: 'Dust and water immersion exposure after thermal preconditioning.', acceptance: 'No harmful ingress. Unit passes post-test functional checks.', sampleSize: 3, dueDate: '2026-11-12', testHouse: 'Vector Test Labs', status: 'Passed', result: 'No ingress observed. Functional checks passed on all units.', failureModeIds: ['fm-005'] },
  { code: 'DVP-006', title: 'Random Vibration', method: 'Electrodynamic shaker with post-test inspection', conditions: 'Program vibration profile for 8 hours per axis.', acceptance: 'No fracture or functional loss. Retain ≥ 90% fastener torque.', sampleSize: 4, dueDate: '2026-11-23', testHouse: 'Vector Test Labs', status: 'In Progress', result: 'X and Y axes complete. Z-axis testing is underway.', failureModeIds: ['fm-006'] },
  { code: 'DVP-007', title: 'Drivetrain Endurance', method: 'Automated duty-cycle endurance stand', conditions: '250,000 cycles at rated load using the program duty cycle.', acceptance: 'Final backlash < 0.35° across all samples.', sampleSize: 4, dueDate: '2026-11-16', testHouse: 'Orion Reliability Lab', status: 'Failed', result: 'One sample measured 0.42° backlash. Failure analysis is open.', failureModeIds: ['fm-007'] },
  { code: 'DVP-008', title: 'Salt Fog Exposure', method: 'ASTM B117 chamber exposure', conditions: '240 hours in neutral salt fog with production-intent hardware.', acceptance: 'No red rust. Mounting fasteners remain removable.', sampleSize: 3, dueDate: '2026-11-30', testHouse: 'Midwest Environmental Lab', status: 'Untested', result: '', failureModeIds: ['fm-008'] },
]

demo.tests = tests.map((test) => ({ ...test, id: test.code.toLowerCase() }))
demo.signoffs = [{ gate: 1, by: 'Maya Chen', at: '2026-10-09T14:30:00Z', note: 'Approved for design and development.' }]

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

demo.finance = {
  currency: 'USD',
  entries: financeRecords.map(([kind, amountMinor, date, description, category, member], index) => {
    const recorder = kind === 'reimbursement' ? demoFinanceActor : member
    return {
      id: `${demo.id}:finance-${index + 1}`, kind, amountMinor, date, description, category,
      memberId: member.id, memberName: member.name, recordedById: recorder.id, recordedByName: recorder.name,
      createdAt: `${date}T15:00:00Z`,
    }
  }),
}

export const initialWorkspace: Workspace = { schemaVersion: 1, projects: [demo] }
