<template>
  <div v-if="todos.length" class="panel todo-panel">
    <h3>起重设备操作待办（来自起重设备检验台账）</h3>
    <ul class="todo-list">
      <li v-for="todo in todos" :key="String(todo.id)">
        <span class="badge stop">{{ todo.status }}</span>
        {{ todo.待办内容 }}
        <span class="muted">（{{ todo.来源 }} · {{ todo.生成时间 }}）</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { listCraneTodos, syncCraneAlerts } from '@/api/crane-service'
import type { EntryRow } from '@/data/types'

// 操作工在闸门启闭 / 水情调度入口看到的停用待办：数据由检验台账回写，这里只读
const props = defineProps<{ moduleKey: string }>()

const todos = ref<EntryRow[]>([])

onMounted(() => {
  syncCraneAlerts()
  todos.value = listCraneTodos(props.moduleKey, true)
})
</script>
