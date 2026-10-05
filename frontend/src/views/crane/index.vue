<template>
  <section class="page" data-module="crane">
    <header class="page-head">
      <div>
        <h2>起重设备定期检验台账</h2>
        <p class="page-desc">
          坝顶门机、尾水门机等起重设备：每台登记使用单位与检验机构，检验结论只能由取得资质的归属检验机构录入；
          到期按提前量预警，超期自动挂停用牌，并回写闸门启闭与水情调度的操作待办。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showDeviceForm = !showDeviceForm">登记设备</button>
        <button class="btn" type="button" @click="runMigration">执行存量迁移</button>
        <button class="btn" type="button" @click="exportLedger">导出检验台账</button>
      </div>
    </header>

    <div class="banner">
      当前账号：{{ session.account.name }}（{{ session.account.roleLabel }}，归属：{{ session.account.org }}）—— {{ permission.note }}
    </div>
    <p v-if="feedback" class="feedback" :class="feedbackOk ? 'ok-text' : 'error-text'">{{ feedback }}</p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td><span class="badge" :class="statusClass(String(row.status))">{{ row.status }}</span></td>
          <td class="row-actions">
            <button class="link" type="button" @click="prepareReport(row)">录入结论</button>
            <button class="link" type="button" @click="showReports(row)">查看报告</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无起重设备数据，可先登记设备</td>
        </tr>
      </tbody>
    </table>

    <div v-if="showDeviceForm" class="panel">
      <h3>登记设备（仅本单位账号可登记，归属逐笔标清）</h3>
      <form class="form-grid" @submit.prevent="submitDevice">
        <label><span>设备编号</span><input v-model="deviceForm.设备编号" placeholder="如 CRANE-0007" /></label>
        <label><span>设备名称</span><input v-model="deviceForm.设备名称" placeholder="如 尾水门机#3" /></label>
        <label>
          <span>设备类型</span>
          <select v-model="deviceForm.设备类型">
            <option>门式起重机</option>
            <option>桥式起重机</option>
          </select>
        </label>
        <label><span>使用单位</span><input v-model="deviceForm.使用单位" /></label>
        <label>
          <span>检验机构</span>
          <select v-model="deviceForm.检验机构">
            <option v-for="agency in agencies" :key="String(agency.id)" :value="String(agency.机构名称)">
              {{ agency.机构名称 }}
            </option>
          </select>
        </label>
        <label><span>投运年份</span><input v-model="deviceForm.投运年份" placeholder="如 2024" /></label>
        <button class="btn primary" type="submit">提交登记</button>
      </form>
      <p class="muted">检验周期缺项按现行版别取 {{ cycleMonths }} 个月；无检验日期的存量设备按投运年份回填下次检验日期。</p>
    </div>

    <div class="panel">
      <h3>检验机构资质（只有资质在有效期内的机构才能录入结论）</h3>
      <table class="data-table">
        <thead>
          <tr><th>机构名称</th><th>资质证书号</th><th>资质有效期至</th><th>资质状态</th><th>归属说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="agency in agencies" :key="String(agency.id)">
            <td>{{ agency.机构名称 }}</td>
            <td>{{ agency.资质证书号 }}</td>
            <td>{{ agency.资质有效期至 }}</td>
            <td>
              <span class="badge" :class="agencyStatusOf(agency) === '有效' ? 'ok' : 'stop'">
                {{ agencyStatusOf(agency) }}
              </span>
            </td>
            <td>{{ agency.归属说明 }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h3>录入检验结论（限归属检验机构，越权提交一律拦下）</h3>
      <form class="form-grid" @submit.prevent="submitReport">
        <label>
          <span>设备编号</span>
          <select v-model="reportForm.设备编号">
            <option v-for="device in allDevices" :key="String(device.id)" :value="String(device.设备编号)">
              {{ device.设备编号 }} {{ device.设备名称 }}（归属：{{ device.检验机构 }}）
            </option>
          </select>
        </label>
        <label><span>报告编号</span><input v-model="reportForm.报告编号" placeholder="如 QJ-2026-1005" /></label>
        <label><span>检验日期</span><input v-model="reportForm.检验日期" type="date" /></label>
        <label>
          <span>申报结论</span>
          <select v-model="reportForm.申报结论">
            <option>合格</option>
            <option>不合格</option>
          </select>
        </label>
        <label><span>钢丝绳直径减小率实测(%)</span><input v-model="reportForm.钢丝绳实测" placeholder="限值 ≤ 7" /></label>
        <label><span>制动衬垫磨损率实测(%)</span><input v-model="reportForm.制动器实测" placeholder="限值 ≤ 50" /></label>
        <label>
          <span>资料来源</span>
          <select v-model="reportForm.资料来源">
            <option>电子报告</option>
            <option>纸质补录</option>
          </select>
        </label>
        <button class="btn primary" type="submit">提交检验结论</button>
      </form>
      <p class="muted">
        限值口径：钢丝绳直径减小率 ≤ {{ wireLimit }}%，制动衬垫磨损率 ≤ {{ brakeLimit }}%；
        申报结论与实测值冲突时按实测统一取值。同一份报告按报告编号去重，只留一条。
      </p>
    </div>

    <div class="panel">
      <h3>
        检验报告（只增不改，历史结论不覆盖）
        <button v-if="reportFilter" class="link" type="button" @click="reportFilter = ''">
          清除设备筛选：{{ reportFilter }}
        </button>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>报告编号</th><th>设备编号</th><th>设备名称</th><th>检验机构</th><th>检验日期</th>
            <th>申报结论</th><th>认定结论</th><th>钢丝绳实测/限值(%)</th><th>制动器实测/限值(%)</th>
            <th>资料来源</th><th>录入人</th><th>归属标记</th><th>取值说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="report in reports" :key="String(report.id)">
            <td>{{ report.报告编号 }}</td>
            <td>{{ report.设备编号 }}</td>
            <td>{{ report.设备名称 }}</td>
            <td>{{ report.检验机构 }}</td>
            <td>{{ report.检验日期 }}</td>
            <td>{{ report.申报结论 }}</td>
            <td>
              <span class="badge" :class="report.认定结论 === '合格' ? 'ok' : 'stop'">{{ report.认定结论 }}</span>
            </td>
            <td>{{ report['钢丝绳实测(%)'] }} / {{ report['钢丝绳限值(%)'] }}</td>
            <td>{{ report['制动器实测(%)'] }} / {{ report['制动器限值(%)'] }}</td>
            <td>{{ report.资料来源 }}</td>
            <td>{{ report.录入人 }}</td>
            <td>{{ report.归属标记 }}</td>
            <td>{{ report.取值说明 }}</td>
          </tr>
          <tr v-if="!reports.length">
            <td colspan="13" class="empty-state">暂无检验报告</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h3>到期预警与停用牌（检验完成后自动收回，原记录保留）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>预警编号</th><th>设备编号</th><th>设备名称</th><th>预警类型</th><th>预警内容</th>
            <th>发出时间</th><th>收回时间</th><th>收回原因</th><th>归属单位</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alert in alerts" :key="String(alert.id)">
            <td>{{ alert.预警编号 }}</td>
            <td>{{ alert.设备编号 }}</td>
            <td>{{ alert.设备名称 }}</td>
            <td>{{ alert.预警类型 }}</td>
            <td>{{ alert.预警内容 }}</td>
            <td>{{ alert.发出时间 }}</td>
            <td>{{ alert.收回时间 || '—' }}</td>
            <td>{{ alert.收回原因 || '—' }}</td>
            <td>{{ alert.归属单位 }}</td>
            <td>
              <span class="badge" :class="alert.status === '生效中' ? (alert.预警类型 === '超期停用' ? 'stop' : 'warn') : ''">
                {{ alert.status }}
              </span>
            </td>
          </tr>
          <tr v-if="!alerts.length">
            <td colspan="10" class="empty-state">暂无预警记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h3>跨模块操作待办（回写闸门启闭 / 水情调度两个入口）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>待办编号</th><th>目标模块</th><th>设备编号</th><th>设备名称</th><th>待办内容</th>
            <th>来源</th><th>生成时间</th><th>解除时间</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="String(todo.id)">
            <td>{{ todo.待办编号 }}</td>
            <td>{{ targetLabel(String(todo.目标模块)) }}</td>
            <td>{{ todo.设备编号 }}</td>
            <td>{{ todo.设备名称 }}</td>
            <td>{{ todo.待办内容 }}</td>
            <td>{{ todo.来源 }}</td>
            <td>{{ todo.生成时间 }}</td>
            <td>{{ todo.解除时间 || '—' }}</td>
            <td>
              <span class="badge" :class="todo.status === '待处理' ? 'stop' : 'ok'">{{ todo.status }}</span>
            </td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="9" class="empty-state">暂无跨模块待办</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h3>存量迁移（断点续传：中断后从断掉的那一条接着走，不拿旧值顶替）</h3>
      <p class="muted">
        迁移顺序：① 机构资质 → ② 设备台账按投运年份回填 → ③ 历史报告按检验日期升序逐条导入（报告编号去重、实测优先认定）
        → ④ 按最新报告重算设备状态 → ⑤ 生成/收回预警与停用牌 → ⑥ 回写跨模块待办。缺项按现行版别推断。
      </p>
      <p>
        进度：{{ migration.cursor }}/{{ migration.total }}
        <span v-if="migration.done" class="badge ok">已完成</span>
        <span v-else class="badge warn">断点：第 {{ migration.cursor + 1 }} 条</span>
      </p>
      <ul class="migration-log">
        <li v-for="(line, index) in migration.log" :key="index">{{ line }}</li>
      </ul>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 台起重设备 · 统计与明细同源，导出报表同清单始终一致</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  INSPECTION_CYCLE_MONTHS,
  LIMIT_BRAKE_PAD_PCT,
  LIMIT_WIRE_ROPE_PCT,
  agencyStatus,
  craneStats,
  downloadCraneLedger,
  listAgencies,
  listAlerts,
  listCraneTodos,
  listReports,
  migrationState,
  permissionOf,
  queryCraneDevices,
  registerDevice,
  runLegacyMigration,
  submitInspectionReport,
  syncCraneAlerts,
  todoTargetLabel,
} from '@/api/crane-service'
import type { MigrationState } from '@/api/crane-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const permission = computed(() => permissionOf(session.account))

const columns = [
  '设备编号', '设备名称', '设备类型', '使用单位', '检验机构', '投运年份',
  '检验周期(月)', '上次检验日期', '下次检验日期', '检验结论', '报告编号', '资料来源', '最近操作人',
]
const filterFields = ['设备编号', '设备名称', '使用单位', '检验机构']
const statuses = ['待检验', '检验有效', '临期预警', '停用挂牌']
const cycleMonths = INSPECTION_CYCLE_MONTHS
const wireLimit = LIMIT_WIRE_ROPE_PCT
const brakeLimit = LIMIT_BRAKE_PAD_PCT

const rows = ref<EntryRow[]>([])
const allDevices = ref<EntryRow[]>([])
const agencies = ref<EntryRow[]>([])
const reports = ref<EntryRow[]>([])
const alerts = ref<EntryRow[]>([])
const todos = ref<EntryRow[]>([])
const stats = ref<{ label: string; value: number }[]>([])
const migration = ref<MigrationState>({ cursor: 0, total: 0, done: false, log: [] })
const total = ref(0)
const filters = ref<Record<string, string>>({})
const reportFilter = ref('')
const feedback = ref('')
const feedbackOk = ref(false)
const showDeviceForm = ref(false)

const deviceForm = ref({
  设备编号: '',
  设备名称: '',
  设备类型: '门式起重机',
  使用单位: '电站运行部',
  检验机构: '省特种设备检验研究院',
  投运年份: '',
})

const reportForm = ref({
  设备编号: 'CRANE-0001',
  报告编号: '',
  检验日期: '',
  申报结论: '合格',
  钢丝绳实测: '',
  制动器实测: '',
  资料来源: '电子报告',
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function statusClass(status: string): string {
  if (status === '检验有效') return 'ok'
  if (status === '临期预警') return 'warn'
  if (status === '停用挂牌') return 'stop'
  return ''
}

function agencyStatusOf(agency: EntryRow): string {
  return agencyStatus(agency)
}

function targetLabel(key: string): string {
  return todoTargetLabel(key)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportLedger() {
  downloadCraneLedger(filters.value)
  feedbackOk.value = true
  feedback.value = '检验台账已导出：统计与明细来自同一次查询，报表同清单一致'
}

function prepareReport(row: EntryRow) {
  reportForm.value.设备编号 = String(row.设备编号)
  feedback.value = `已为 ${row.设备编号}「${row.设备名称}」准备录入，归属检验机构：${row.检验机构}`
  feedbackOk.value = true
}

function showReports(row: EntryRow) {
  reportFilter.value = String(row.设备编号)
  reload()
}

function submitDevice() {
  const result = registerDevice(session.account, deviceForm.value)
  feedback.value = result.message
  feedbackOk.value = result.ok
  if (result.ok) {
    showDeviceForm.value = false
    deviceForm.value.设备编号 = ''
    deviceForm.value.设备名称 = ''
    deviceForm.value.投运年份 = ''
  }
  reload()
}

function submitReport() {
  const result = submitInspectionReport(session.account, reportForm.value)
  feedback.value = result.message
  feedbackOk.value = result.ok
  if (result.ok) {
    reportForm.value.报告编号 = ''
    reportForm.value.钢丝绳实测 = ''
    reportForm.value.制动器实测 = ''
  }
  reload()
}

function runMigration() {
  const result = runLegacyMigration(session.account)
  feedback.value = result.message
  feedbackOk.value = result.ok
  reload()
}

function reload() {
  // 每次读取前先同步：到期预警、超期停用、跨模块待办都按当前日期重算
  syncCraneAlerts()
  const matched = queryCraneDevices(filters.value)
  rows.value = matched
  total.value = matched.length
  stats.value = craneStats(matched)
  allDevices.value = queryCraneDevices()
  agencies.value = listAgencies()
  reports.value = listReports(reportFilter.value)
  alerts.value = listAlerts()
  todos.value = listCraneTodos()
  migration.value = migrationState()
}

onMounted(reload)
</script>
