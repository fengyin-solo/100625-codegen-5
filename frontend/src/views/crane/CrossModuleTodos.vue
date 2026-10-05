<template>
  <section class="crane-todo-panel" :class="{ 'is-hydrology': target === 'hydrology' }">
    <header class="crane-todo-head">
      <strong>门机联动待办（由起重设备定期检验台账回写）</strong>
      <span class="crane-todo-sub">
        检验结论在这里同步生效：停用门机在本入口禁止操作；检验合格后待办随台账结论一起解除
      </span>
    </header>
    <table v-if="todos.length" class="data-table">
      <thead>
        <tr>
          <th style="width: 90px">类型</th>
          <th>门机 / 启闭对象</th>
          <th>待办内容</th>
          <th style="width: 80px">状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in todos" :key="t.id" :class="t.kind === '停用指令' ? 'row-stop' : 'row-warn'">
          <td>
            <span class="todo-tag" :class="t.kind === '停用指令' ? 'tag-stop' : 'tag-warn'">{{ t.kind }}</span>
          </td>
          <td>{{ t.deviceName }}<br /><span class="muted">{{ t.gateRef }}</span></td>
          <td>{{ t.reason }}</td>
          <td :class="t.state === '待办' ? 'error-text' : 'muted'">{{ t.state }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty-state" style="padding: 10px">当前没有门机检验联动待办，各台门机均可用</p>
    <footer class="crane-todo-foot">
      <RouterLink to="/crane" class="link">前往起重设备定检台账核对归属与检验结论 →</RouterLink>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { activeTodos } from '@/api/crane-service'
import type { LinkedTodo } from '@/data/crane/types'

const props = defineProps<{ target: 'gate' | 'hydrology' }>()
const target = props.target
const todos = ref<LinkedTodo[]>([])

function reload() {
  todos.value = activeTodos(target).filter((t) => t.state === '待办')
}

defineExpose({ reload })
onMounted(reload)
</script>

<style scoped>
.crane-todo-panel {
  border: 1px solid var(--border);
  border-left: 4px solid #b54708;
  border-radius: 8px;
  background: #fff;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.crane-todo-panel.is-hydrology {
  border-left-color: #1f6feb;
}
.crane-todo-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
.crane-todo-sub {
  color: var(--muted);
  font-size: 12px;
}
.crane-todo-foot {
  margin-top: 6px;
  font-size: 12px;
}
.todo-tag {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}
.tag-stop {
  background: #fee4e2;
  color: #b42318;
}
.tag-warn {
  background: #fef0c3;
  color: #b54708;
}
.row-stop {
  background: #fff5f4;
}
.row-warn {
  background: #fffdf5;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
</style>
