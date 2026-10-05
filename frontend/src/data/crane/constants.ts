import type { Account, Device, InspectionRecord, LegacyRawItem, Org } from './types'

/**
 * 现行版别与限值依据：
 * 《起重机械定期检验规则》TSG Q7015-2016。缺项按此版别推断；
 * 实测值与限值冲突时，统一按实测那一套取值并直接判不合格。
 */
export const CURRENT_BASIS = 'TSG Q7015-2016 起重机械定期检验规则'
export const DEFAULT_CYCLE_MONTHS = 24
export const DEFAULT_LEAD_DAYS = 30

/** 钢丝绳直径磨损率限值 7%（GB/T 5972 报废判据，检验现场实测判定）。 */
export const LIMIT_WIRE_ROPE_WEAR_RATE = 7
/** 开式瓦块制动器实际间隙限值 1.0mm。 */
export const LIMIT_BRAKE_CLEARANCE = 1.0

export const UNITS: Org[] = [
  { id: 'U-DBA', name: '大坝电厂（设备管理部）', kind: '使用单位' },
  { id: 'U-WSB', name: '尾水运维中心', kind: '使用单位' },
]

export const AGENCIES: Org[] = [
  { id: 'A-PSEI', name: '省特种设备检验研究院', kind: '检验机构' },
  { id: 'A-HJJC', name: '华建检测有限公司', kind: '检验机构' },
  { id: 'A-AYZX', name: '安验技术服务中心', kind: '检验机构' },
]

export const ACCOUNTS: Account[] = [
  {
    id: 'C-PSEI-01',
    name: '陈检验（省特检院）',
    role: '检验机构',
    orgId: 'A-PSEI',
    orgName: '省特种设备检验研究院',
    qualified: true,
    scopeUnitIds: ['U-DBA', 'U-WSB'],
  },
  {
    id: 'C-HJJC-01',
    name: '李检测（华建检测）',
    role: '检验机构',
    orgId: 'A-HJJC',
    orgName: '华建检测有限公司',
    qualified: true,
    scopeUnitIds: ['U-WSB'],
  },
  {
    id: 'C-AYZX-01',
    name: '赵工（安验技术）',
    role: '检验机构',
    orgId: 'A-AYZX',
    orgName: '安验技术服务中心',
    qualified: false,
    scopeUnitIds: [],
  },
  {
    id: 'C-DBA-01',
    name: '王工（大坝电厂设备部）',
    role: '使用单位',
    orgId: 'U-DBA',
    orgName: '大坝电厂（设备管理部）',
    qualified: false,
    scopeUnitIds: [],
  },
  {
    id: 'C-WSB-01',
    name: '孙值班（尾水运维中心）',
    role: '使用单位',
    orgId: 'U-WSB',
    orgName: '尾水运维中心',
    qualified: false,
    scopeUnitIds: [],
  },
  {
    id: 'C-AUDIT-01',
    name: '集团审计（外来账号）',
    role: '外部审计',
    orgId: 'EXTERNAL',
    orgName: '集团安全审计组（外来）',
    qualified: false,
    scopeUnitIds: [],
  },
]

/**
 * 在建台账（电子档）。检验日期相对“今天”生成，保证任何时候打开演示都能看到
 * 在用 / 预警 / 超期停用三档状态；每台设备的最近一次合格结论以冻结核验报告在档，
 * 到期日由报告按周期推算，首次载入时再跑一次全量重算对账。
 */
export function seedDevices(today: Date): Device[] {
  const iso = (d: Date): string => d.toISOString().slice(0, 10)
  const shift = (days: number): string => iso(new Date(today.getTime() + days * 86400000))
  return [
    {
      id: 'CR-001',
      name: '坝顶门机1号',
      kind: '坝顶门式启闭机',
      unitId: 'U-DBA',
      unitName: '大坝电厂（设备管理部）',
      agencyId: 'A-PSEI',
      agencyName: '省特种设备检验研究院',
      gateRef: 'GM-DB-01',
      commissionYear: 2015,
      cycleMonths: DEFAULT_CYCLE_MONTHS,
      leadDays: DEFAULT_LEAD_DAYS,
      lastInspectionDate: shift(-300),
      nextDueDate: addMonthsSeed(shift(-300), DEFAULT_CYCLE_MONTHS),
      status: '在用',
      stopTag: false,
      stopReason: '',
      source: '电子建档',
      legacyId: null,
      inferred: false,
      note: '钢丝绳、制动器检验数据齐全',
    },
    {
      id: 'CR-002',
      name: '坝顶门机2号',
      kind: '坝顶门式启闭机',
      unitId: 'U-DBA',
      unitName: '大坝电厂（设备管理部）',
      agencyId: 'A-PSEI',
      agencyName: '省特种设备检验研究院',
      gateRef: 'GM-DB-02',
      commissionYear: 2012,
      cycleMonths: DEFAULT_CYCLE_MONTHS,
      leadDays: DEFAULT_LEAD_DAYS,
      lastInspectionDate: shift(-700),
      nextDueDate: shift(20),
      status: '在用',
      stopTag: false,
      stopReason: '',
      source: '电子建档',
      legacyId: null,
      inferred: false,
      note: '20 天后到期，处于预警提前量内',
    },
    {
      id: 'CR-003',
      name: '尾水门机1号',
      kind: '尾水门式启闭机',
      unitId: 'U-WSB',
      unitName: '尾水运维中心',
      agencyId: 'A-HJJC',
      agencyName: '华建检测有限公司',
      gateRef: 'GM-WS-01',
      commissionYear: 2018,
      cycleMonths: DEFAULT_CYCLE_MONTHS,
      leadDays: DEFAULT_LEAD_DAYS,
      lastInspectionDate: shift(-800),
      nextDueDate: shift(-70),
      status: '在用',
      stopTag: false,
      stopReason: '',
      source: '电子建档',
      legacyId: null,
      inferred: false,
      note: '已超期 70 天，载入即挂停用牌',
    },
    {
      id: 'CR-004',
      name: '尾水门机2号',
      kind: '尾水门式启闭机',
      unitId: 'U-WSB',
      unitName: '尾水运维中心',
      agencyId: 'A-HJJC',
      agencyName: '华建检测有限公司',
      gateRef: 'GM-WS-02',
      commissionYear: 2019,
      cycleMonths: DEFAULT_CYCLE_MONTHS,
      leadDays: DEFAULT_LEAD_DAYS,
      lastInspectionDate: shift(-680),
      nextDueDate: shift(40),
      status: '在用',
      stopTag: false,
      stopReason: '',
      source: '电子建档',
      legacyId: null,
      inferred: false,
      note: '检验结论为不合格后应停用（页面录入演示）',
    },
    {
      id: 'CR-005',
      name: '坝顶尾水协同门机',
      kind: '坝顶门式启闭机',
      // 归属使用单位是大坝电厂，但登记的检验机构是华建（华建只获尾水授权）：
      // 专用于演示“跨单位替别人录检验结果”被授权范围挡回。
      unitId: 'U-DBA',
      unitName: '大坝电厂（设备管理部）',
      agencyId: 'A-HJJC',
      agencyName: '华建检测有限公司',
      gateRef: 'GM-DB-05',
      commissionYear: 2021,
      cycleMonths: DEFAULT_CYCLE_MONTHS,
      leadDays: DEFAULT_LEAD_DAYS,
      lastInspectionDate: shift(-200),
      nextDueDate: addMonthsSeed(shift(-200), DEFAULT_CYCLE_MONTHS),
      status: '在用',
      stopTag: false,
      stopReason: '',
      source: '电子建档',
      legacyId: null,
      inferred: false,
      note: '机构归属与授权范围不一致，录入应被挡（历史由省院检验，归属登记待整改）',
    },
  ]
}

function addMonthsSeed(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()))
  return target.toISOString().slice(0, 10)
}

/**
 * 电子台账的在档冻结合格报告：每台设备最近一次定检的检验结论，
 * 由归属检验机构、按实测值合格出具。记录只追加、后续复检不覆盖这些历史结论。
 */
export function seedRecords(today: Date): InspectionRecord[] {
  const iso = (d: Date): string => d.toISOString().slice(0, 10)
  const shift = (days: number): string => iso(new Date(today.getTime() + days * 86400000))
  const devices = seedDevices(today)
  const base = (d: (typeof devices)[number], idx: number, measured: { w: number; b: number }): InspectionRecord => ({
    id: `IR-SEED-${d.id}`,
    reportNo: `BG-${d.id}-${shift(0).slice(0, 4)}BASE`,
    deviceId: d.id,
    deviceName: d.name,
    inspectedAt: d.lastInspectionDate,
    nextDue: d.nextDueDate,
    agencyId: d.agencyId,
    agencyName: d.agencyName,
    inspectorAccountId: d.agencyId === 'A-PSEI' ? 'C-PSEI-01' : 'C-HJJC-01',
    inspectorName: d.agencyId === 'A-PSEI' ? '陈检验（省特检院）' : '李检测（华建检测）',
    conclusion: '合格',
    measured: { wireRopeWearRate: measured.w, brakeClearance: measured.b },
    basis: CURRENT_BASIS,
    hasMeasured: true,
    inferred: false,
    paperArchive: false,
    remark: '电子台账最近一次定期检验合格报告',
    createdAt: d.lastInspectionDate,
    immutable: true,
  })
  void 0
  const byId = (id: string) => devices.find((d) => d.id === id)!
  return [
    base(byId('CR-001'), 0, { w: 3.2, b: 0.6 }),
    base(byId('CR-002'), 1, { w: 4.1, b: 0.7 }),
    base(byId('CR-003'), 2, { w: 3.8, b: 0.8 }),
    base(byId('CR-004'), 3, { w: 2.9, b: 0.5 }),
    base(byId('CR-005'), 4, { w: 2.4, b: 0.5 }),
  ]
}

/**
 * 存量原始清单：按投运年份升序回填。早年只有纸质报告的，磨损实测取数可能中断
 * （fetched=false）——迁移必须在该条停住，等取数补齐后从断条续走。
 */
export const LEGACY_RAW: LegacyRawItem[] = [
  {
    id: 'L1',
    deviceName: '老坝顶门机（存量）',
    kind: '坝顶门式启闭机',
    unitId: 'U-DBA',
    agencyId: 'A-PSEI',
    gateRef: 'GM-DB-OLD',
    commissionYear: 2003,
    paperReportNo: 'P-2023-0117',
    paperInspectedAt: '2023-06-18',
    measured: null,
    fetched: true,
  },
  {
    id: 'L2',
    deviceName: '老尾水门机（存量）',
    kind: '尾水门式启闭机',
    unitId: 'U-WSB',
    agencyId: 'A-HJJC',
    gateRef: 'GM-WS-OLD',
    commissionYear: 2006,
    paperReportNo: 'P-2014-0032',
    paperInspectedAt: '2014-09-02',
    measured: null,
    fetched: true,
  },
  {
    id: 'L3',
    deviceName: '取数中断门机（存量）',
    kind: '坝顶门式启闭机',
    unitId: 'U-DBA',
    agencyId: 'A-PSEI',
    gateRef: 'GM-DB-MID',
    commissionYear: 2008,
    paperReportNo: 'P-2024-0205',
    paperInspectedAt: '2024-11-20',
    measured: null,
    // 外委单位随手写的磨损记录没交齐：取数在这一条断掉。
    fetched: false,
  },
  {
    id: 'L4',
    deviceName: '无报告门机（存量）',
    kind: '尾水门式启闭机',
    unitId: 'U-WSB',
    agencyId: 'A-HJJC',
    gateRef: 'GM-WS-NOREC',
    commissionYear: 2010,
    paperReportNo: null,
    paperInspectedAt: null,
    measured: null,
    fetched: true,
  },
  {
    id: 'L5',
    deviceName: '磨损超标门机（存量）',
    kind: '坝顶门式启闭机',
    unitId: 'U-DBA',
    agencyId: 'A-PSEI',
    gateRef: 'GM-DB-WORN',
    commissionYear: 2011,
    paperReportNo: 'P-2025-0066',
    paperInspectedAt: '2025-03-12',
    // 外委单位只交了钢丝绳一项实测；制动器缺项按现行版别推断为合格取值。
    measured: { wireRopeWearRate: 9.2, brakeClearance: 0.7 },
    fetched: true,
  },
  {
    id: 'L6',
    deviceName: '重复报告门机（存量）',
    kind: '尾水门式启闭机',
    unitId: 'U-WSB',
    agencyId: 'A-HJJC',
    gateRef: 'GM-WS-DUP',
    commissionYear: 2013,
    // 同一报告被档案柜与外委单位各交了一次；只有先发生的一条进档。
    paperReportNo: 'P-2025-0066',
    paperInspectedAt: '2025-05-08',
    measured: { wireRopeWearRate: 3.1, brakeClearance: 0.6 },
    fetched: true,
  },
]
