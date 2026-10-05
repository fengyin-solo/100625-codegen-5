/** 起重设备（坝顶门机、尾水门机等）定期检验台账的领域类型。 */

export type Role = '使用单位' | '检验机构' | '外部审计'

export interface Org {
  id: string
  name: string
  kind: '使用单位' | '检验机构'
}

export interface Account {
  id: string
  name: string
  role: Role
  orgId: string
  orgName: string
  /** 是否持有有效的起重机械定期检验资质（外部账号、使用单位恒为 false）。 */
  qualified: boolean
  /** 该机构账号被授权出具结论的使用单位 id 清单；缺省表示一个单位都没授权。 */
  scopeUnitIds: string[]
}

export type DeviceStatus = '在用' | '预警' | '停用'

export interface Device {
  id: string
  name: string
  kind: string
  /** 使用单位（归属）。 */
  unitId: string
  unitName: string
  /** 登记的检验机构（归属）。 */
  agencyId: string
  agencyName: string
  /** 关联的闸门启闭对象编号，操作工从闸门入口据此认出是哪台门机。 */
  gateRef: string
  commissionYear: number
  /** 定检周期（月），缺省按现行版别取 24 个月。 */
  cycleMonths: number
  /** 到期预警提前量（天）。 */
  leadDays: number
  /** 最近一次「合格」检验日期。 */
  lastInspectionDate: string
  /** 由最近一次合格报告推算的下次检验日期。 */
  nextDueDate: string
  status: DeviceStatus
  stopTag: boolean
  stopReason: string
  source: '电子建档' | '存量回填'
  /** 回填来源（存量原始清单条目 id），电子建档为 null。 */
  legacyId: string | null
  /** 缺项按现行版别推断的存量记录，打推断标记。 */
  inferred: boolean
  note: string
}

export type Conclusion = '合格' | '不合格'

export interface Measurement {
  /** 钢丝绳直径磨损率（%，实测）。 */
  wireRopeWearRate: number
  /** 制动器瓦块开口间隙（mm，实测）。 */
  brakeClearance: number
}

export interface InspectionRecord {
  id: string
  reportNo: string
  deviceId: string
  deviceName: string
  inspectedAt: string
  nextDue: string
  agencyId: string
  agencyName: string
  inspectorAccountId: string
  inspectorName: string
  conclusion: Conclusion
  /** 实测值；纸质报告无数测值时为 null。 */
  measured: Measurement | null
  /** 检验依据版别。 */
  basis: string
  /** 是否带实测值（与 measured !== null 同义，导出/列表直接用）。 */
  hasMeasured: boolean
  /** 缺项是否按现行版别推断。 */
  inferred: boolean
  /** 是否纸质报告补录。 */
  paperArchive: boolean
  remark: string
  createdAt: string
  /** 结论一经录入即冻结，任何账号不得改动。 */
  immutable: true
}

export type WarningState = '预警中' | '已收回' | '已转停用'

export interface Warning {
  id: string
  deviceId: string
  deviceName: string
  dueDate: string
  state: WarningState
  issuedAt: string
  recalledAt?: string
  recallReason?: string
  /** 收回预警的那份合格报告编号。 */
  recordId?: string
  reportNo?: string
}

export type TodoTarget = 'gate' | 'hydrology'
export type TodoKind = '预警提醒' | '停用指令'
export type TodoState = '待办' | '已解除'

export interface LinkedTodo {
  id: string
  /** 推送到哪个入口：闸门启闭 / 水情调度。 */
  target: TodoTarget
  kind: TodoKind
  deviceId: string
  deviceName: string
  gateRef: string
  title: string
  reason: string
  state: TodoState
  sourceWarningId?: string
  createdAt: string
  resolvedAt?: string
}

export interface AccessLog {
  id: string
  at: string
  accountId: string
  accountName: string
  action: string
  target: string
  ok: boolean
  reason: string
}

export interface LegacyRawItem {
  id: string
  deviceName: string
  kind: string
  unitId: string
  agencyId: string
  gateRef: string
  commissionYear: number
  /** 纸质报告编号；早年报告遗失的为 null。 */
  paperReportNo: string | null
  paperInspectedAt: string | null
  /** 外委单位随手写的磨损记录，取数可能中断；中断时为 null 且 fetched=false。 */
  measured: Measurement | null
  /** 取数是否已完成；false 表示迁移在这一条断住，须续取，不许拿旧值顶替。 */
  fetched: boolean
}

export interface MigrationProgress {
  done: boolean
  /** 设备回填游标（按投运年份升序）。 */
  deviceCursor: number
  /** 历史报告补录游标（按检验发生日期升序）。 */
  reportCursor: number
  scanned: boolean
  summarized: boolean
  summary: string
  log: string[]
}

export interface CraneState {
  version: number
  orgs: Org[]
  accounts: Account[]
  devices: Device[]
  records: InspectionRecord[]
  warnings: Warning[]
  todos: LinkedTodo[]
  logs: AccessLog[]
  legacy: LegacyRawItem[]
  migration: MigrationProgress
}

export interface SubmitInput {
  deviceId: string
  reportNo: string
  inspectedAt: string
  paperArchive: boolean
  wireRopeWearRate: string
  brakeClearance: string
  /** 页面上的主观结论；带实测值时以实测判定为准，冲突时覆盖此项。 */
  conclusion: '' | Conclusion
  inferred: boolean
  remark: string
}

export interface RegisterDeviceInput {
  name: string
  kind: string
  unitId: string
  agencyId: string
  gateRef: string
  commissionYear: number
  cycleMonths: number
  leadDays: number
  note: string
}

export interface ActionResult {
  ok: boolean
  message: string
}
