import { ACCOUNTS, AGENCIES, LEGACY_RAW, seedDevices, seedRecords, UNITS } from './constants'
import { reconcileAll } from './domain'
import type { CraneState } from './types'

const STORAGE_KEY = 'hydropower-plant-om:crane-lifting:v1'
const STATE_VERSION = 1

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 初版基线：电子台账里的设备按“今天”相对排期，随后立即跑一次全量对账，
 * 让超期设备在首次载入时就自动挂停用牌、生成跨模块待办。
 */
export function freshState(today: Date): CraneState {
  const todayIso = today.toISOString().slice(0, 10)
  const state: CraneState = {
    version: STATE_VERSION,
    orgs: [...UNITS, ...AGENCIES],
    accounts: clone(ACCOUNTS),
    devices: seedDevices(today),
    records: seedRecords(today),
    warnings: [],
    todos: [],
    logs: [],
    legacy: clone(LEGACY_RAW),
    migration: {
      done: false,
      deviceCursor: 0,
      reportCursor: 0,
      scanned: false,
      summarized: false,
      summary: '',
      log: [],
    },
  }
  const r = reconcileAll(state.devices, state.records, state.warnings, state.todos, todayIso)
  state.devices = r.devices
  state.warnings = r.warnings
  state.todos = r.todos
  state.logs.push({
    id: makeLogId(),
    at: todayIso,
    accountId: 'SYSTEM',
    accountName: '系统',
    action: '初始对账',
    target: '全部起重设备',
    ok: true,
    reason: r.events.length ? r.events.join('；') : '无到期/超期变化',
  })
  return state
}

let cache: CraneState | null = null

export function loadState(): CraneState {
  if (cache) {
    return cache
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        cache = JSON.parse(raw) as CraneState
        return cache
      } catch {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    }
  }
  cache = freshState(new Date())
  persist()
  return cache
}

export function persist(): void {
  if (!cache) {
    return
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
}

export function saveState(state: CraneState): CraneState {
  cache = state
  persist()
  return state
}

/** 演示数据重置：恢复设备/账号/存量原始清单，清空结论、预警、待办、迁移进度。 */
export function resetState(today: Date = new Date()): CraneState {
  cache = freshState(today)
  persist()
  return cache
}

let logSeq = 0
export function makeLogId(): string {
  logSeq += 1
  const rand = Math.random().toString(36).slice(2, 8)
  return `LOG-${Date.now().toString(36)}-${logSeq}-${rand}`
}

export function storageKeyName(): string {
  return STORAGE_KEY
}
