import {
  CURRENT_BASIS,
  DEFAULT_CYCLE_MONTHS,
  DEFAULT_LEAD_DAYS,
} from '@/data/crane/constants'
import {
  basisLabel,
  computeNextDue,
  daysBetween,
  judgeByMeasurement,
  measurementOutOfLimit,
  reconcileAll,
  todayIso,
} from '@/data/crane/domain'
import { loadState, makeLogId, resetState as resetStore, saveState } from '@/data/crane/store'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import type {
  AccessLog,
  Account,
  ActionResult,
  CraneState,
  Device,
  InspectionRecord,
  LinkedTodo,
  RegisterDeviceInput,
  SubmitInput,
  Warning,
} from '@/data/crane/types'

// ---------------------------------------------------------------------------
// 账号：默认用使用单位身份进入（只看得动不了结论）；可在台账页切换验证越权拦截。
// ---------------------------------------------------------------------------

const ACCOUNT_KEY = 'hydropower-plant-om:crane-account'
let currentAccountId =
  typeof window !== 'undefined' ? window.localStorage.getItem(ACCOUNT_KEY) ?? 'C-DBA-01' : 'C-DBA-01'

export function listAccounts(): Account[] {
  return loadState().accounts
}

export function listOrgs(): CraneState['orgs'] {
  return loadState().orgs
}

export function currentAccount(): Account {
  const state = loadState()
  return state.accounts.find((a) => a.id === currentAccountId) ?? state.accounts[0]
}

export function switchAccount(id: string): ActionResult {
  const state = loadState()
  const account = state.accounts.find((a) => a.id === id)
  if (!account) {
    return { ok: false, message: '账号不存在，切换被拒绝' }
  }
  currentAccountId = id
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACCOUNT_KEY, id)
  }
  return { ok: true, message: `当前身份：${account.name}（${account.role}）` }
}

function isAgency(a: Account): boolean {
  return a.role === '检验机构'
}

/** 服务层鉴权：页面按钮藏不藏只是表现，能不能写全部在这里判。 */
function canWriteConclusion(a: Account, device: Device): { ok: boolean; reason: string } {
  if (a.role === '外部审计') {
    return { ok: false, reason: '外来账号只有查看权限，不得录入或修改任何检验结论' }
  }
  if (a.role === '使用单位') {
    return { ok: false, reason: '使用单位人员对检验结论只有查看权，结论必须由具备资质的检验机构录入' }
  }
  if (!isAgency(a)) {
    return { ok: false, reason: '当前账号不是检验机构账号，无权录入检验结论' }
  }
  if (!a.qualified) {
    return { ok: false, reason: `${a.orgName}未取得有效的起重机械定期检验资质（资质缺失或已过期），不得出具检验结论` }
  }
  if (a.orgId !== device.agencyId) {
    return {
      ok: false,
      reason: `越权提交被拦截：该台设备登记的检验机构是「${device.agencyName}」，当前账号属于「${a.orgName}」，不得替别的检验机构录入结论`,
    }
  }
  if (!a.scopeUnitIds.includes(device.unitId)) {
    return {
      ok: false,
      reason: `越权提交被拦截：当前机构的授权范围不包含使用单位「${device.unitName}」，跨单位替别人录检验结果一律挡回`,
    }
  }
  return { ok: true, reason: '' }
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export function listDevices(): Device[] {
  return loadState().devices
}

export function listRecords(): InspectionRecord[] {
  return [...loadState().records].sort((a, b) => (a.inspectedAt < b.inspectedAt ? 1 : -1))
}

export function listWarnings(): Warning[] {
  return [...loadState().warnings].sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1))
}

export function activeTodos(target?: LinkedTodo['target']): LinkedTodo[] {
  return loadState()
    .todos.filter((t) => (target ? t.target === target : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function listLogs(): AccessLog[] {
  return [...loadState().logs].sort((a, b) => (a.at < b.at ? 1 : -1))
}

export function deviceMap(): Map<string, Device> {
  return new Map(loadState().devices.map((d) => [d.id, d]))
}

/**
 * 跨模块桥接：把起重台账里的门机按「闸门启闭对象编号」同步成行到闸门启闭模块，
 * 操作工从另一个入口就能看到这台门机；状态随检验结论联动刷新。
 */
export function syncGateBridge(): void {
  const state = loadState()
  const rows = [...listRows('gate')]
  let changed = false
  for (const device of state.devices) {
    const idx = rows.findIndex((r) => String(r['闸门编号']) === device.gateRef)
    const gateStatus = device.stopTag ? '故障' : device.status === '预警' ? '运行中' : '运行中'
    const row: EntryRow = {
      id: idx >= 0 ? rows[idx].id : 1000 + Number(device.id.replace('CR-', '')),
      status: gateStatus,
      pending: device.status === '预警',
      abnormal: device.stopTag,
      闸门编号: device.gateRef,
      闸门类型: device.kind,
      孔口尺寸: '—',
      当前开度: device.stopTag ? '停用禁止操作' : device.status === '预警' ? '检验即将到期，谨慎操作' : '可操作',
      启闭机型号: device.name,
      操作人员: device.unitName,
      操作时间: device.nextDueDate ? `检验到期 ${device.nextDueDate}` : '无有效检验',
      闸门状态: device.stopTag ? `停用：${device.stopReason}` : device.status === '预警' ? `检验预警：${device.nextDueDate} 到期` : '正常可用',
    }
    if (idx >= 0) {
      const prev = rows[idx]
      if (prev.status !== row.status || prev['闸门状态'] !== row['闸门状态']) {
        rows[idx] = row
        changed = true
      }
    } else {
      rows.push(row)
      changed = true
    }
  }
  if (changed) {
    saveRows('gate', rows)
  }
}

/** 闸门启闭动作的跨模块硬拦截：门机挂着停用指令时，开启操作一律挡回。 */
export function gateActionBlocked(gateCode: string, action: string): string | null {
  if (!action.includes('开启')) {
    return null
  }
  const state = loadState()
  const todo = state.todos.find(
    (t) => t.target === 'gate' && t.gateRef === gateCode && t.kind === '停用指令' && t.state === '待办',
  )
  if (todo) {
    return `跨模块拦截：${todo.reason}。请等待起重设备定检台账复检合格、停用待办解除后再操作。`
  }
  return null
}

// ---------------------------------------------------------------------------
// 结论录入（只追加、去重、实测优先、写完跨模块对账）
// ---------------------------------------------------------------------------

export function submitInspection(input: SubmitInput): ActionResult {
  const state = loadState()
  const account = state.accounts.find((a) => a.id === currentAccountId)!
  const device = state.devices.find((d) => d.id === input.deviceId)
  const today = todayIso()

  if (!device) {
    return deny(state, account, '录入检验结论', input.reportNo || '（无报告编号）', '设备不存在，无法录入')
  }

  // 1) 归属与资质：逐档拦
  const auth = canWriteConclusion(account, device)
  if (!auth.ok) {
    return deny(state, account, '录入检验结论', `${device.name}/${input.reportNo || '无编号'}`, auth.reason)
  }

  // 2) 报告编号去重：同一份报告重复上传只留一条
  const reportNo = input.reportNo.trim()
  if (!reportNo) {
    return deny(state, account, '录入检验结论', device.name, '报告编号为空，无法录入；每份报告必须有唯一编号')
  }
  const dup = state.records.find((r) => r.reportNo === reportNo)
  if (dup) {
    return deny(
      state,
      account,
      '录入检验结论',
      reportNo,
      `报告编号「${reportNo}」已存在（${dup.deviceName}，检验日期 ${dup.inspectedAt}），同一份检验报告重复上传只留一条，本次提交挡回`,
    )
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.inspectedAt)) {
    return deny(state, account, '录入检验结论', reportNo, '检验日期格式应为 YYYY-MM-DD')
  }
  if (input.inspectedAt > today) {
    return deny(state, account, '录入检验结论', reportNo, '检验日期不能晚于今天')
  }

  // 3) 实测值优先：两项都给就按实测判定，主观结论冲突时以实测为准
  const rawWire = input.wireRopeWearRate.trim()
  const rawBrake = input.brakeClearance.trim()
  const hasMeasured = rawWire !== '' || rawBrake !== ''
  let measured: InspectionRecord['measured'] = null
  let conclusion: InspectionRecord['conclusion']
  let inferred = input.inferred

  if (input.paperArchive && !hasMeasured) {
    // 纸质报告补录：无实测项，缺项按现行版别推断为合格取值，并强制推断标记
    conclusion = '合格'
    inferred = true
  } else if (hasMeasured) {
    const wire = rawWire === '' ? 0 : Number(rawWire)
    const brake = rawBrake === '' ? 0 : Number(rawBrake)
    if (Number.isNaN(wire) || Number.isNaN(brake)) {
      return deny(state, account, '录入检验结论', reportNo, '实测值必须是数字')
    }
    measured = { wireRopeWearRate: wire, brakeClearance: brake }
    const judged = judgeByMeasurement(measured)
    if (input.conclusion && input.conclusion !== judged) {
      // 实测与主观结论冲突：统一按实测那一套取值，不采纳手填结论
      conclusion = judged
    } else {
      conclusion = input.conclusion === '合格' || input.conclusion === '不合格' ? input.conclusion : judged
    }
    // 只交了一项实测时，另一项按现行版别推断，打推断标记
    inferred = rawWire === '' || rawBrake === '' ? true : inferred
  } else {
    if (input.conclusion !== '合格' && input.conclusion !== '不合格') {
      return deny(state, account, '录入检验结论', reportNo, '未填实测值时必须明确给出检验结论（合格/不合格）')
    }
    conclusion = input.conclusion
  }

  const nextDue = computeNextDue(input.inspectedAt, device.cycleMonths)
  const record: InspectionRecord = {
    id: `IR-${state.records.length + 1}-${Date.now().toString(36)}`,
    reportNo,
    deviceId: device.id,
    deviceName: device.name,
    inspectedAt: input.inspectedAt,
    nextDue,
    agencyId: account.orgId,
    agencyName: account.orgName,
    inspectorAccountId: account.id,
    inspectorName: account.name,
    conclusion,
    measured,
    basis: CURRENT_BASIS,
    hasMeasured: measured !== null,
    inferred,
    paperArchive: input.paperArchive,
    remark: [input.remark.trim(), input.paperArchive ? '纸质报告电子补录，原件存档案柜待核' : '']
      .filter(Boolean)
      .join('；'),
    createdAt: today,
    immutable: true,
  }

  state.records.push(record)
  const rec = reconcileAll(
    state.devices,
    state.records,
    state.warnings,
    state.todos,
    today,
    new Set([record.id]),
  )
  state.devices = rec.devices
  state.warnings = rec.warnings
  state.todos = rec.todos

  const conflict = measured
    ? measurementOutOfLimit(measured)
    : []
  const messages: string[] = []
  messages.push(`报告 ${reportNo} 已按「只追加」归档（${input.inspectedAt}，结论 ${conclusion}），历史结论未做任何覆盖`)
  if (input.conclusion && measured && input.conclusion !== conclusion) {
    messages.push(`手填结论「${input.conclusion}」与实测冲突，统一按实测取值判定为「${conclusion}」：${conflict.join('；')}`)
  }
  if (conclusion === '不合格') {
    messages.push('设备已自动挂停用牌，闸门启闭/水情调度两个入口的停用待办已同步下发')
  } else if (rec.events.length) {
    messages.push(...rec.events)
  }
  if (input.paperArchive) {
    messages.push('纸质归档缺项按现行版别（TSG Q7015-2016）推断，已打推断标记')
  }

  state.logs.unshift({
    id: makeLogId(),
    at: today,
    accountId: account.id,
    accountName: account.name,
    action: '录入检验结论',
    target: `${device.name}/${reportNo}`,
    ok: true,
    reason: messages.join('；'),
  })
  commit(state)
  return { ok: true, message: messages.join('；') }
}

function deny(state: CraneState, account: Account, action: string, target: string, reason: string): ActionResult {
  state.logs.unshift({
    id: makeLogId(),
    at: todayIso(),
    accountId: account.id,
    accountName: account.name,
    action,
    target,
    ok: false,
    reason,
  })
  commit(state)
  return { ok: false, message: reason }
}

/** 统一落库：状态持久化 + 闸门启闭模块桥接同步。 */
function commit(state: CraneState): void {
  saveState(state)
  syncGateBridge()
}

// ---------------------------------------------------------------------------
// 新建设备台账（使用单位登记自己的设备；机构按授权代登记）
// ---------------------------------------------------------------------------

export function registerDevice(input: RegisterDeviceInput): ActionResult {
  const state = loadState()
  const account = state.accounts.find((a) => a.id === currentAccountId)!
  if (account.role === '外部审计') {
    return deny(state, account, '登记设备', input.name, '外来账号只有查看权限，不得登记设备')
  }
  if (!input.name.trim() || !input.kind.trim() || !input.gateRef.trim()) {
    return deny(state, account, '登记设备', input.name || '（无名）', '设备名称、设备类型、闸门启闭对象编号为必填归属项')
  }
  const unit = state.orgs.find((o) => o.id === input.unitId && o.kind === '使用单位')
  const agency = state.orgs.find((o) => o.id === input.agencyId && o.kind === '检验机构')
  if (!unit || !agency) {
    return deny(state, account, '登记设备', input.name, '使用单位或检验机构未在归属名册中，登记挡回')
  }
  if (account.role === '使用单位' && account.orgId !== unit.id) {
    return deny(state, account, '登记设备', input.name, '使用单位只能登记本单位名下设备，不得跨单位登记')
  }
  if (account.role === '检验机构' && (!account.qualified || !account.scopeUnitIds.includes(unit.id))) {
    return deny(state, account, '登记设备', input.name, '该机构无有效资质或未获此使用单位授权，不得代登记')
  }
  if (state.devices.some((d) => d.gateRef === input.gateRef.trim())) {
    return deny(state, account, '登记设备', input.name, `闸门启闭对象编号 ${input.gateRef} 已被占用，归属必须唯一`)
  }
  const device: Device = {
    id: `CR-${String(state.devices.length + 1).padStart(3, '0')}`,
    name: input.name.trim(),
    kind: input.kind.trim(),
    unitId: unit.id,
    unitName: unit.name,
    agencyId: agency.id,
    agencyName: agency.name,
    gateRef: input.gateRef.trim(),
    commissionYear: input.commissionYear,
    cycleMonths: input.cycleMonths || DEFAULT_CYCLE_MONTHS,
    leadDays: input.leadDays || DEFAULT_LEAD_DAYS,
    lastInspectionDate: '',
    nextDueDate: '',
    status: '停用',
    stopTag: true,
    stopReason: '新登记设备尚无有效检验记录，首检合格前禁止投用',
    source: '电子建档',
    legacyId: null,
    inferred: false,
    note: input.note.trim(),
  }
  state.devices.push(device)
  const rec = reconcileAll(state.devices, state.records, state.warnings, state.todos, todayIso())
  state.devices = rec.devices
  state.warnings = rec.warnings
  state.todos = rec.todos
  state.logs.unshift({
    id: makeLogId(),
    at: todayIso(),
    accountId: account.id,
    accountName: account.name,
    action: '登记设备',
    target: device.name,
    ok: true,
    reason: `使用单位：${unit.name}；检验机构：${agency.name}；首检合格前停用待办已下发到两个入口`,
  })
  commit(state)
  return { ok: true, message: `设备 ${device.name} 已建档（${device.id}），归属登记完成；首检合格前挂停用牌` }
}

// ---------------------------------------------------------------------------
// 到期扫描：可手动再跑（每天/每次进入也会跑），幂等
// ---------------------------------------------------------------------------

export function runDueScan(): ActionResult {
  const state = loadState()
  const before = JSON.stringify({ w: state.warnings, t: state.todos, d: state.devices.map((x) => [x.id, x.status]) })
  const rec = reconcileAll(state.devices, state.records, state.warnings, state.todos, todayIso())
  const after = JSON.stringify({ w: rec.warnings, t: rec.todos, d: rec.devices.map((x) => [x.id, x.status]) })
  state.devices = rec.devices
  state.warnings = rec.warnings
  state.todos = rec.todos
  const changed = before !== after
  const message = changed
    ? `到期扫描完成：${rec.events.join('；') || '状态有调整'}`
    : '到期扫描完成：设备状态、预警与两个入口的待办均无变化'
  state.logs.unshift({
    id: makeLogId(),
    at: todayIso(),
    accountId: 'SYSTEM',
    accountName: '系统',
    action: '到期扫描',
    target: '全部起重设备',
    ok: true,
    reason: message,
  })
  commit(state)
  return { ok: true, message }
}

// ---------------------------------------------------------------------------
// 存量迁移：顺序固定、游标持久化、取数中断从断条续走
// ---------------------------------------------------------------------------

export function migrationState(): CraneState['migration'] {
  return loadState().migration
}

export function legacyItems(): CraneState['legacy'] {
  return loadState().legacy
}

/** 演示用：把“取数中断”的那一条补取到（实际业务里是等外委单位补交磨损记录）。 */
export function resumeFetch(legacyId: string, values: { wire: string; brake: string }): ActionResult {
  const state = loadState()
  const account = state.accounts.find((a) => a.id === currentAccountId)!
  const item = state.legacy.find((l) => l.id === legacyId)
  if (!item) {
    return deny(state, account, '续取数据', legacyId, '存量条目不存在')
  }
  if (item.fetched) {
    return { ok: true, message: `条目 ${legacyId} 取数已完成，无需续取` }
  }
  const wire = Number(values.wire)
  const brake = Number(values.brake)
  if (Number.isNaN(wire) || Number.isNaN(brake)) {
    return deny(state, account, '续取数据', legacyId, '续取的磨损实测值必须是数字，缺数不许用旧值顶替')
  }
  item.measured = { wireRopeWearRate: wire, brakeClearance: brake }
  item.fetched = true
  state.logs.unshift({
    id: makeLogId(),
    at: todayIso(),
    accountId: account.id,
    accountName: account.name,
    action: '续取数据',
    target: item.deviceName,
    ok: true,
    reason: `从断掉的那一条 ${legacyId} 续取成功（钢丝绳 ${wire}%，制动器 ${brake}mm），未用旧值顶替`,
  })
  commit(state)
  return { ok: true, message: `已从断点 ${legacyId} 续取，迁移可继续从该条往下走` }
}

/** 阶段②：按投运年份升序回填设备，一次推进一步（一个游标，逐台落库）。 */
export function migrateNextDevice(): ActionResult {
  const state = loadState()
  const account = state.accounts.find((a) => a.id === currentAccountId)!
  const m = state.migration
  const ordered = [...state.legacy].sort((a, b) => a.commissionYear - b.commissionYear)
  if (m.deviceCursor >= ordered.length) {
    return { ok: false, message: '存量设备已全部回填，请进入报告补录阶段' }
  }
  const item = ordered[m.deviceCursor]
  const unit = state.orgs.find((o) => o.id === item.unitId)!
  const agency = state.orgs.find((o) => o.id === item.agencyId)!
  const device: Device = {
    id: `CR-${String(state.devices.length + 1).padStart(3, '0')}`,
    name: item.deviceName,
    kind: item.kind,
    unitId: unit.id,
    unitName: unit.name,
    agencyId: agency.id,
    agencyName: agency.name,
    gateRef: item.gateRef,
    commissionYear: item.commissionYear,
    cycleMonths: DEFAULT_CYCLE_MONTHS,
    leadDays: DEFAULT_LEAD_DAYS,
    lastInspectionDate: '',
    nextDueDate: '',
    status: '停用',
    stopTag: true,
    stopReason: '存量回填，待历史检验报告核对',
    source: '存量回填',
    legacyId: item.id,
    inferred: true,
    note: `按投运年份 ${item.commissionYear} 回填；早年纸质档案，缺项按现行版别 ${basisLabel()} 推断`,
  }
  state.devices.push(device)
  m.deviceCursor += 1
  m.log.push(`阶段②：${item.commissionYear} 年投运的「${item.deviceName}」已建档（${device.id}），归属 ${unit.name}/${agency.name}`)
  state.logs.unshift({
    id: makeLogId(),
    at: todayIso(),
    accountId: account.id,
    accountName: account.name,
    action: '存量迁移-回填设备',
    target: item.deviceName,
    ok: true,
    reason: '按投运年份升序回填，纸质档案缺项打推断标记',
  })
  commit(state)
  return { ok: true, message: m.log[m.log.length - 1] }
}

/** 阶段③：按检验发生日期升序补报告；遇到取数中断条目即在该条停住。 */
export function migrateNextReport(): ActionResult {
  const state = loadState()
  const account = state.accounts.find((a) => a.id === currentAccountId)!
  const m = state.migration

  // 待补报告条目：有纸质报告号且设备已回填；按发生日期升序
  const pending = state.legacy
    .filter((l) => l.paperReportNo && l.paperInspectedAt)
    .sort((a, b) => (a.paperInspectedAt! < b.paperInspectedAt! ? -1 : 1))
    .slice(m.reportCursor)

  if (pending.length === 0) {
    return { ok: false, message: '历史检验报告已全部补录（无报告条目不补结论，只保留停用状态）' }
  }
  const item = pending[0]

  if (!item.fetched) {
    const reason = `取数中断：外委单位的钢丝绳/制动器磨损记录未交齐，迁移在「${item.deviceName}」（${item.id}）这一条停住；不用旧值顶替，补齐取数后从该条续走`
    m.log.push(`阶段③：${reason}`)
    state.logs.unshift({
      id: makeLogId(),
      at: todayIso(),
      accountId: account.id,
      accountName: account.name,
      action: '存量迁移-补录报告',
      target: item.deviceName,
      ok: false,
      reason,
    })
    commit(state)
    return { ok: false, message: reason }
  }

  const device = state.devices.find((d) => d.legacyId === item.id)
  if (!device) {
    return { ok: false, message: `「${item.deviceName}」设备尚未回填，请先完成阶段②` }
  }

  // 同一份报告编号（与在档或已迁移的其他条目撞号）只留一条：先发生的进档
  const reportNo = `PAPER-${item.paperReportNo}`
  const dup = state.records.find((r) => r.reportNo === reportNo)
  if (dup) {
    m.reportCursor += 1
    const reason = `报告编号 ${reportNo} 与 ${dup.deviceName}（检验日期 ${dup.inspectedAt}）重复，按报告编号去重，后发生的「${item.deviceName}」这份只记台账不进结论`
    m.log.push(`阶段③：${reason}`)
    state.logs.unshift({
      id: makeLogId(),
      at: todayIso(),
      accountId: account.id,
      accountName: account.name,
      action: '存量迁移-报告去重',
      target: item.deviceName,
      ok: false,
      reason,
    })
    commit(state)
    return { ok: false, message: reason }
  }

  const measured = item.measured
  const conclusion = measured ? judgeByMeasurement(measured) : '合格'
  const inferred = !measured || measured.wireRopeWearRate === 0 || measured.brakeClearance === 0
  const nextDue = computeNextDue(item.paperInspectedAt!, device.cycleMonths)
  const record: InspectionRecord = {
    id: `IR-${state.records.length + 1}-${Date.now().toString(36)}`,
    reportNo,
    deviceId: device.id,
    deviceName: device.name,
    inspectedAt: item.paperInspectedAt!,
    nextDue,
    agencyId: device.agencyId,
    agencyName: device.agencyName,
    inspectorAccountId: 'MIGRATION',
    inspectorName: '存量迁移（纸质归档）',
    conclusion,
    measured,
    basis: CURRENT_BASIS,
    hasMeasured: measured !== null,
    inferred,
    paperArchive: true,
    remark: measured
      ? `按检验发生日期 ${item.paperInspectedAt} 补录；实测值优先统一取值${inferred ? '；部分缺项按现行版别推断' : ''}；原件存档案柜待核`
      : '早年纸质报告，无磨损实测项，缺项按现行版别推断为合格取值；原件存档案柜待核',
    createdAt: todayIso(),
    immutable: true,
  }
  state.records.push(record)
  m.reportCursor += 1
  const verdict =
    measured && measurementOutOfLimit(measured).length
      ? `实测超限（${measurementOutOfLimit(measured).join('；')}），按实测判不合格，设备停用`
      : '结论合格'
  m.log.push(`阶段③：按发生日期 ${item.paperInspectedAt} 补录「${item.deviceName}」报告 ${reportNo}，${verdict}`)
  state.logs.unshift({
    id: makeLogId(),
    at: todayIso(),
    accountId: account.id,
    accountName: account.name,
    action: '存量迁移-补录报告',
    target: `${item.deviceName}/${reportNo}`,
    ok: true,
    reason: verdict,
  })
  commit(state)
  return { ok: true, message: m.log[m.log.length - 1] }
}

/** 阶段④⑤：全量到期扫描 + 汇总，一次完成。 */
export function migrateScanAndSummarize(): ActionResult {
  const state = loadState()
  const account = state.accounts.find((a) => a.id === currentAccountId)!
  const m = state.migration
  if (m.deviceCursor < state.legacy.length) {
    return { ok: false, message: '设备回填未完成，不能进入到期扫描阶段' }
  }
  const totalReports = state.legacy.filter((l) => l.paperReportNo).length
  if (m.reportCursor < totalReports) {
    return { ok: false, message: '历史报告补录未完成（可能有取数中断条目未续取），不能进入到期扫描阶段' }
  }
  const rec = reconcileAll(state.devices, state.records, state.warnings, state.todos, todayIso())
  state.devices = rec.devices
  state.warnings = rec.warnings
  state.todos = rec.todos
  m.scanned = true
  m.summarized = true
  m.done = true
  const noReport = state.legacy.filter((l) => !l.paperReportNo).length
  m.summary =
    `迁移完成：回填存量设备 ${state.legacy.length} 台（按投运年份升序），补录历史报告 ${m.reportCursor} 份（按发生日期升序、报告编号去重），` +
    `其中 ${noReport} 台早年无报告只建档不补结论、挂停用待首检；超期/不合格设备 ${state.devices.filter((d) => d.status === '停用').length} 台已挂停用牌；` +
    `预警 ${state.warnings.length} 条，闸门/水情两入口联动待办 ${state.todos.length} 条。报表数字均由明细实时汇总，保证一致。`
  m.log.push(`阶段④⑤：${m.summary}`)
  state.logs.unshift({
    id: makeLogId(),
    at: todayIso(),
    accountId: account.id,
    accountName: account.name,
    action: '存量迁移-扫描汇总',
    target: '全部存量数据',
    ok: true,
    reason: m.summary,
  })
  commit(state)
  return { ok: true, message: m.summary }
}

// ---------------------------------------------------------------------------
// 导出：报表与明细同一份数据源，逐行从明细汇总，不另存统计口径
// ---------------------------------------------------------------------------

export function exportDevicesCsv(): { filename: string; content: string } {
  const state = loadState()
  const header = [
    '设备编号', '设备名称', '设备类型', '使用单位(归属)', '检验机构(归属)', '闸门启闭对象',
    '投运年份', '定检周期(月)', '预警提前量(天)', '最近合格检验日', '下次到期日',
    '当前状态', '停用牌', '停用原因', '数据来源', '缺项推断', '备注',
  ]
  const lines = [header.join(',')]
  for (const d of state.devices) {
    lines.push(
      [
        d.id, d.name, d.kind, d.unitName, d.agencyName, d.gateRef,
        d.commissionYear, d.cycleMonths, d.leadDays, d.lastInspectionDate, d.nextDueDate,
        d.status, d.stopTag ? '已挂牌' : '未挂牌', d.stopReason, d.source,
        d.inferred ? '是(按现行版别推断)' : '否', d.note,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '起重设备定检台账.csv', content: `﻿${lines.join('\n')}` }
}

export function exportRecordsCsv(): { filename: string; content: string } {
  const state = loadState()
  const header = [
    '报告编号', '设备编号', '设备名称', '检验日期', '下次到期日', '检验机构', '检验人员',
    '结论', '钢丝绳磨损率实测(%)', '制动器间隙实测(mm)', '实测判定', '依据版别',
    '纸质归档', '缺项推断', '备注', '录入时间', '记录锁定',
  ]
  const lines = [header.join(',')]
  for (const r of [...state.records].sort((a, b) => (a.inspectedAt < b.inspectedAt ? -1 : 1))) {
    lines.push(
      [
        r.reportNo, r.deviceId, r.deviceName, r.inspectedAt, r.nextDue, r.agencyName, r.inspectorName,
        r.conclusion,
        r.measured ? String(r.measured.wireRopeWearRate) : '无实测',
        r.measured ? String(r.measured.brakeClearance) : '无实测',
        r.measured ? judgeByMeasurement(r.measured) : '按提交结论',
        r.basis, r.paperArchive ? '是' : '否', r.inferred ? '是' : '否',
        r.remark, r.createdAt, '已冻结不可改',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '起重设备检验结论明细.csv', content: `﻿${lines.join('\n')}` }
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(kind: 'devices' | 'records'): void {
  const { filename, content } = kind === 'devices' ? exportDevicesCsv() : exportRecordsCsv()
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

// ---------------------------------------------------------------------------
// 看板：数字全部从明细实时算，报表与明细始终一致
// ---------------------------------------------------------------------------

export function craneStats() {
  const state = loadState()
  const devices = state.devices
  const today = todayIso()
  return {
    total: devices.length,
    inUse: devices.filter((d) => d.status === '在用').length,
    warning: devices.filter((d) => d.status === '预警').length,
    stopped: devices.filter((d) => d.status === '停用').length,
    activeWarnings: state.warnings.filter((w) => w.state === '预警中').length,
    activeTodos: state.todos.filter((t) => t.state === '待办').length,
    records: state.records.length,
    daysToDue: (deviceId: string): number | null => {
      const d = devices.find((x) => x.id === deviceId)
      return d?.nextDueDate ? daysBetween(today, d.nextDueDate) : null
    },
  }
}

export function resetDemoData(): ActionResult {
  resetStore(new Date())
  syncGateBridge()
  return { ok: true, message: '起重设备台账演示数据已恢复到初始基线（设备/账号/存量原始清单重置，结论清空）' }
}

export function downloadCsvForTest(kind: 'devices' | 'records'): { filename: string; content: string } {
  return kind === 'devices' ? exportDevicesCsv() : exportRecordsCsv()
}

// 模块首次载入即同步一次桥接行，保证闸门入口先于台账打开时也能看到门机状态。
syncGateBridge()
