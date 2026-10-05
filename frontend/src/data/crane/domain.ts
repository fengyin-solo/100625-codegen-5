import {
  CURRENT_BASIS,
  DEFAULT_CYCLE_MONTHS,
  LIMIT_BRAKE_CLEARANCE,
  LIMIT_WIRE_ROPE_WEAR_RATE,
} from './constants'
import type {
  Conclusion,
  Device,
  DeviceStatus,
  InspectionRecord,
  LinkedTodo,
  Measurement,
  Warning,
} from './types'

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  const day = Math.min(d.getUTCDate(), daysInMonth(target.getUTCFullYear(), target.getUTCMonth()))
  target.setUTCDate(day)
  return target.toISOString().slice(0, 10)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime()
  const b = new Date(`${toIso}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86400000)
}

/**
 * 实测值优先：任一实测项超出现行限值即判不合格；两项都在限值内判合格。
 * 页面提交的主观结论与实测冲突时，统一按实测这一套取值。
 */
export function judgeByMeasurement(m: Measurement): Conclusion {
  return m.wireRopeWearRate > LIMIT_WIRE_ROPE_WEAR_RATE || m.brakeClearance > LIMIT_BRAKE_CLEARANCE
    ? '不合格'
    : '合格'
}

export function measurementOutOfLimit(m: Measurement): string[] {
  const reasons: string[] = []
  if (m.wireRopeWearRate > LIMIT_WIRE_ROPE_WEAR_RATE) {
    reasons.push(`钢丝绳直径磨损率实测 ${m.wireRopeWearRate}% 超过限值 ${LIMIT_WIRE_ROPE_WEAR_RATE}%`)
  }
  if (m.brakeClearance > LIMIT_BRAKE_CLEARANCE) {
    reasons.push(`制动器间隙实测 ${m.brakeClearance}mm 超过限值 ${LIMIT_BRAKE_CLEARANCE}mm`)
  }
  return reasons
}

/** 设备的有效检验记录：仅取「合格」，按检验日期倒序（历史结论全部保留，不做物理删除）。 */
export function latestQualifiedRecord(records: InspectionRecord[], deviceId: string): InspectionRecord | null {
  const list = records
    .filter((r) => r.deviceId === deviceId && r.conclusion === '合格')
    .sort((a, b) => (a.inspectedAt < b.inspectedAt ? 1 : -1))
  return list[0] ?? null
}

/** 设备是否曾被判定不合格（停用令依据；合格复检通过后解除）。 */
export function hasUnqualifiedOpen(records: InspectionRecord[], deviceId: string): boolean {
  const ordered = records
    .filter((r) => r.deviceId === deviceId)
    .sort((a, b) => (a.inspectedAt < b.inspectedAt ? -1 : 1))
  if (ordered.length === 0) {
    return false
  }
  return ordered[ordered.length - 1].conclusion === '不合格'
}

export type DeviceReconcile = {
  device: Device
  status: DeviceStatus
  stopTag: boolean
  stopReason: string
  lastInspectionDate: string
  nextDueDate: string
}

/**
 * 单台设备状态重算（纯函数）：
 * - 无合格报告 / 末次结论不合格 → 停用挂牌；
 * - 距到期 ≤ 提前量 → 预警（仍可用，但推送提醒）；
 * - 已超期 → 停用挂牌（定期检验超期未检）。
 */
export function reconcileDevice(device: Device, records: InspectionRecord[], today: string): DeviceReconcile {
  const latest = latestQualifiedRecord(records, device.id)
  if (hasUnqualifiedOpen(records, device.id)) {
    return {
      device,
      status: '停用',
      stopTag: true,
      stopReason: '末次检验结论为不合格，停用待整改复检',
      lastInspectionDate: latest?.inspectedAt ?? '',
      nextDueDate: latest?.nextDue ?? '',
    }
  }
  if (!latest) {
    return {
      device,
      status: '停用',
      stopTag: true,
      stopReason: '无有效（合格）定期检验记录，禁止投用',
      lastInspectionDate: '',
      nextDueDate: '',
    }
  }
  const gap = daysBetween(today, latest.nextDue)
  if (gap < 0) {
    return {
      device,
      status: '停用',
      stopTag: true,
      stopReason: `定期检验已超期 ${Math.abs(gap)} 天，超期未检自动挂停用牌`,
      lastInspectionDate: latest.inspectedAt,
      nextDueDate: latest.nextDue,
    }
  }
  if (gap <= device.leadDays) {
    return {
      device,
      status: '预警',
      stopTag: false,
      stopReason: '',
      lastInspectionDate: latest.inspectedAt,
      nextDueDate: latest.nextDue,
    }
  }
  return {
    device,
    status: '在用',
    stopTag: false,
    stopReason: '',
    lastInspectionDate: latest.inspectedAt,
    nextDueDate: latest.nextDue,
  }
}

function warningId(deviceId: string, dueDate: string): string {
  return `W-${deviceId}-${dueDate}`
}

function todoId(deviceId: string, target: string, dueDate: string): string {
  return `T-${target}-${deviceId}-${dueDate}`
}

export type ReconcileResult = {
  devices: Device[]
  warnings: Warning[]
  todos: LinkedTodo[]
  events: string[]
}

/**
 * 全量重算：设备状态、到期预警、闸门/水情两个入口的联动待办，一次对账同步生成。
 * 幂等——反复执行不产生重复预警与待办；预警被合格复检收回后只改状态不删记录。
 */
export function reconcileAll(
  devices: Device[],
  records: InspectionRecord[],
  warnings: Warning[],
  todos: LinkedTodo[],
  today: string,
  /** 本次对账前新归档的报告 id；只有新报告能把“预警中/已转停用”收回到已收回。 */
  newRecordIds: ReadonlySet<string> = new Set(),
): ReconcileResult {
  const events: string[] = []
  const nextDevices: Device[] = []
  let nextWarnings = warnings.map((w) => ({ ...w }))
  let nextTodos = todos.map((t) => ({ ...t }))

  for (const device of devices) {
    const r = reconcileDevice(device, records, today)
    nextDevices.push({
      ...device,
      status: r.status,
      stopTag: r.stopTag,
      stopReason: r.stopReason,
      lastInspectionDate: r.lastInspectionDate,
      nextDueDate: r.nextDueDate,
    })

    if (!r.nextDueDate) {
      // 无有效报告：不产生到期预警（停用令直接由待办表达）。
      continue
    }
    const wId = warningId(device.id, r.nextDueDate)
    const existing = nextWarnings.find((w) => w.id === wId)
    const latest = latestQualifiedRecord(records, device.id)
    const gotQualifiedToday = latest !== null && latest.nextDue === r.nextDueDate

    if (r.status === '预警') {
      if (!existing) {
        nextWarnings.push({
          id: wId,
          deviceId: device.id,
          deviceName: device.name,
          dueDate: r.nextDueDate,
          state: '预警中',
          issuedAt: today,
        })
        events.push(`${device.name}：到期前 ${device.leadDays} 天发出预警（应检日 ${r.nextDueDate}）`)
        nextTodos = upsertTodos(nextTodos, device, '预警提醒', r.nextDueDate, today)
      } else if (existing.state === '已收回') {
        // 同一检验周期内重算时维持收回结论，不复活预警。
      } else {
        nextTodos = upsertTodos(nextTodos, device, '预警提醒', r.nextDueDate, today)
      }
    }

    if (r.status === '停用' && r.stopReason.includes('超期')) {
      if (existing && existing.state === '预警中') {
        existing.state = '已转停用'
        events.push(`${device.name}：超期未检，原预警转为停用令`)
      } else if (!existing) {
        // 载入即超期（历史上没来得及发预警）也要直接挂停用令，不允许漏发待办。
        nextWarnings.push({
          id: wId,
          deviceId: device.id,
          deviceName: device.name,
          dueDate: r.nextDueDate,
          state: '已转停用',
          issuedAt: today,
        })
        events.push(`${device.name}：定期检验已超期，自动挂停用牌`)
      }
      // 预警待办解除，停用待办顶上来。
      nextTodos = resolveTodos(nextTodos, device.id, '预警提醒')
      nextTodos = upsertTodos(nextTodos, device, '停用指令', r.nextDueDate, today)
    }

    if (r.status === '停用' && r.stopReason.includes('不合格')) {
      const episodeId = latest?.nextDue ?? `unq-${today}`
      nextTodos = resolveTodos(nextTodos, device.id, '预警提醒')
      nextTodos = upsertTodos(nextTodos, device, '停用指令', episodeId, today)
    }

    // 合格复检、设备回到在用/预警：
    // 1) 新周期的预警若已提前发出（少见，同日重检场景），按新报告收回；
    // 2) 上一周期挂着的预警/转停用记录也要随合格复检收回——预警随检验完成而消除，
    //    只改状态保留记录，绝不删除原检验记录。
    // 关键限定：只有本次对账时新归档的报告才能收回，初始/日常对账不会误销存量预警。
    const recalledByNewReport = latest !== null && newRecordIds.has(latest.id)
    if (r.status !== '停用') {
      if (recalledByNewReport && existing && existing.state === '预警中') {
        existing.state = '已收回'
        existing.recalledAt = today
        existing.recordId = latest!.id
        existing.reportNo = latest!.reportNo
        existing.recallReason = `到期预警发出后已完成定检，报告编号 ${latest!.reportNo}（合格），预警收回；原检验记录保留`
        events.push(`${device.name}：检验已完成（${latest!.reportNo}），预警收回，历史结论保留`)
        nextTodos = resolveTodos(nextTodos, device.id, '预警提醒')
      }
      // 把该设备其它周期仍挂着的旧预警/停用令一并收回：
      // 须由本次新归档报告触发，且新报告的下次到期日晚于该预警周期。
      for (const w of nextWarnings) {
        if (
          w.deviceId === device.id &&
          w.id !== wId &&
          (w.state === '预警中' || w.state === '已转停用') &&
          recalledByNewReport &&
          latest!.nextDue > w.dueDate
        ) {
          const wasStopped = w.state === '已转停用'
          w.state = '已收回'
          w.recalledAt = today
          w.recordId = latest!.id
          w.reportNo = latest!.reportNo
          w.recallReason = `检验已完成（报告 ${latest!.reportNo}，合格），${wasStopped ? '停用令解除、' : ''}预警收回；历史检验记录保留`
          events.push(`${device.name}：上一周期预警/停用随合格复检收回（${latest!.reportNo}）`)
        }
      }
      nextTodos = resolveTodos(nextTodos, device.id, '预警提醒')
      nextTodos = resolveTodos(nextTodos, device.id, '停用指令')
    }
  }

  return { devices: nextDevices, warnings: nextWarnings, todos: nextTodos, events }
}

function upsertTodos(
  todos: LinkedTodo[],
  device: Device,
  kind: LinkedTodo['kind'],
  episodeId: string,
  today: string,
): LinkedTodo[] {
  const result = [...todos]
  for (const target of ['gate', 'hydrology'] as const) {
    const id = todoId(device.id, target, episodeId)
    const reason =
      kind === '预警提醒'
        ? `${device.name}（${device.kind}，闸门/启闭对象 ${device.gateRef}）定期检验 ${episodeId} 到期，到期预警中，提前安排检验`
        : `${device.name}（${device.kind}，闸门/启闭对象 ${device.gateRef}）当前不可用：${device.stopReason || '设备已挂停用牌'}`
    const title =
      kind === '预警提醒'
        ? `门机检验到期预警：${device.name}`
        : `门机停用，禁止启闭操作：${device.name}`
    const idx = result.findIndex((t) => t.id === id)
    if (idx >= 0) {
      if (result[idx].state === '待办') {
        result[idx] = { ...result[idx], title, reason }
      }
    } else {
      result.push({
        id,
        target,
        kind,
        deviceId: device.id,
        deviceName: device.name,
        gateRef: device.gateRef,
        title,
        reason,
        state: '待办',
        createdAt: today,
      })
    }
  }
  return result
}

function resolveTodos(todos: LinkedTodo[], deviceId: string, kind: LinkedTodo['kind']): LinkedTodo[] {
  return todos.map((t) =>
    t.deviceId === deviceId && t.kind === kind && t.state === '待办'
      ? { ...t, state: '已解除', resolvedAt: todayIso() }
      : t,
  )
}

/** 新报告的下次检验日期：缺省按现行版别 24 个月周期推算。 */
export function computeNextDue(inspectedAt: string, cycleMonths: number): string {
  return addMonths(inspectedAt, cycleMonths > 0 ? cycleMonths : DEFAULT_CYCLE_MONTHS)
}

export function basisLabel(): string {
  return CURRENT_BASIS
}
