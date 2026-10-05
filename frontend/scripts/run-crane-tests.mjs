/**
 * 起重定检台账端到端检查：用 esbuild 把服务层与用例打成 node 可跑的 ESM 再执行。
 * 纯内存 localStorage，不依赖浏览器；改完服务层跑一次 `npm run test:crane`。
 */
import { build } from 'esbuild'
import { rm, stat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const resolve = (p) => new URL(p, root).pathname

await build({
  entryPoints: [resolve('scripts/crane-test-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: resolve('scripts/.tmp-crane-bundle.js'),
  alias: { '@': resolve('src') },
  logLevel: 'silent',
})

try {
  await import(resolve('scripts/.tmp-crane-bundle.js'))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  try {
    await rm(resolve('scripts/.tmp-crane-bundle.js'))
  } catch {
    // 临时文件可能未生成，忽略
  }
  // esbuild 在某些架构下没有可执行 bin，保持静默不影响检查结论。
  await stat(resolve('package.json')).catch(() => {})
}
