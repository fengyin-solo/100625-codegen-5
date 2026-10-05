/**
 * 起重定检台账端到端检查（经 esbuild 打包后在 node 执行，见 run-crane-tests.mjs）。
 * 验证：权限四档拦截、报告去重、实测优先、预警收回、超期停用、迁移断点续走、跨模块待办、报表一致。
 */
import assert from 'node:assert'

import * as svc from '@/api/crane-service'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// 重置到基线
svc.resetDemoData()
svc.switchAccount('C-DBA-01')

const findDevice = (id: string) => svc.listDevices().find((d: any) => d.id === id)!
const activeTodosFor = (target: string) => svc.activeTodos(target).filter((t: any) => t.state === '待办')

console.log('1) 初始对账：超期设备自动停用并下发两个入口的停用待办')
check('CR-003 超期 70 天自动挂停用牌', () => {
  assert.strictEqual(findDevice('CR-003').status, '停用')
  assert.ok(findDevice('CR-003').stopTag)
})
check('闸门入口存在 CR-003 停用指令', () => {
  assert.ok(activeTodosFor('gate').some((t: any) => t.deviceId === 'CR-003' && t.kind === '停用指令'))
})
check('水情入口存在 CR-003 停用指令', () => {
  assert.ok(activeTodosFor('hydrology').some((t: any) => t.deviceId === 'CR-003' && t.kind === '停用指令'))
})
check('CR-002 在 30 天提前量内处于预警', () => {
  assert.strictEqual(findDevice('CR-002').status, '预警')
})
check('CR-001 在用', () => {
  assert.strictEqual(findDevice('CR-001').status, '在用')
})
check('闸门开启动作被跨模块硬拦截', () => {
  const block = svc.gateActionBlocked('GM-WS-01', '开启闸门')
  assert.ok(block && block.includes('跨模块拦截'))
})
check('正常设备开启不拦截', () => {
  assert.strictEqual(svc.gateActionBlocked('GM-DB-01', '开启闸门'), null)
})

console.log('2) 权限四档：使用单位 / 外来账号 / 无资质机构 / 跨机构跨单位全部挡回')
const today = new Date().toISOString().slice(0, 10)
const payload = (over: any = {}) => ({
  deviceId: 'CR-001',
  reportNo: `BG-TEST-${Math.random().toString(36).slice(2, 7)}`,
  inspectedAt: today,
  paperArchive: false,
  wireRopeWearRate: '2.0',
  brakeClearance: '0.5',
  conclusion: '',
  inferred: false,
  remark: '',
  ...over,
})

check('使用单位账号提交被挡（只许看不许动结论）', () => {
  svc.switchAccount('C-DBA-01')
  const r = svc.submitInspection(payload())
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('使用单位') && r.message.includes('查看权'))
})
check('外来账号提交被挡（只许看不许动）', () => {
  svc.switchAccount('C-AUDIT-01')
  const r = svc.submitInspection(payload())
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('外来账号只有查看权限'))
})
check('资质失效机构提交被挡', () => {
  svc.switchAccount('C-AYZX-01')
  const r = svc.submitInspection(payload())
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('未取得有效的起重机械定期检验资质'))
})
check('华建（有资质但只授权尾水）替大坝单位的 CR-005 录结论被挡：跨单位越权', () => {
  svc.switchAccount('C-HJJC-01')
  const r = svc.submitInspection(payload({ deviceId: 'CR-005' }))
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('越权提交被拦截') && r.message.includes('授权范围不包含'))
})
check('华建账号对 CR-002（大坝/省院归属）同样被挡：检验机构不匹配', () => {
  svc.switchAccount('C-HJJC-01')
  const r = svc.submitInspection(payload({ deviceId: 'CR-002' }))
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('登记的检验机构是'))
})

console.log('3) 合格机构正常录入 + 同号报告去重')
check('省院账号对 CR-001 录入合格报告成功', () => {
  svc.switchAccount('C-PSEI-01')
  const r = svc.submitInspection(payload({ deviceId: 'CR-001', wireRopeWearRate: '3.0', brakeClearance: '0.6' }))
  assert.strictEqual(r.ok, true, r.message)
})
check('同一报告编号重复上传只留一条', () => {
  const fixed = payload({ deviceId: 'CR-001', reportNo: 'BG-DUP-001' })
  const r1 = svc.submitInspection(fixed)
  assert.strictEqual(r1.ok, true)
  const r2 = svc.submitInspection(fixed)
  assert.strictEqual(r2.ok, false)
  assert.ok(r2.message.includes('重复上传只留一条'))
})

console.log('4) 实测优先：手填合格但钢丝绳磨损 9.2% 超限，按实测判不合格并停用')
check('实测超限覆盖主观合格结论，自动停用并下发停用待办', () => {
  svc.switchAccount('C-PSEI-01')
  const r = svc.submitInspection(payload({
    deviceId: 'CR-001', reportNo: 'BG-WORN-01', wireRopeWearRate: '9.2',
    brakeClearance: '0.5', conclusion: '合格',
  }))
  assert.strictEqual(r.ok, true)
  assert.ok(r.message.includes('统一按实测取值判定为「不合格」'))
  assert.strictEqual(findDevice('CR-001').status, '停用')
  assert.ok(activeTodosFor('gate').some((t: any) => t.deviceId === 'CR-001' && t.kind === '停用指令'))
})
check('制动器间隙 1.2mm 超限同样判不合格', () => {
  svc.switchAccount('C-HJJC-01')
  const r = svc.submitInspection(payload({
    deviceId: 'CR-004', reportNo: 'BG-WORN-02', wireRopeWearRate: '2.0',
    brakeClearance: '1.2', conclusion: '合格',
  }))
  assert.strictEqual(r.ok, true)
  assert.ok(r.message.includes('不合格'))
  assert.strictEqual(findDevice('CR-004').status, '停用')
})

console.log('5) 预警发出后完成检验：预警收回、待办解除、历史结论保留')
check('CR-002 补一份今天合格的报告（含实测），设备回在用', () => {
  svc.switchAccount('C-PSEI-01')
  const r = svc.submitInspection(payload({
    deviceId: 'CR-002', reportNo: 'BG-OK-02', inspectedAt: today,
    wireRopeWearRate: '2.5', brakeClearance: '0.5',
  }))
  assert.strictEqual(r.ok, true, r.message)
  assert.strictEqual(findDevice('CR-002').status, '在用')
})
check('该周期预警变为已收回且保留收回原因与报告号', () => {
  const ws = svc.listWarnings().filter((w: any) => w.deviceId === 'CR-002')
  assert.ok(ws.some((w: any) => w.state === '已收回' && w.reportNo === 'BG-OK-02'))
})
check('CR-002 已无待办状态的预警/停用待办', () => {
  assert.ok(!svc.activeTodos().some((t: any) => t.deviceId === 'CR-002' && t.state === '待办'))
})
check('CR-001 的历史合格、不合格两份报告都在（结论不覆盖）', () => {
  const recs = svc.listRecords().filter((r: any) => r.deviceId === 'CR-001')
  assert.ok(recs.some((r: any) => r.conclusion === '合格'))
  assert.ok(recs.some((r: any) => r.conclusion === '不合格'))
  assert.ok(recs.every((r: any) => r.immutable === true))
})

console.log('6) CR-003 复检合格：超期停用解除，两个入口待办一起解除')
check('华建给 CR-003 录入合格报告后恢复在用', () => {
  svc.switchAccount('C-HJJC-01')
  const r = svc.submitInspection(payload({
    deviceId: 'CR-003', reportNo: 'BG-OK-03', wireRopeWearRate: '3.0', brakeClearance: '0.6',
  }))
  assert.strictEqual(r.ok, true, r.message)
  assert.strictEqual(findDevice('CR-003').status, '在用')
})
check('CR-003 闸门、水情入口停用待办均解除（记录保留为已解除）', () => {
  assert.ok(!activeTodosFor('gate').some((t: any) => t.deviceId === 'CR-003'))
  assert.ok(!activeTodosFor('hydrology').some((t: any) => t.deviceId === 'CR-003'))
  const all = svc.activeTodos().filter((t: any) => t.deviceId === 'CR-003')
  assert.ok(all.length >= 2 && all.every((t: any) => t.state === '已解除'))
})

console.log('7) 存量迁移：顺序、断点停住、从断条续走、报告去重、无报告只建档')
svc.resetDemoData()
svc.switchAccount('C-PSEI-01')

check('未完成设备回填时不能扫描汇总', () => {
  assert.strictEqual(svc.migrateScanAndSummarize().ok, false)
})
check('设备阶段：按投运年份升序，第一台是 2003 年', () => {
  const r1 = svc.migrateNextDevice()
  assert.strictEqual(r1.ok, true)
  assert.ok(r1.message.includes('2003'))
  const r2 = svc.migrateNextDevice()
  assert.ok(r2.message.includes('2006'))
})
check('自动顺序推进到取数中断条目 L3 时在该条停住（不拿旧值顶替）', () => {
  // 把剩余 4 台设备回填完
  for (let i = 0; i < 4; i++) svc.migrateNextDevice()
  // 报告阶段按发生日期：2014(L2)、2023(L1)、2024(L3 未取数)…
  const r2014 = svc.migrateNextReport()
  assert.ok(r2014.ok && r2014.message.includes('2014-09-02'))
  const r2023 = svc.migrateNextReport()
  assert.ok(r2023.ok && r2023.message.includes('2023-06-18'))
  const rL3 = svc.migrateNextReport()
  assert.strictEqual(rL3.ok, false)
  assert.ok(rL3.message.includes('取数中断') && rL3.message.includes('L3'))
  // 再点一次仍然停在同一条，游标不前进
  const rAgain = svc.migrateNextReport()
  assert.strictEqual(rAgain.ok, false)
  assert.ok(rAgain.message.includes('L3'))
})
check('续取缺失实测值后从断条接着走', () => {
  const resume = svc.resumeFetch('L3', { wire: '2.8', brake: '0.5' })
  assert.strictEqual(resume.ok, true)
  const r = svc.migrateNextReport()
  assert.strictEqual(r.ok, true)
  assert.ok(r.message.includes('2024-11-20'))
})
check('L5 钢丝绳 9.2% 实测超限：按实测判不合格，设备停用', () => {
  const r = svc.migrateNextReport()
  assert.strictEqual(r.ok, true)
  assert.ok(r.message.includes('不合格') && r.message.includes('停用'))
})
check('L6 与 L5 同报告号 P-2025-0066：按编号去重挡回，只留先发生一条', () => {
  const r = svc.migrateNextReport()
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('重复'))
})
check('全部条目走完后扫描汇总成功，无报告设备（L4）挂停用待首检', () => {
  const r = svc.migrateScanAndSummarize()
  assert.strictEqual(r.ok, true, r.message)
  assert.ok(r.message.includes('回填存量设备 6 台'))
  const l4 = svc.listDevices().find((d: any) => d.legacyId === 'L4')
  assert.strictEqual(l4.status, '停用')
  assert.ok(l4.stopReason.includes('无有效'))
})
check('纸质报告记录带 paperArchive 与推断标记，报告编号为 PAPER- 前缀', () => {
  const paper = svc.listRecords().filter((r: any) => r.paperArchive)
  assert.ok(paper.length >= 3)
  assert.ok(paper.every((r: any) => r.reportNo.startsWith('PAPER-')))
  const noMeasure = paper.find((r: any) => r.reportNo === 'PAPER-P-2014-0032')
  assert.ok(noMeasure && noMeasure.inferred === true)
})

console.log('8) 报表与明细一致：CSV 行数 == 明细条数，卡片数字来自明细')
check('台账 CSV 数据行 == 设备数（含存量 6 + 电子 5 = 11）', () => {
  const csv = svc.downloadCsvForTest('devices').content
  const rows = csv.split('\n').slice(1).filter((x: string) => x.trim())
  assert.strictEqual(rows.length, svc.listDevices().length)
  assert.strictEqual(rows.length, 11)
})
check('结论 CSV 数据行 == 报告明细数', () => {
  const csv = svc.downloadCsvForTest('records').content
  const rows = csv.split('\n').slice(1).filter((x: string) => x.trim())
  assert.strictEqual(rows.length, svc.listRecords().length)
})
check('统计卡片的停用数与明细状态计数一致', () => {
  const stopped = svc.listDevices().filter((d: any) => d.status === '停用').length
  assert.strictEqual(svc.craneStats().stopped, stopped)
})

console.log('9) 权限日志：每一笔放行与拦截都有账号、归属与理由')
check('日志中包含使用单位被拦、跨单位被拦、资质失效被拦三类记录', () => {
  svc.resetDemoData()
  // 基线已含系统日志；再造几笔
  svc.switchAccount('C-DBA-01')
  svc.submitInspection({
    deviceId: 'CR-001', reportNo: 'LOG-T1', inspectedAt: today, paperArchive: false,
    wireRopeWearRate: '1', brakeClearance: '0.4', conclusion: '', inferred: false, remark: '',
  })
  svc.switchAccount('C-HJJC-01')
  svc.submitInspection({
    deviceId: 'CR-005', reportNo: 'LOG-T2', inspectedAt: today, paperArchive: false,
    wireRopeWearRate: '1', brakeClearance: '0.4', conclusion: '', inferred: false, remark: '',
  })
  svc.switchAccount('C-AYZX-01')
  svc.submitInspection({
    deviceId: 'CR-001', reportNo: 'LOG-T3', inspectedAt: today, paperArchive: false,
    wireRopeWearRate: '1', brakeClearance: '0.4', conclusion: '', inferred: false, remark: '',
  })
  const logs = svc.listLogs().filter((l: any) => l.action === '录入检验结论' && !l.ok)
  assert.ok(logs.some((l: any) => l.reason.includes('使用单位')))
  assert.ok(logs.some((l: any) => l.reason.includes('授权范围不包含')))
  assert.ok(logs.some((l: any) => l.reason.includes('资质')))
})

console.log(`\n全部 ${passed} 项检查通过 ✅`)
