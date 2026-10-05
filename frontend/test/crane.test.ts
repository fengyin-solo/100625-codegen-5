import './setup'

import {
  CRANE_KEY,
  TODO_KEY,
  addMonthsStr,
  computeDeviceStatus,
  listCraneTodos,
  listReports,
  migrationState,
  queryCraneDevices,
  registerDevice,
  runLegacyMigration,
  submitInspectionReport,
  syncCraneAlerts,
  todayStr,
} from '@/api/crane-service'
import { listRows } from '@/data/local-store'
import type { Account } from '@/data/types'

const unit: Account = { name: '值班管理员', role: 'unit', org: '电站运行部', roleLabel: '' }
const agencyA: Account = { name: '检验员·省特检院', role: 'agency', org: '省特种设备检验研究院', roleLabel: '' }
const agencyB: Account = { name: '检验员·市质检站', role: 'agency', org: '市起重机械质检站', roleLabel: '' }
const outsider: Account = { name: '外来参观账号', role: 'external', org: '外部单位', roleLabel: '' }

let passed = 0
let failed = 0

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}

const today = todayStr()
console.log(`今天：${today}\n`)

// —— 1. 种子数据 + 同步：状态、预警、跨模块待办 ——
console.log('1. 种子数据同步')
syncCraneAlerts()
const devices = queryCraneDevices()
const byCode = (code: string) => devices.find((d) => d.设备编号 === code)!
check('CRANE-0001 检验有效', byCode('CRANE-0001').status === '检验有效')
check('CRANE-0002 临期预警', byCode('CRANE-0002').status === '临期预警')
check('CRANE-0003 超期停用挂牌', byCode('CRANE-0003').status === '停用挂牌')
check('CRANE-0005 超期停用挂牌', byCode('CRANE-0005').status === '停用挂牌')
check('CRANE-0006 待检验（迁移前无检验日期）', byCode('CRANE-0006').status === '待检验')
const gateTodos = listCraneTodos('gate', true)
const hydTodos = listCraneTodos('hydrology', true)
check('闸门启闭入口有 2 条停用待办', gateTodos.length === 2, `实际 ${gateTodos.length}`)
check('水情调度入口有 2 条停用待办', hydTodos.length === 2, `实际 ${hydTodos.length}`)
check('待办内容指向具体门机', gateTodos.every((t) => String(t.待办内容).includes('停用牌')))
syncCraneAlerts()
check('同步幂等，不重复生成待办', listCraneTodos('gate', true).length === 2)

// —— 2. 权限门禁 ——
console.log('2. 权限与归属')
const basePayload = {
  设备编号: 'CRANE-0001',
  报告编号: 'QJ-2026-9001',
  检验日期: today,
  申报结论: '合格',
  钢丝绳实测: '4.0',
  制动器实测: '30',
  资料来源: '电子报告',
}
let r = submitInspectionReport(outsider, basePayload)
check('外来账号录入被拦', !r.ok && r.message.includes('外来账号'))
r = submitInspectionReport(unit, basePayload)
check('本单位账号录结论被拦', !r.ok && r.message.includes('只许查看'))
r = submitInspectionReport(agencyB, { ...basePayload, 设备编号: 'CRANE-0003' })
check('资质过期机构录入被拦', !r.ok && r.message.includes('资质已过期'), r.message)
r = submitInspectionReport(agencyA, { ...basePayload, 设备编号: 'CRANE-0003' })
check('跨机构越权录入被拦并说明归属', !r.ok && r.message.includes('越权') && r.message.includes('市起重机械质检站'), r.message)
r = registerDevice(agencyA, { 设备编号: 'CRANE-0007', 设备名称: '尾水门机#3', 设备类型: '门式起重机', 使用单位: '电站运行部', 检验机构: '省特种设备检验研究院', 投运年份: '2024' })
check('检验机构登记设备被拦', !r.ok)
r = registerDevice(outsider, { 设备编号: 'CRANE-0007', 设备名称: '尾水门机#3', 设备类型: '门式起重机', 使用单位: '电站运行部', 检验机构: '省特种设备检验研究院', 投运年份: '2024' })
check('外来账号登记设备被拦', !r.ok)
r = registerDevice(unit, { 设备编号: 'CRANE-0007', 设备名称: '尾水门机#3', 设备类型: '门式起重机', 使用单位: '电站运行部', 检验机构: '省特种设备检验研究院', 投运年份: '2024' })
check('本单位登记设备成功', r.ok, r.message)
check('新设备按投运年份回填下次检验日期', String(queryCraneDevices().find((d) => d.设备编号 === 'CRANE-0007')!.下次检验日期) >= today)

// —— 3. 合格报告：预警收回、历史保留 ——
console.log('3. 检验完成 → 预警收回')
const before = listReports().length
r = submitInspectionReport(agencyA, { ...basePayload, 设备编号: 'CRANE-0002', 报告编号: 'QJ-2026-1005' })
check('归属机构录入合格结论成功', r.ok, r.message)
const c2 = queryCraneDevices().find((d) => d.设备编号 === 'CRANE-0002')!
check('CRANE-0002 恢复检验有效', c2.status === '检验有效')
check('下次检验日期 = 检验日期 + 24 个月', c2.下次检验日期 === addMonthsStr(today, 24), String(c2.下次检验日期))
const alerts2 = listRows('craneAlert')
const recalled = alerts2.filter((a) => a.设备编号 === 'CRANE-0002' && a.status === '已收回')
check('临期预警已收回且留痕', recalled.length === 1 && String(recalled[0].收回原因).includes('QJ-2026-1005'))
check('报告只增不减', listReports().length === before + 1)
check('历史报告 QJ-2024-1033 仍在', listReports().some((p) => p.报告编号 === 'QJ-2024-1033'))

// —— 4. 去重 ——
console.log('4. 报告编号去重')
r = submitInspectionReport(agencyA, { ...basePayload, 设备编号: 'CRANE-0002', 报告编号: 'QJ-2026-1005' })
check('重复上传同一报告编号被拦', !r.ok && r.message.includes('重复上传'), r.message)
check('重复上传后仍只有一条', listReports().filter((p) => p.报告编号 === 'QJ-2026-1005').length === 1)

// —— 5. 实测值优先 ——
console.log('5. 实测值优先')
r = submitInspectionReport(agencyA, {
  ...basePayload,
  设备编号: 'CRANE-0004',
  报告编号: 'QJ-2026-2001',
  申报结论: '合格',
  钢丝绳实测: '8.5',
  制动器实测: '30',
})
check('申报合格但实测超限 → 认定不合格', r.ok && r.message.includes('按实测统一取「不合格」'), r.message)
const c4 = queryCraneDevices().find((d) => d.设备编号 === 'CRANE-0004')!
check('不合格设备自动停用挂牌', c4.status === '停用挂牌')
check('停用待办回写闸门启闭', listCraneTodos('gate', true).some((t) => t.设备编号 === 'CRANE-0004'))
check('停用待办回写水情调度', listCraneTodos('hydrology', true).some((t) => t.设备编号 === 'CRANE-0004'))
// 复检合格 → 恢复，待办解除，历史不盖掉
r = submitInspectionReport(agencyA, {
  ...basePayload,
  设备编号: 'CRANE-0004',
  报告编号: 'QJ-2026-2002',
  申报结论: '合格',
  钢丝绳实测: '4.1',
  制动器实测: '28',
})
check('复检合格录入成功', r.ok, r.message)
check('设备恢复检验有效', queryCraneDevices().find((d) => d.设备编号 === 'CRANE-0004')!.status === '检验有效')
check('闸门启闭待办已解除', listCraneTodos('gate', true).every((t) => t.设备编号 !== 'CRANE-0004'))
check('不合格历史报告保留', listReports().some((p) => p.报告编号 === 'QJ-2026-2001' && p.认定结论 === '不合格'))

// —— 6. 存量迁移：断点续传 ——
console.log('6. 存量迁移')
let m = runLegacyMigration(outsider)
check('外来账号执行迁移被拦', !m.ok)
m = runLegacyMigration(unit)
check('迁移完成', m.ok && m.state.done && m.state.cursor === 5, m.message)
const reportsAfter = listReports()
check('重复报告编号 QJ-2022-1015 只留一条', reportsAfter.filter((p) => p.报告编号 === 'QJ-2022-1015').length === 1)
check('缺编号纸质报告补号 PAPER-CRANE-0005-2021', reportsAfter.some((p) => p.报告编号 === 'PAPER-CRANE-0005-2021'))
const legacy0404 = reportsAfter.find((p) => p.设备编号 === 'CRANE-0004' && p.检验日期 === '2023-06-10')
check('迁移中实测超限按实测认定不合格', legacy0404?.认定结论 === '不合格')
check('旧报告不顶替设备新状态', queryCraneDevices().find((d) => d.设备编号 === 'CRANE-0004')!.检验结论 === '合格')
const legacy0303 = reportsAfter.find((p) => p.设备编号 === 'CRANE-0003' && p.检验日期 === '2022-08-15')
check('缺项实测标缺项不拿旧值顶替', String(legacy0303?.['制动器实测(%)']).includes('缺项'))
const c6 = queryCraneDevices().find((d) => d.设备编号 === 'CRANE-0006')!
check('CRANE-0006 按投运年份回填 2027-07-01', c6.下次检验日期 === '2027-07-01', String(c6.下次检验日期))
check('CRANE-0006 回填后仍待检验', c6.status === '待检验')
const cursorAfter = migrationState().cursor
m = runLegacyMigration(unit)
check('迁移完成后重复执行是空操作', m.state.done && migrationState().cursor === cursorAfter)
check('重复执行后报告总数不变', listReports().length === reportsAfter.length)

// —— 7. 报表与明细一致 ——
console.log('7. 报表同明细一致')
const rows = listRows(CRANE_KEY)
const statsStop = rows.filter((d) => d.status === '停用挂牌').length
check('停用挂牌统计与明细同源', statsStop === rows.filter((d) => computeDeviceStatus(d) === '停用挂牌').length)
check('待办只挂在停用设备上', listRows(TODO_KEY).filter((t) => t.status === '待处理').every((t) => {
  const dev = rows.find((d) => d.设备编号 === t.设备编号)
  return dev && dev.status === '停用挂牌'
}))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
