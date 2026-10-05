import { filterRows } from '@/api/local-service'
import { listRows, readSetting, saveRows, writeSetting } from '@/data/local-store'
import { LEGACY_PAPER_REPORTS } from '@/data/seed'
import type { LegacyPaperReport } from '@/data/seed'
import type { Account, ActionResult, EntryRow } from '@/data/types'

// —— 现行版别取数口径：检验周期、预警提前量、磨损限值全站统一按这一版取值 ——
export const INSPECTION_CYCLE_MONTHS = 24 // 门式/桥式起重机定期检验周期（月）
export const WARNING_LEAD_DAYS = 30 // 到期预警提前量（天）
export const LIMIT_WIRE_ROPE_PCT = 7 // 钢丝绳直径减小率限值（%）
export const LIMIT_BRAKE_PAD_PCT = 50 // 制动衬垫磨损率限值（%）

export const CRANE_KEY = 'crane'
export const AGENCY_KEY = 'craneAgency'
export const REPORT_KEY = 'craneReport'
export const ALERT_KEY = 'craneAlert'
export const TODO_KEY = 'craneTodo'

const MIGRATION_SETTING = 'crane-migration'

// 跨模块待办的落地入口：停用牌同时回写到闸门启闭与水情调度两个入口
export const TODO_TARGETS = [
  { key: 'gate', label: '闸门启闭' },
  { key: 'hydrology', label: '水情调度' },
] as const

export function todoTargetLabel(key: string): string {
  return TODO_TARGETS.find((item) => item.key === key)?.label ?? key
}

function pad(num: number): string {
  return String(num).padStart(2, '0')
}

export function todayStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function addMonthsStr(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const dt = new Date(year, month - 1 + months, day)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// —— 权限与归属：每个写操作都先过这道门，页面不自己做判断 ——

export type Permission = {
  canManageDevices: boolean
  canEnterConclusion: boolean
  note: string
}

export function permissionOf(account: Account): Permission {
  if (account.role === 'agency') {
    return {
      canManageDevices: false,
      canEnterConclusion: true,
      note: '检验机构账号：仅能为归属本机构、且本机构资质在有效期内的设备录入检验结论；替别的机构录入一律拦下',
    }
  }
  if (account.role === 'unit') {
    return {
      canManageDevices: true,
      canEnterConclusion: false,
      note: '本单位账号：可登记维护设备台账，检验结论只许查看、不许录入或修改',
    }
  }
  return {
    canManageDevices: false,
    canEnterConclusion: false,
    note: '外来账号：只许查看，任何写操作都会被拦下',
  }
}

// —— 查询：页面明细、统计、导出全部从这几个函数取数，保证报表同明细一致 ——

export function queryCraneDevices(filters: Record<string, string> = {}): EntryRow[] {
  return filterRows(listRows(CRANE_KEY), filters)
}

export function listAgencies(): EntryRow[] {
  return listRows(AGENCY_KEY)
}

export function agencyStatus(agency: EntryRow, today = todayStr()): string {
  return String(agency.资质有效期至) >= today ? '有效' : '已过期'
}

export function listReports(deviceCode = ''): EntryRow[] {
  const rows = listRows(REPORT_KEY)
  return deviceCode ? rows.filter((row) => row.设备编号 === deviceCode) : rows
}

export function listAlerts(): EntryRow[] {
  return listRows(ALERT_KEY)
}

export function listCraneTodos(moduleKey = '', activeOnly = false): EntryRow[] {
  let rows = listRows(TODO_KEY)
  if (moduleKey) {
    rows = rows.filter((row) => row.目标模块 === moduleKey)
  }
  if (activeOnly) {
    rows = rows.filter((row) => row.status === '待处理')
  }
  return rows
}

export function craneStats(rows: EntryRow[]): { label: string; value: number }[] {
  const count = (status: string) => rows.filter((row) => row.status === status).length
  return [
    { label: '设备总数', value: rows.length },
    { label: '检验有效', value: count('检验有效') },
    { label: '临期预警', value: count('临期预警') },
    { label: '停用挂牌', value: count('停用挂牌') },
    { label: '待检验', value: count('待检验') },
  ]
}

// —— 状态推算：检验有效 / 临期预警 / 停用挂牌 / 待检验 ——

export function computeDeviceStatus(device: EntryRow, today = todayStr()): string {
  if (String(device.检验结论 ?? '') === '不合格') {
    return '停用挂牌'
  }
  const due = String(device.下次检验日期 ?? '')
  if (due && due < today) {
    return '停用挂牌'
  }
  if (due && daysBetween(today, due) <= WARNING_LEAD_DAYS) {
    return '临期预警'
  }
  return String(device.上次检验日期 ?? '') ? '检验有效' : '待检验'
}

// 实测值优先：实测与限值冲突时，结论按实测这一套统一取值，申报结论只作留痕
export function deriveConclusion(wireText: string, brakeText: string): string | null {
  const wire = Number.parseFloat(wireText)
  const brake = Number.parseFloat(brakeText)
  const hasWire = !Number.isNaN(wire)
  const hasBrake = !Number.isNaN(brake)
  if (!hasWire && !hasBrake) {
    return null
  }
  if ((hasWire && wire > LIMIT_WIRE_ROPE_PCT) || (hasBrake && brake > LIMIT_BRAKE_PAD_PCT)) {
    return '不合格'
  }
  // 两项实测都齐且在限值内才按实测认定合格；只有一项时不强行认定
  return hasWire && hasBrake ? '合格' : null
}

// —— 预警 / 停用牌 / 跨模块待办的同步：每次数据变动后重算，幂等 ——

function buildAlert(alerts: EntryRow[], device: EntryRow, type: string, content: string, today: string): EntryRow {
  const id = nextId(alerts)
  return {
    id,
    status: '生效中',
    pending: true,
    abnormal: type === '超期停用',
    预警编号: `AL-${String(id).padStart(4, '0')}`,
    设备编号: device.设备编号,
    设备名称: device.设备名称,
    预警类型: type,
    预警内容: content,
    发出时间: today,
    收回时间: '',
    收回原因: '',
    归属单位: device.使用单位,
  }
}

function recallAlert(alert: EntryRow, today: string, reason: string): void {
  alert.status = '已收回'
  alert.pending = false
  alert.abnormal = false
  alert.收回时间 = today
  alert.收回原因 = reason
}

function buildTodo(todos: EntryRow[], device: EntryRow, moduleKey: string, reason: string, today: string): EntryRow {
  const id = nextId(todos)
  const text =
    moduleKey === 'gate'
      ? `${device.设备名称}(${device.设备编号})${reason}，已挂停用牌，闸门启闭操作禁止使用这台门机`
      : `${device.设备名称}(${device.设备编号})${reason}，已挂停用牌，水情调度涉及该门机的启闭安排须改用其他设备`
  return {
    id,
    status: '待处理',
    pending: true,
    abnormal: true,
    待办编号: `TODO-${String(id).padStart(4, '0')}`,
    目标模块: moduleKey,
    设备编号: device.设备编号,
    设备名称: device.设备名称,
    待办内容: text,
    来源: '起重设备检验台账',
    生成时间: today,
    解除时间: '',
  }
}

export function syncCraneAlerts(today = todayStr(), recallReason = '检验已完成，预警收回'): void {
  const devices = listRows(CRANE_KEY)
  const alerts = listRows(ALERT_KEY).map((row) => ({ ...row }))
  const todos = listRows(TODO_KEY).map((row) => ({ ...row }))
  let devicesDirty = false
  let alertsDirty = false
  let todosDirty = false

  const nextDevices = devices.map((device) => {
    const code = String(device.设备编号)
    const target = computeDeviceStatus(device, today)
    const activeOf = (type: string) =>
      alerts.find((row) => row.设备编号 === code && row.预警类型 === type && row.status === '生效中')

    if (target === '临期预警') {
      if (!activeOf('临期预警')) {
        const left = daysBetween(today, String(device.下次检验日期))
        alerts.push(
          buildAlert(
            alerts,
            device,
            '临期预警',
            `距下次检验日期 ${device.下次检验日期} 不足 ${WARNING_LEAD_DAYS} 天（剩余 ${left} 天），请安排定期检验`,
            today,
          ),
        )
        alertsDirty = true
      }
    } else if (target === '停用挂牌') {
      const reason = String(device.检验结论) === '不合格' ? '检验结论不合格' : '检验超期未检'
      const pendingWarning = activeOf('临期预警')
      if (pendingWarning) {
        recallAlert(pendingWarning, today, '已超期，临期预警转停用挂牌')
        alertsDirty = true
      }
      if (!activeOf('超期停用')) {
        alerts.push(buildAlert(alerts, device, '超期停用', `${reason}，自动挂停用牌，禁止使用`, today))
        alertsDirty = true
      }
      for (const targetModule of TODO_TARGETS) {
        const existing = todos.find(
          (row) => row.设备编号 === code && row.目标模块 === targetModule.key && row.status === '待处理',
        )
        if (!existing) {
          todos.push(buildTodo(todos, device, targetModule.key, reason, today))
          todosDirty = true
        }
      }
    } else {
      // 恢复正常：收回该设备所有生效中预警、解除跨模块待办；历史检验记录一条不动
      for (const alert of alerts) {
        if (alert.设备编号 === code && alert.status === '生效中') {
          recallAlert(alert, today, recallReason)
          alertsDirty = true
        }
      }
      for (const todo of todos) {
        if (todo.设备编号 === code && todo.status === '待处理') {
          todo.status = '已解除'
          todo.pending = false
          todo.abnormal = false
          todo.解除时间 = today
          todosDirty = true
        }
      }
    }

    const pending = target !== '检验有效'
    const abnormal = target === '停用挂牌'
    if (device.status !== target || device.pending !== pending || device.abnormal !== abnormal) {
      devicesDirty = true
      return { ...device, status: target, pending, abnormal }
    }
    return device
  })

  if (devicesDirty) {
    saveRows(CRANE_KEY, nextDevices)
  }
  if (alertsDirty) {
    saveRows(ALERT_KEY, alerts)
  }
  if (todosDirty) {
    saveRows(TODO_KEY, todos)
  }
}

// —— 设备登记：只有本单位账号能管台账 ——

export type DevicePayload = {
  设备编号: string
  设备名称: string
  设备类型: string
  使用单位: string
  检验机构: string
  投运年份: string
}

// 缺项按现行版别推断；存量设备没有检验日期时按投运年份回填
export function backfillDeviceDates(device: EntryRow, today = todayStr()): EntryRow {
  const next = { ...device }
  if (!Number(next['检验周期(月)'])) {
    next['检验周期(月)'] = INSPECTION_CYCLE_MONTHS
  }
  if (!String(next.下次检验日期 ?? '')) {
    const cycle = Number(next['检验周期(月)'])
    const last = String(next.上次检验日期 ?? '')
    if (last) {
      next.下次检验日期 = addMonthsStr(last, cycle)
    } else if (next.投运年份) {
      // 以投运年份年中为基准，按周期滚动到第一个不早于今天的日期
      let due = addMonthsStr(`${next.投运年份}-07-01`, cycle)
      while (due < today) {
        due = addMonthsStr(due, cycle)
      }
      next.下次检验日期 = due
      if (!next.资料来源 || next.资料来源 === '—') {
        next.资料来源 = '按投运年份推断'
      }
    }
  }
  return next
}

export function registerDevice(account: Account, payload: DevicePayload): ActionResult {
  if (account.role === 'external') {
    return { ok: false, message: '已拦下：外来账号只许查看，不许登记设备' }
  }
  if (account.role === 'agency') {
    return { ok: false, message: '已拦下：检验机构账号只能为归属本机构的设备录入检验结论，设备台账由使用单位登记维护' }
  }
  const devices = listRows(CRANE_KEY)
  if (!payload.设备编号.trim() || !payload.设备名称.trim()) {
    return { ok: false, message: '已拦下：设备编号、设备名称不能为空' }
  }
  if (devices.some((row) => row.设备编号 === payload.设备编号.trim())) {
    return { ok: false, message: `已拦下：设备编号 ${payload.设备编号} 已存在，台账里只留一条` }
  }
  const agency = listRows(AGENCY_KEY).find((row) => row.机构名称 === payload.检验机构)
  if (!agency) {
    return { ok: false, message: `已拦下：检验机构「${payload.检验机构}」未登记资质，不能设为归属检验机构` }
  }
  const device: EntryRow = {
    id: nextId(devices),
    status: '待检验',
    pending: true,
    abnormal: false,
    设备编号: payload.设备编号.trim(),
    设备名称: payload.设备名称.trim(),
    设备类型: payload.设备类型,
    使用单位: payload.使用单位.trim(),
    检验机构: payload.检验机构,
    投运年份: payload.投运年份.trim(),
    '检验周期(月)': INSPECTION_CYCLE_MONTHS,
    上次检验日期: '',
    下次检验日期: '',
    检验结论: '—',
    报告编号: '—',
    资料来源: '—',
    最近操作人: `${account.name}（${account.org}）`,
  }
  saveRows(CRANE_KEY, [...devices, backfillDeviceDates(device)])
  syncCraneAlerts()
  return {
    ok: true,
    message: `设备 ${payload.设备编号} 已登记：使用单位「${payload.使用单位}」，归属检验机构「${payload.检验机构}」`,
  }
}

// —— 检验结论录入：资质、归属、去重、实测优先四道闸 ——

export type ReportPayload = {
  设备编号: string
  报告编号: string
  检验日期: string
  申报结论: string
  钢丝绳实测: string
  制动器实测: string
  资料来源: string
}

export function submitInspectionReport(account: Account, payload: ReportPayload): ActionResult {
  const today = todayStr()
  // 第一道：角色门禁——外来账号、本单位账号一律挡回
  if (account.role === 'external') {
    return { ok: false, message: '已拦下：外来账号只许查看，不许录入检验结论' }
  }
  if (account.role === 'unit') {
    return { ok: false, message: '已拦下：本单位账号只许查看检验结论，不许录入或修改；请由归属检验机构账号录入' }
  }
  // 第二道：机构资质门禁——只有取得检验资质且在有效期内的机构才能录结论
  const agency = listRows(AGENCY_KEY).find((row) => row.机构名称 === account.org)
  if (!agency) {
    return { ok: false, message: `已拦下：机构「${account.org}」未登记检验资质，不能录入检验结论` }
  }
  if (agencyStatus(agency, today) !== '有效') {
    return {
      ok: false,
      message: `已拦下：检验机构「${account.org}」资质已过期（有效期至 ${agency.资质有效期至}），不能录入检验结论`,
    }
  }
  // 第三道：归属门禁——跨单位替别人录检验结果的越权提交一律挡回
  const devices = listRows(CRANE_KEY)
  const device = devices.find((row) => row.设备编号 === payload.设备编号)
  if (!device) {
    return { ok: false, message: `已拦下：没有找到设备 ${payload.设备编号}` }
  }
  if (device.检验机构 !== account.org) {
    return {
      ok: false,
      message: `已拦下（越权提交）：设备 ${device.设备编号}「${device.设备名称}」的归属检验机构是「${device.检验机构}」，当前账号属于「${account.org}」，不能替别的机构录入检验结果`,
    }
  }
  if (!payload.报告编号.trim() || !payload.检验日期) {
    return { ok: false, message: '已拦下：报告编号、检验日期不能为空' }
  }
  // 第四道：报告编号去重——同一份检验报告重复上传只留一条
  const reports = listRows(REPORT_KEY)
  if (reports.some((row) => row.报告编号 === payload.报告编号.trim())) {
    return {
      ok: false,
      message: `已拦下（重复上传）：报告编号 ${payload.报告编号} 已存在，同一份检验报告只保留一条，原记录不动`,
    }
  }
  // 实测值优先：申报结论与实测冲突时按实测统一取值
  const derived = deriveConclusion(payload.钢丝绳实测, payload.制动器实测)
  const finalConclusion = derived ?? payload.申报结论
  const note =
    derived && derived !== payload.申报结论
      ? `申报结论「${payload.申报结论}」与实测值冲突，按实测统一取「${derived}」`
      : '实测值与限值核对一致'
  const report: EntryRow = {
    id: nextId(reports),
    status: finalConclusion,
    pending: finalConclusion !== '合格',
    abnormal: finalConclusion === '不合格',
    报告编号: payload.报告编号.trim(),
    设备编号: device.设备编号,
    设备名称: device.设备名称,
    检验机构: account.org,
    检验日期: payload.检验日期,
    申报结论: payload.申报结论,
    认定结论: finalConclusion,
    '钢丝绳实测(%)': payload.钢丝绳实测 || '缺项（未填）',
    '钢丝绳限值(%)': LIMIT_WIRE_ROPE_PCT,
    '制动器实测(%)': payload.制动器实测 || '缺项（未填）',
    '制动器限值(%)': LIMIT_BRAKE_PAD_PCT,
    资料来源: payload.资料来源,
    录入人: account.name,
    归属标记: `${account.org}·在线录入`,
    取值说明: note,
  }
  // 报告只增不改：历史结论留痕，谁也不许盖掉
  saveRows(REPORT_KEY, [...reports, report])
  // 回写设备（旧报告不顶替新状态），再重算预警/停用牌/跨模块待办
  const updatedDevices = devices.map((row) =>
    row.设备编号 === device.设备编号 ? { ...row, 最近操作人: `${account.name}（${account.org}）` } : row,
  )
  saveRows(CRANE_KEY, updatedDevices)
  refreshDevicesFromReports()
  syncCraneAlerts(today, `检验已完成（报告 ${report.报告编号}），预警收回`)
  return { ok: true, message: `检验结论已录入：${device.设备名称} 认定结论「${finalConclusion}」。${note}` }
}

// 按最新一份报告重算设备检验日期与结论；旧报告不顶替新状态
export function refreshDevicesFromReports(): void {
  const reports = listRows(REPORT_KEY)
  const devices = listRows(CRANE_KEY)
  let dirty = false
  const next = devices.map((device) => {
    const mine = reports
      .filter((row) => row.设备编号 === device.设备编号)
      .sort((a, b) => String(a.检验日期).localeCompare(String(b.检验日期)))
    if (!mine.length) {
      return device
    }
    const latest = mine[mine.length - 1]
    const currentLast = String(device.上次检验日期 ?? '')
    if (currentLast && String(latest.检验日期) < currentLast) {
      return device
    }
    const cycle = Number(device['检验周期(月)']) || INSPECTION_CYCLE_MONTHS
    const updated: EntryRow = {
      ...device,
      上次检验日期: latest.检验日期,
      下次检验日期: addMonthsStr(String(latest.检验日期), cycle),
      检验结论: latest.认定结论,
      报告编号: latest.报告编号,
      资料来源: latest.资料来源,
    }
    if (JSON.stringify(updated) !== JSON.stringify(device)) {
      dirty = true
    }
    return updated
  })
  if (dirty) {
    saveRows(CRANE_KEY, next)
  }
}

// —— 存量迁移：断点续传，游标逐条落盘，中断后从断掉的那一条接着走 ——

export type MigrationState = {
  cursor: number
  total: number
  done: boolean
  log: string[]
}

function sortedLegacy(): LegacyPaperReport[] {
  // 既有记录按发生日期（检验日期）升序补数
  return [...LEGACY_PAPER_REPORTS].sort((a, b) => a.检验日期.localeCompare(b.检验日期))
}

export function migrationState(): MigrationState {
  const state = readSetting<MigrationState | null>(MIGRATION_SETTING, null)
  if (state) {
    return state
  }
  return { cursor: 0, total: sortedLegacy().length, done: false, log: [] }
}

function capLog(log: string[]): string[] {
  return log.slice(-30)
}

function buildMigratedReport(raw: LegacyPaperReport, reportNo: string, device: EntryRow, existing: EntryRow[]): EntryRow {
  const wire = raw.钢丝绳实测
  const brake = raw.制动器实测
  const derived = deriveConclusion(
    wire === undefined ? '' : String(wire),
    brake === undefined ? '' : String(brake),
  )
  const finalConclusion = derived ?? raw.申报结论
  const notes: string[] = []
  if (derived && derived !== raw.申报结论) {
    notes.push(`申报结论「${raw.申报结论}」与实测值冲突，按实测统一取「${derived}」`)
  } else {
    notes.push('实测值与限值核对一致')
  }
  if (wire === undefined) {
    notes.push('钢丝绳实测缺项（纸质未记），未拿旧值顶替')
  }
  if (brake === undefined) {
    notes.push('制动器实测缺项（纸质未记），未拿旧值顶替')
  }
  return {
    id: nextId(existing),
    status: finalConclusion,
    pending: finalConclusion !== '合格',
    abnormal: finalConclusion === '不合格',
    报告编号: reportNo,
    设备编号: raw.设备编号,
    设备名称: device.设备名称,
    检验机构: raw.检验机构 || device.检验机构,
    检验日期: raw.检验日期,
    申报结论: raw.申报结论,
    认定结论: finalConclusion,
    '钢丝绳实测(%)': wire === undefined ? '缺项（纸质未记）' : wire,
    '钢丝绳限值(%)': LIMIT_WIRE_ROPE_PCT,
    '制动器实测(%)': brake === undefined ? '缺项（纸质未记）' : brake,
    '制动器限值(%)': LIMIT_BRAKE_PAD_PCT,
    资料来源: '纸质补录',
    录入人: '档案管理员（补录）',
    归属标记: `${raw.检验机构 || device.检验机构}·纸质补录`,
    取值说明: notes.join('；'),
  }
}

export function runLegacyMigration(account: Account): { ok: boolean; message: string; state: MigrationState } {
  if (account.role === 'external') {
    return { ok: false, message: '已拦下：外来账号只许查看，不许执行迁移', state: migrationState() }
  }
  if (account.role === 'agency') {
    return { ok: false, message: '已拦下：存量迁移由使用单位执行，检验机构账号无权改动台账', state: migrationState() }
  }
  const legacy = sortedLegacy()
  const state = migrationState()
  state.total = legacy.length
  if (state.done) {
    return { ok: true, message: '存量迁移已完成；重复执行不会改动既有记录，不拿旧值顶替', state }
  }
  const today = todayStr()
  const log = [...state.log]

  // 步骤①②：机构资质已在册；设备台账缺项按投运年份与现行版别回填
  const devices = listRows(CRANE_KEY).map((row) => backfillDeviceDates(row, today))
  saveRows(CRANE_KEY, devices)
  log.push(
    `步骤①② 机构资质 ${listRows(AGENCY_KEY).length} 家在册；设备缺项已按投运年份与现行版别（周期 ${INSPECTION_CYCLE_MONTHS} 个月）回填`,
  )

  // 步骤③：历史报告从断点（cursor）接着导入，逐条推进、逐条落盘
  const reports = listRows(REPORT_KEY)
  let cursor = state.cursor
  while (cursor < legacy.length) {
    const raw = legacy[cursor]
    const device = devices.find((row) => row.设备编号 === raw.设备编号)
    if (!device) {
      // 取数中断：游标停在这一条，下次执行从这条接着走
      log.push(`断在第 ${cursor + 1} 条（设备 ${raw.设备编号}）：设备未建档，迁移暂停，修好后从这条接着走`)
      const halted: MigrationState = { cursor, total: legacy.length, done: false, log: capLog(log) }
      writeSetting(MIGRATION_SETTING, halted)
      return { ok: false, message: `迁移断在第 ${cursor + 1} 条：设备 ${raw.设备编号} 未建档`, state: halted }
    }
    const reportNo = raw.报告编号 || `PAPER-${raw.设备编号}-${raw.检验日期.slice(0, 4)}`
    if (reports.some((row) => row.报告编号 === reportNo)) {
      log.push(`第 ${cursor + 1} 条 报告编号 ${reportNo} 重复，去重跳过，只留一条`)
    } else {
      reports.push(buildMigratedReport(raw, reportNo, device, reports))
      log.push(`第 ${cursor + 1} 条 报告 ${reportNo} 已建档（纸质补录）`)
    }
    cursor += 1
    // 每推进一条就落一次盘：中断后从断掉的那一条接着走，不拿旧值顶替
    writeSetting(MIGRATION_SETTING, { cursor, total: legacy.length, done: false, log: capLog(log) })
  }
  saveRows(REPORT_KEY, reports)

  // 步骤④：按最新报告重算设备检验日期与结论；步骤⑤⑥：重算预警/停用牌并回写跨模块待办
  refreshDevicesFromReports()
  syncCraneAlerts(today)

  const done: MigrationState = {
    cursor,
    total: legacy.length,
    done: true,
    log: capLog([...log, '步骤④⑤⑥ 设备状态、预警停用牌、跨模块待办已重算，迁移完成']),
  }
  writeSetting(MIGRATION_SETTING, done)
  return { ok: true, message: `存量迁移完成：共 ${legacy.length} 条纸质记录全部处理完毕`, state: done }
}

// —— 导出：统计和明细从同一次查询结果出，报表同明细清单始终一致 ——

const LEDGER_COLUMNS = [
  '设备编号',
  '设备名称',
  '设备类型',
  '使用单位',
  '检验机构',
  '投运年份',
  '检验周期(月)',
  '上次检验日期',
  '下次检验日期',
  '检验结论',
  '报告编号',
  '资料来源',
  '最近操作人',
]

export function exportCraneLedger(filters: Record<string, string> = {}): { filename: string; content: string } {
  const rows = queryCraneDevices(filters)
  const stats = craneStats(rows)
  const lines = [['序号', ...LEDGER_COLUMNS, '当前状态'].join(',')]
  rows.forEach((row, index) => {
    lines.push([index + 1, ...LEDGER_COLUMNS.map((column) => row[column] ?? ''), row.status].join(','))
  })
  lines.push('')
  lines.push(['统计口径', '数值'].join(','))
  for (const item of stats) {
    lines.push([item.label, item.value].join(','))
  }
  lines.push(['生成时间', todayStr()].join(','))
  return { filename: '起重设备检验台账.csv', content: `\uFEFF${lines.join('\n')}` }
}

export function downloadCraneLedger(filters: Record<string, string> = {}): void {
  const { filename, content } = exportCraneLedger(filters)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
