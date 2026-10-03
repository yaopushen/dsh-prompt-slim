// Self-check: load this package exactly as the Host would, drive apply() with a fake
// Cordis ctx/agent, and assert that every entry in sections.json lands correctly.
//
//   node verify.mjs
//
// It needs no DSH install and no dependencies. Exit code 0 = every replacement
// registered with the expected name, order, text and interpolate flag.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/** Mirror of SECTION_ORDERS in @deepseek-ai/dsh-system-prompt. */
const ORDERS = {
  TEAM_POLICY: 600, TOOL_BASH: 1000, TOOL_READ: 1100, TOOL_WRITE: 1200, TOOL_EDIT: 1300,
  TOOL_GLOB: 1400, TOOL_GREP: 1500, TOOL_JOBS: 1600, TOOL_WEB_SEARCH: 2000, TOOL_WEB_FETCH: 2100,
  TOOL_GOAL: 2400, TOOL_WORKFLOW: 2600, TOOL_SUBAGENT: 2800, MCP_SERVERS: 3100,
  DELIVERABLE_FILE_REFERENCES: 9000, WEB_SURFACE: 10100
}

const root = new URL('.', import.meta.url)
const mod = await import(new URL('./index.js', root).href)
const table = JSON.parse(await readFile(new URL('./sections.json', root), 'utf8'))

const fail = []
const warns = []
const registered = []
const events = []

if (mod.name !== 'dsh-prompt-slim') fail.push(`exported name is "${mod.name}"`)
if (!Array.isArray(mod.inject) || !mod.inject.includes('systemPrompt')) fail.push('inject does not include systemPrompt')

const layer = (label) => ({
  logger: { warn: (m) => warns.push(`${label}: ${m}`) },
  effect: (cb) => { const d = cb(); return () => { try { d?.() } catch { /* best-effort */ } } },
  systemPrompt: { getSectionOrder: (k) => ORDERS[k], section: () => () => {} }
})
const ctx = {
  ...layer('host'),
  on: (name, cb) => events.push([name, cb])
}
const agentCtx = {
  ...layer('agent'),
  systemPrompt: {
    getSectionOrder: (k) => ORDERS[k],
    section: (s) => { registered.push(s); return () => {} }
  }
}

mod.apply(ctx, {})

if (events.length !== 1 || events[0][0] !== 'agent/created') {
  fail.push(`expected one agent/created listener, got ${JSON.stringify(events.map((e) => e[0]))}`)
} else {
  const handler = events[0][1]
  handler({ agent: { ctx: agentCtx } })
  handler({ nonsense: true })  // hostile payloads must be skipped, not thrown
  handler({ agent: {} })
}

if (registered.length !== table.length) fail.push(`registered ${registered.length} of ${table.length} sections`)
for (const [i, entry] of table.entries()) {
  const got = registered[i]
  if (got === undefined) { fail.push(`no registration for #${i} ${entry.name}`); continue }
  if (got.name !== entry.name) fail.push(`#${i} name "${got.name}" != "${entry.name}"`)
  if (got.order !== ORDERS[entry.orderKey]) fail.push(`${entry.name}: order ${got.order} != ${ORDERS[entry.orderKey]}`)
  if (got.text !== entry.text) fail.push(`${entry.name}: text differs from sections.json`)
  if ((entry.interpolate === false) !== (got.interpolate === false)) fail.push(`${entry.name}: interpolate flag differs`)
}

const bytes = registered.reduce((n, s) => n + Buffer.byteLength(s.text, 'utf8'), 0)
const unexpected = warns.filter((w) => !w.includes('agent/created failed'))
if (unexpected.length > 0) fail.push(`unexpected warnings: ${unexpected.join(' | ')}`)

console.log(`sections in table : ${table.length}`)
console.log(`sections replaced : ${registered.length}`)
console.log(`replacement text  : ${bytes} B`)
console.log(`warnings          : ${warns.length}`)
console.log(fail.length === 0 ? 'verify: PASS' : `verify: FAIL\n  ${fail.join('\n  ')}`)
process.exit(fail.length === 0 ? 0 : 1)
