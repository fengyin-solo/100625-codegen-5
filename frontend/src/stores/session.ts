import { defineStore } from 'pinia'

import type { Account } from '@/data/types'

// 预置账号：用来演示「本单位管台账、检验机构录结论、外来账号只读」的权限边界。
// 市质检站资质已过期（见 craneAgency 种子数据），用来演示资质门禁。
export const ACCOUNTS: Account[] = [
  { name: '值班管理员', role: 'unit', org: '电站运行部', roleLabel: '本单位·运行管理' },
  { name: '检验员·省特检院', role: 'agency', org: '省特种设备检验研究院', roleLabel: '检验机构·资质有效' },
  { name: '检验员·市质检站', role: 'agency', org: '市起重机械质检站', roleLabel: '检验机构·资质过期' },
  { name: '外来参观账号', role: 'external', org: '外部单位', roleLabel: '外来账号·只读' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水电站机组运行检修管理平台',
    accountName: '值班管理员',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    account(state): Account {
      return ACCOUNTS.find((item) => item.name === state.accountName) ?? ACCOUNTS[0]
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchAccount(name: string) {
      this.accountName = name
      this.operator = name
    },
  },
})
