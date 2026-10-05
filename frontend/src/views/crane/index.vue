<template>
  <section class="page" data-module="crane">
    <header class="page-head">
      <div>
        <h2>起重设备定期检验台账（坝顶门机 / 尾水门机）</h2>
        <p class="page-desc">
          每台设备登记使用单位与检验机构；仅持有效定检资质的归属机构可录入结论，本单位与外来账号只读。
          到期前 {{ DEFAULT_LEAD_DAYS }} 天预警、超期自动停用，结论回写闸门启闭与水情调度两个入口。
        </p>
      </div>
      <div class="page-actions account-bar">
        <label class="account-switch">
          <span>当前身份</span>
          <select :value="account.id" @change="onSwitchAccount(($event.target as HTMLSelectElement).value)">
            <option v-for="a in accounts" :key="a.id" :value="a.id">
              {{ a.name }}｜{{ a.role }}{{ a.qualified ? '｜有资质' : '｜无资质' }}
            </option>
          </select>
        </label>
        <button class="btn" type="button" @click="onScan">立即跑到期扫描</button>
        <button class="btn ghost" type="button" @click="onReset">恢复演示基线</button>
      </div>
    </header>

    <p class="identity-line" :class="canWrite ? 'can-write' : 'read-only'">
      {{ account.orgName }}（{{ account.role }}）·
      检验资质：{{ account.qualified ? '有效' : '无/失效' }} ·
      授权范围：{{ account.scopeUnitIds.length ? scopeText : '无' }} ·
      <strong>{{ canWrite ? '可对授权范围内设备录入检验结论' : '只有查看权限，不得录入/修改结论' }}</strong>
    </p>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">设备总数</span><strong class="stat-value">{{ stats.total }}</strong></article>
      <article class="stat-card"><span class="stat-label">在用</span><strong class="stat-value">{{ stats.inUse }}</strong></article>
      <article class="stat-card"><span class="stat-label">到期预警</span><strong class="stat-value warn">{{ stats.warning }}</strong></article>
      <article class="stat-card"><span class="stat-label">停用挂牌</span><strong class="stat-value stop">{{ stats.stopped }}</strong></article>
      <article class="stat-card"><span class="stat-label">跨模块待办</span><strong class="stat-value">{{ stats.activeTodos }}</strong></article>
      <article class="stat-card"><span class="stat-label">检验报告(冻结)</span><strong class="stat-value">{{ stats.records }}</strong></article>
    </div>

    <nav class="tab-bar">
      <button v-for="t in tabs" :key="t.key" class="tab" :class="{ active: tab === t.key }" type="button" @click="tab = t.key">
        {{ t.label }}
      </button>
    </nav>

    <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'" class="page-message">{{ message }}</p>

    <!-- 设备台账 -->
    <div v-if="tab === 'devices'">
      <div class="section-actions">
        <button class="btn primary" type="button" @click="showRegister = !showRegister">
          {{ showRegister ? '收起登记表' : '登记新设备' }}
        </button>
        <button class="btn" type="button" @click="downloadCsv('devices')">导出台账（与明细同口径）</button>
      </div>

      <form v-if="showRegister" class="editor-card" @submit.prevent="onRegister">
        <h4>设备建档：归属必填（使用单位 + 检验机构 + 闸门启闭对象）</h4>
        <div class="form-grid">
          <label><span>设备名称</span><input v-model="regForm.name" placeholder="如：坝顶门机3号" /></label>
          <label><span>设备类型</span><input v-model="regForm.kind" placeholder="坝顶门式启闭机" /></label>
          <label>
            <span>使用单位（归属）</span>
            <select v-model="regForm.unitId">
              <option v-for="u in units" :key="u.id" :value="u.id">{{ u.name }}</option>
            </select>
          </label>
          <label>
            <span>检验机构（归属）</span>
            <select v-model="regForm.agencyId">
              <option v-for="a in agencies" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <label><span>闸门启闭对象编号</span><input v-model="regForm.gateRef" placeholder="如 GM-DB-03" /></label>
          <label><span>投运年份</span><input v-model.number="regForm.commissionYear" type="number" min="1990" :max="yearNow" /></label>
          <label><span>定检周期(月，缺省24)</span><input v-model.number="regForm.cycleMonths" type="number" min="1" /></label>
          <label><span>预警提前量(天，缺省30)</span><input v-model.number="regForm.leadDays" type="number" min="1" /></label>
        </div>
        <label class="full-note"><span>备注</span><input v-model="regForm.note" /></label>
        <button class="btn primary" type="submit">提交建档（首检合格前自动停用）</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>设备编号</th><th>名称/类型</th><th>使用单位</th><th>检验机构</th><th>启闭对象</th>
            <th>投运年份</th><th>最近合格检验</th><th>下次到期</th><th>距到期</th><th>状态</th><th>来源/推断</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in devices" :key="d.id" :class="{ 'row-stop': d.stopTag, 'row-warn': d.status === '预警' }">
            <td>{{ d.id }}</td>
            <td>{{ d.name }}<br /><span class="muted">{{ d.kind }}</span></td>
            <td>{{ d.unitName }}</td>
            <td>{{ d.agencyName }}</td>
            <td>{{ d.gateRef }}</td>
            <td>{{ d.commissionYear }}</td>
            <td>{{ d.lastInspectionDate || '—' }}</td>
            <td>{{ d.nextDueDate || '—' }}</td>
            <td>
              <span v-if="daysToDue(d.id) !== null" :class="daysClass(d.id)">
                {{ (daysToDue(d.id) as number) < 0 ? `超期 ${Math.abs(daysToDue(d.id) as number)} 天` : `${daysToDue(d.id)} 天` }}
              </span>
              <span v-else>—</span>
            </td>
            <td>
              <span class="status-pill" :class="pillClass(d.status)">{{ d.status }}</span>
              <div v-if="d.stopTag" class="stop-reason">🛑 {{ d.stopReason }}</div>
            </td>
            <td>
              {{ d.source }}
              <span v-if="d.inferred" class="infer-tag">缺项按现行版别推断</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 检验结论录入 -->
    <div v-if="tab === 'submit'">
      <form class="editor-card" @submit.prevent="onSubmit">
        <h4>检验结论录入（服务层鉴权；无资质/跨单位/跨机构提交一律挡回并记日志）</h4>
        <div class="form-grid">
          <label>
            <span>检验设备</span>
            <select v-model="form.deviceId">
              <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.id }}｜{{ d.name }}（{{ d.unitName }} / {{ d.agencyName }}）</option>
            </select>
          </label>
          <label><span>报告编号（全局唯一，重复上传只留一条）</span><input v-model="form.reportNo" placeholder="如 BG-2026-1008" /></label>
          <label><span>检验日期</span><input v-model="form.inspectedAt" type="date" :max="today" /></label>
          <label>
            <span>页面结论（有实测时仅作参考，实测优先）</span>
            <select v-model="form.conclusion">
              <option value="">由实测自动判定</option>
              <option value="合格">合格</option>
              <option value="不合格">不合格</option>
            </select>
          </label>
          <label>
            <span>钢丝绳直径磨损率实测 %（限值 &gt;{{ LIMIT_WIRE_ROPE_WEAR_RATE }}）</span>
            <input v-model="form.wireRopeWearRate" inputmode="decimal" placeholder="实测值，缺测留空" />
          </label>
          <label>
            <span>制动器间隙实测 mm（限值 &gt;{{ LIMIT_BRAKE_CLEARANCE }}）</span>
            <input v-model="form.brakeClearance" inputmode="decimal" placeholder="实测值，缺测留空" />
          </label>
        </div>
        <div class="form-grid">
          <label class="check-line"><input v-model="form.paperArchive" type="checkbox" /> 纸质报告电子补录（无实测项，缺项按现行版别推断）</label>
          <label class="check-line"><input v-model="form.inferred" type="checkbox" /> 该项含缺项，按现行版别（TSG Q7015-2016）推断</label>
        </div>
        <label class="full-note"><span>备注</span><input v-model="form.remark" /></label>
        <p v-if="selectedDevice" class="hint" :class="canWriteForSelected ? 'ok-text' : 'error-text'">
          当前账号对「{{ selectedDevice.name }}」：{{ canWriteForSelected ? '有权录入（归属与资质均匹配）' : '无权录入——提交会被服务层挡回，可点下面按钮验证拦截理由' }}
        </p>
        <div class="section-actions">
          <button class="btn primary" type="submit">提交检验结论（只追加，不覆盖历史）</button>
          <button class="btn" type="button" @click="onForceUnauthorized">模拟越权提交验证</button>
          <button class="btn" type="button" @click="downloadCsv('records')">导出结论明细</button>
        </div>
      </form>

      <h4>检验报告（按检验日期排序；全部冻结，任何账号不可改）</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>报告编号</th><th>设备</th><th>检验日期</th><th>机构/人员</th><th>结论</th>
            <th>钢丝绳实测</th><th>制动器实测</th><th>实测判定</th><th>纸质</th><th>推断</th><th>依据</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id" :class="{ 'row-stop': r.conclusion === '不合格' }">
            <td>{{ r.reportNo }}</td>
            <td>{{ r.deviceName }}</td>
            <td>{{ r.inspectedAt }}<br /><span class="muted">下次 {{ r.nextDue }}</span></td>
            <td>{{ r.agencyName }}<br /><span class="muted">{{ r.inspectorName }}</span></td>
            <td><span class="status-pill" :class="r.conclusion === '合格' ? 'pill-ok' : 'pill-stop'">{{ r.conclusion }}</span></td>
            <td :class="r.measured && r.measured.wireRopeWearRate > LIMIT_WIRE_ROPE_WEAR_RATE ? 'error-text' : ''">
              {{ r.measured ? `${r.measured.wireRopeWearRate}%` : '无实测' }}
            </td>
            <td :class="r.measured && r.measured.brakeClearance > LIMIT_BRAKE_CLEARANCE ? 'error-text' : ''">
              {{ r.measured ? `${r.measured.brakeClearance}mm` : '无实测' }}
            </td>
            <td>{{ r.measured ? judged(r.measured) : '按提交结论' }}</td>
            <td>{{ r.paperArchive ? '纸质归档' : '电子' }}</td>
            <td>{{ r.inferred ? '推断' : '实测' }}</td>
            <td class="muted">{{ r.basis.split(' ')[0] }}</td>
          </tr>
          <tr v-if="!records.length"><td colspan="11" class="empty-state">暂无检验报告</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 预警 -->
    <div v-if="tab === 'warnings'">
      <h4>到期预警（提前量 {{ DEFAULT_LEAD_DAYS }} 天；检验完成后收回，原记录保留）</h4>
      <table class="data-table">
        <thead><tr><th>设备</th><th>应检到期日</th><th>发出时间</th><th>状态</th><th>收回/转停用说明</th></tr></thead>
        <tbody>
          <tr v-for="w in warnings" :key="w.id">
            <td>{{ w.deviceName }}</td>
            <td>{{ w.dueDate }}</td>
            <td>{{ w.issuedAt }}</td>
            <td><span class="status-pill" :class="w.state === '预警中' ? 'pill-warn' : w.state === '已收回' ? 'pill-ok' : 'pill-stop'">{{ w.state }}</span></td>
            <td class="muted">{{ w.recallReason || (w.state === '已转停用' ? '超期未检，自动转停用令并下发两个入口' : '—') }}</td>
          </tr>
          <tr v-if="!warnings.length"><td colspan="5" class="empty-state">暂无预警</td></tr>
        </tbody>
      </table>

      <h4>跨模块联动待办（闸门启闭 + 水情记录同步）</h4>
      <table class="data-table">
        <thead><tr><th>推送入口</th><th>类型</th><th>设备/启闭对象</th><th>待办内容</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="t in allTodos" :key="t.id">
            <td>{{ t.target === 'gate' ? '闸门启闭' : '水情调度' }}</td>
            <td><span class="todo-tag" :class="t.kind === '停用指令' ? 'tag-stop' : 'tag-warn'">{{ t.kind }}</span></td>
            <td>{{ t.deviceName }}（{{ t.gateRef }}）</td>
            <td>{{ t.title }}</td>
            <td :class="t.state === '待办' ? 'error-text' : 'muted'">{{ t.state }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 存量迁移 -->
    <div v-if="tab === 'migration'">
      <div class="migration-plan">
        <h4>迁移顺序（游标持久化，中断从断条续走，不用旧值顶替）</h4>
        <ol>
          <li :class="{ done: true }">① 基础主体：使用单位、检验机构、账号与资质（已建）</li>
          <li :class="{ done: migration.deviceCursor > 0, active: migration.deviceCursor < legacy.length }">
            ② 设备回填：按投运年份升序（{{ migration.deviceCursor }}/{{ legacy.length }}）
          </li>
          <li :class="{ done: migration.reportCursor > 0, active: migration.deviceCursor >= legacy.length && migration.reportCursor < legacyWithReports }">
            ③ 历史报告：按检验发生日期升序补录，报告编号去重（{{ migration.reportCursor }}/{{ legacyWithReports }}）
          </li>
          <li :class="{ active: migration.scanned }">④ 全量到期扫描：预警/停用牌/两个入口待办</li>
          <li :class="{ active: migration.summarized }">⑤ 汇总（报表与明细同口径实时统计）</li>
        </ol>
        <div class="section-actions">
          <button class="btn primary" type="button" :disabled="migration.done" @click="onMigrateDevice">回填下一台设备</button>
          <button class="btn primary" type="button" :disabled="migration.done" @click="onMigrateReport">补录下一份报告</button>
          <button class="btn" type="button" :disabled="migration.done" @click="onMigrateFinish">执行扫描并汇总</button>
          <button class="btn ghost" type="button" @click="onAutoRun">一键按顺序跑到完成</button>
        </div>
      </div>

      <h4>存量原始清单（档案柜/外委单位交来的家底）</h4>
      <table class="data-table">
        <thead>
          <tr><th>条目</th><th>设备</th><th>投运年份</th><th>纸质报告号</th><th>检验日期</th><th>磨损取数</th><th>续取操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="l in legacySorted" :key="l.id" :class="{ 'row-stop': !l.fetched }">
            <td>{{ l.id }}</td>
            <td>{{ l.deviceName }}<br /><span class="muted">{{ l.gateRef }}</span></td>
            <td>{{ l.commissionYear }}</td>
            <td>{{ l.paperReportNo ? `PAPER-${l.paperReportNo}` : '无报告（只建档，挂停用待首检）' }}</td>
            <td>{{ l.paperInspectedAt || '—' }}</td>
            <td>
              <template v-if="l.measured">钢丝绳 {{ l.measured.wireRopeWearRate }}% / 闸瓦 {{ l.measured.brakeClearance }}mm</template>
              <span v-else-if="l.fetched" class="muted">纸质无实测，缺项按现行版别推断</span>
              <strong v-else class="error-text">取数中断，在本条停住</strong>
            </td>
            <td>
              <div v-if="!l.fetched" class="refetch-row">
                <input v-model="refetch.wire" placeholder="钢丝绳%" />
                <input v-model="refetch.brake" placeholder="闸瓦mm" />
                <button class="btn" type="button" @click="onResumeFetch(l.id)">从断条续取</button>
              </div>
              <span v-else class="muted">已齐</span>
            </td>
          </tr>
        </tbody>
      </table>

      <h4>迁移日志</h4>
      <ul class="migration-log">
        <li v-for="(line, i) in migration.log" :key="i">{{ line }}</li>
        <li v-if="!migration.log.length" class="muted">尚未开始</li>
      </ul>
      <p v-if="migration.summary" class="ok-text summary-box">{{ migration.summary }}</p>
    </div>

    <!-- 权限日志 -->
    <div v-if="tab === 'logs'">
      <h4>权限与归属操作日志（越权提交直接拦下并写明理由）</h4>
      <table class="data-table">
        <thead><tr><th>时间</th><th>账号/单位</th><th>动作</th><th>对象</th><th>结果</th><th>理由</th></tr></thead>
        <tbody>
          <tr v-for="l in logs" :key="l.id" :class="{ 'row-stop': !l.ok }">
            <td>{{ l.at }}</td>
            <td>{{ l.accountName }}</td>
            <td>{{ l.action }}</td>
            <td>{{ l.target }}</td>
            <td :class="l.ok ? 'ok-text' : 'error-text'">{{ l.ok ? '放行/成功' : '拦截' }}</td>
            <td>{{ l.reason }}</td>
          </tr>
          <tr v-if="!logs.length"><td colspan="6" class="empty-state">暂无日志</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  activeTodos,
  craneStats,
  currentAccount,
  legacyItems,
  listAccounts,
  listDevices,
  listLogs,
  listOrgs,
  listRecords,
  listWarnings,
  migrateNextDevice,
  migrateNextReport,
  migrateScanAndSummarize,
  migrationState,
  registerDevice,
  resetDemoData,
  resumeFetch,
  runDueScan,
  submitInspection,
  switchAccount,
  downloadCsv as downloadCsvFile,
} from '@/api/crane-service'
import { judgeByMeasurement } from '@/data/crane/domain'
import {
  DEFAULT_LEAD_DAYS,
  LIMIT_BRAKE_CLEARANCE,
  LIMIT_WIRE_ROPE_WEAR_RATE,
} from '@/data/crane/constants'
import type {
  Account,
  CraneState,
  Device,
  InspectionRecord,
  LinkedTodo,
  Measurement,
  MigrationProgress,
  Warning,
} from '@/data/crane/types'

type TabKey = 'devices' | 'submit' | 'warnings' | 'migration' | 'logs'
const tabs: { key: TabKey; label: string }[] = [
  { key: 'devices', label: '设备台账（归属）' },
  { key: 'submit', label: '检验结论录入' },
  { key: 'warnings', label: '预警与联动待办' },
  { key: 'migration', label: '存量回填迁移' },
  { key: 'logs', label: '权限日志' },
]
const tab = ref<TabKey>('devices')

const accounts = ref<Account[]>([])
const devices = ref<Device[]>([])
const records = ref<InspectionRecord[]>([])
const warnings = ref<Warning[]>([])
const allTodos = ref<LinkedTodo[]>([])
const logs = ref<CraneState['logs']>([])
const legacy = ref<CraneState['legacy']>([])
const migration = ref<MigrationProgress>({
  done: false, deviceCursor: 0, reportCursor: 0, scanned: false, summarized: false, summary: '', log: [],
})
const account = ref<Account>(currentAccount())
const orgs = ref<CraneState['orgs']>([])
const units = computed(() => orgs.value.filter((o) => o.kind === '使用单位'))
const agencies = computed(() => orgs.value.filter((o) => o.kind === '检验机构'))

const message = ref('')
const messageOk = ref(true)
const showRegister = ref(false)
const today = new Date().toISOString().slice(0, 10)
const yearNow = Number(today.slice(0, 4))

const stats = ref(craneStats())

const form = reactive({
  deviceId: '',
  reportNo: '',
  inspectedAt: today,
  paperArchive: false,
  wireRopeWearRate: '',
  brakeClearance: '',
  conclusion: '' as '' | '合格' | '不合格',
  inferred: false,
  remark: '',
})

const regForm = reactive({
  name: '', kind: '坝顶门式启闭机', unitId: 'U-DBA', agencyId: 'A-PSEI',
  gateRef: '', commissionYear: yearNow, cycleMonths: 24, leadDays: 30, note: '',
})

const refetch = reactive({ wire: '', brake: '' })

const scopeText = computed(() =>
  units.value.filter((u) => account.value.scopeUnitIds.includes(u.id)).map((u) => u.name).join('、'),
)
const canWrite = computed(() => account.value.role === '检验机构' && account.value.qualified)
const selectedDevice = computed(() => devices.value.find((d) => d.id === form.deviceId) ?? null)
const canWriteForSelected = computed(() => {
  const d = selectedDevice.value
  if (!d) return false
  return canWrite.value && account.value.orgId === d.agencyId && account.value.scopeUnitIds.includes(d.unitId)
})
const legacySorted = computed(() => [...legacy.value].sort((a, b) => a.commissionYear - b.commissionYear))
const legacyWithReports = computed(() => legacy.value.filter((l) => l.paperReportNo).length)

function reload() {
  accounts.value = listAccounts()
  orgs.value = listOrgs()
  devices.value = listDevices()
  records.value = listRecords()
  warnings.value = listWarnings()
  allTodos.value = activeTodos()
  logs.value = listLogs()
  legacy.value = legacyItems()
  migration.value = migrationState()
  account.value = currentAccount()
  stats.value = craneStats()
  if (!form.deviceId && devices.value[0]) {
    form.deviceId = devices.value[0].id
  }
}

function flash(result: { ok: boolean; message: string }) {
  message.value = result.message
  messageOk.value = result.ok
}

function onSwitchAccount(id: string) {
  flash(switchAccount(id))
  reload()
}

function onScan() {
  flash(runDueScan())
  reload()
}

function onReset() {
  flash(resetDemoData())
  reload()
}

function onSubmit() {
  flash(submitInspection({ ...form }))
  Object.assign(form, { reportNo: '', wireRopeWearRate: '', brakeClearance: '', conclusion: '', paperArchive: false, inferred: false, remark: '' })
  reload()
}

/** 演示越权：保持页面身份不变直接提交，由服务层给出逐档拦截理由。 */
function onForceUnauthorized() {
  flash(submitInspection({ ...form }))
  reload()
}

function onRegister() {
  flash(registerDevice({ ...regForm }))
  if (messageOk.value) {
    Object.assign(regForm, { name: '', gateRef: '', note: '' })
    showRegister.value = false
  }
  reload()
}

function onMigrateDevice() {
  flash(migrateNextDevice())
  reload()
}

function onMigrateReport() {
  flash(migrateNextReport())
  reload()
}

function onMigrateFinish() {
  flash(migrateScanAndSummarize())
  reload()
}

/** 按既定顺序自动推进；遇取数中断即停住（返回失败），不跳条、不拿旧值顶替。 */
function onAutoRun() {
  const guard = { done: false }
  const steps = [
    () => migrateNextDevice(),
    () => migrateNextReport(),
  ]
  let guardCount = 0
  while (!guard.done && guardCount < 50) {
    guardCount += 1
    const m = migrationState()
    if (m.deviceCursor < legacyItems().length) {
      const r = migrateNextDevice()
      if (!r.ok) { flash(r); break }
      continue
    }
    const totalReports = legacyItems().filter((l) => l.paperReportNo).length
    if (m.reportCursor < totalReports) {
      const r = migrateNextReport()
      if (!r.ok) { flash(r); break } // 断点停在这里
      continue
    }
    flash(migrateScanAndSummarize())
    guard.done = true
  }
  reload()
}

function onResumeFetch(id: string) {
  flash(resumeFetch(id, { wire: refetch.wire, brake: refetch.brake }))
  refetch.wire = ''
  refetch.brake = ''
  reload()
}

function daysToDue(id: string): number | null {
  return stats.value.daysToDue(id)
}
function daysClass(id: string): string {
  const n = daysToDue(id)
  if (n === null) return 'muted'
  if (n < 0) return 'error-text'
  if (n <= DEFAULT_LEAD_DAYS) return 'warn-text'
  return 'ok-text'
}
function pillClass(s: Device['status']): string {
  return s === '在用' ? 'pill-ok' : s === '预警' ? 'pill-warn' : 'pill-stop'
}
function judged(m: Measurement): string {
  return judgeByMeasurement(m)
}

function downloadCsv(kind: 'devices' | 'records') {
  downloadCsvFile(kind)
}

onMounted(reload)
</script>

<style scoped>
.account-bar { gap: 8px; align-items: center; }
.account-switch span { display: block; font-size: 11px; color: var(--muted); }
.account-switch select { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.identity-line { font-size: 12px; padding: 6px 10px; border-radius: 6px; margin: 0 0 12px; }
.identity-line.can-write { background: #ecfdf3; color: #067647; }
.identity-line.read-only { background: #f2f4f7; color: #475467; }
.warn { color: #b54708; }
.stop { color: #b42318; }
.tab-bar { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.tab { border: none; background: none; padding: 8px 14px; cursor: pointer; font-size: 13px; color: var(--muted); border-bottom: 2px solid transparent; }
.tab.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }
.page-message { font-size: 13px; padding: 8px 10px; border-radius: 6px; background: #fff; border: 1px solid var(--border); }
.ok-text { color: #067647; }
.warn-text { color: #b54708; }
.section-actions { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
.editor-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
.editor-card h4 { margin: 0 0 10px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.form-grid label span, .full-note span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid input, .form-grid select, .full-note input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.full-note { display: block; margin: 10px 0; }
.check-line { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.hint { font-size: 12px; }
.muted { color: var(--muted); font-size: 12px; }
.row-stop { background: #fff5f4; }
.row-warn { background: #fffdf5; }
.status-pill { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.pill-ok { background: #ecfdf3; color: #067647; }
.pill-warn { background: #fef0c3; color: #b54708; }
.pill-stop { background: #fee4e2; color: #b42318; }
.stop-reason { font-size: 11px; color: #b42318; margin-top: 2px; }
.infer-tag, .todo-tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 11px; margin-left: 4px; }
.infer-tag { background: #eef2f7; color: #475467; }
.tag-stop { background: #fee4e2; color: #b42318; }
.tag-warn { background: #fef0c3; color: #b54708; }
.migration-plan { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
.migration-plan ol { margin: 8px 0; padding-left: 20px; font-size: 13px; }
.migration-plan li { margin: 4px 0; color: var(--muted); }
.migration-plan li.done { color: #067647; }
.migration-plan li.active { color: #1f2937; font-weight: 600; }
.refetch-row { display: flex; gap: 4px; }
.refetch-row input { width: 90px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; }
.migration-log { font-size: 12px; color: #344054; background: #f8fafc; border: 1px solid var(--border); border-radius: 6px; padding: 8px 24px; }
.summary-box { background: #ecfdf3; border-radius: 6px; padding: 8px 10px; }
</style>
