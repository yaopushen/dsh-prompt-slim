/**
 * dsh-prompt-slim — replace verbose built-in system-prompt sections with shorter text.
 *
 * Mechanism: **agent-scoped section shadowing**. A prompt section is registered
 * per name into a scope layer; `ScopedLayers.merge` walks the scope chain from
 * the Host outward and keeps the last value per name, so a section registered on
 * an agent's own scope replaces the same-named one contributed by the preset or
 * the Host. Registering the replacement on `agent.ctx` changes exactly the named
 * sections and nothing else: the tool schemas, the runtime-context snapshot
 * (sandbox / approval / delegation), `plan:policy` while plan mode is active, and
 * every section this table does not name stay as composed.
 *
 * Why not the `system-prompt/assemble` waterfall: the Harness plugin guide
 * forbids it for adding or removing prompt text
 * (`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md`:
 * "Do not listen to `system-prompt/assemble` to add or remove tools or text").
 *
 * The replacement table comes from the loader row's `config.sections`; when the
 * row carries no table (for example when the row is added by path rather than
 * installed as a bundle) it falls back to `sections.json` beside this file.
 *
 * Safety: the plugin is inert without the `systemPrompt` service, every
 * registration is individually guarded, and the whole `agent/created` handler is
 * wrapped — a bad entry or an unexpected payload is logged and skipped instead of
 * failing the mount or the emitter.
 *
 * @module dsh-prompt-slim
 */

import { readFileSync } from 'node:fs'

export const name = 'dsh-prompt-slim'

/** The registry this plugin writes into; without it the plugin stays inactive. */
export const inject = ['systemPrompt']

/**
 * Read the fallback replacement table shipped beside this module.
 * @returns the section list, or an empty array when the file is absent or invalid.
 */
function readBundledTable() {
  try {
    const file = new URL('./sections.json', import.meta.url)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Shadow the configured sections on every agent's own scope.
 * @param ctx - the owning Cordis context.
 * @param config - loader row config; `sections` optionally overrides the bundled table.
 */
export function apply(ctx, config) {
  const configured = Array.isArray(config?.sections) ? config.sections : []
  const table = configured.length > 0 ? configured : readBundledTable()
  if (table.length === 0) {
    ctx.logger?.warn?.('prompt-slim: no replacement table (config.sections empty and sections.json missing)')
    return
  }

  // Practices rule 19: Keep per-agent disposers keyed by agent in plugin-level effect
  const activeDisposers = new Map()

  ctx.effect(() => () => {
    for (const dispose of activeDisposers.values()) {
      try { dispose() } catch {}
    }
    activeDisposers.clear()
  })

  ctx.on('agent/created', (payload) => {
    try {
      const agent = payload?.agent
      const agentCtx = agent?.ctx
      if (agentCtx === undefined) return

      const disposers = []
      for (const entry of table) {
        if (typeof entry?.name !== 'string' || entry.name.length === 0) continue
        try {
          const order = entry.order ?? ctx.systemPrompt.getSectionOrder(entry.orderKey)
          if (!Number.isFinite(order)) throw new Error(`unknown section order key "${entry.orderKey}"`)
          const section = {
            name: entry.name,
            order,
            text: entry.text ?? ''
          }
          if (entry.interpolate === false) section.interpolate = false
          disposers.push(agentCtx.systemPrompt.section(section))
        } catch (error) {
          ctx.logger?.warn?.(
            `prompt-slim: cannot replace section "${entry.name}": ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      if (disposers.length === 0) return

      const disposeAll = () => {
        while (disposers.length > 0) {
          try {
            disposers.pop()()
          } catch {
            /* teardown is best-effort */
          }
        }
      }

      if (agent) activeDisposers.set(agent, disposeAll)
      agentCtx.effect(() => () => {
        if (agent) activeDisposers.delete(agent)
        disposeAll()
      })
    } catch (error) {
      ctx.logger?.warn?.(`prompt-slim: agent/created failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

