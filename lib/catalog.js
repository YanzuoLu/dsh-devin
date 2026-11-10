import { LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { fetchNativeModels } from './native-catalog.js'
import { NATIVE_ORIGIN } from './native.js'

const positive = value => Number.isFinite(value) && value > 0
const clean = name => name.replace(/·/gu, ' ').replace(/\bno[ _-]*zdr\b/giu, '').replace(/\b\d+(?:\.\d+)?[km]\b/giu, '')
  .replace(/\(\s*\)|\[\s*\]/gu, '').replace(/\s+/gu, ' ').trim()
const RANK = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const NAMES = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' }
const effortAxis = key => /^(?:reasoning )?effort$/iu.test(key)
const contextAxis = key => /context/iu.test(key)
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const effort = row => {
  const label = Object.entries(row.labels ?? {}).find(([key]) => effortAxis(key))?.[1]?.name
  if (!label) return undefined
  const normalized = label.toLowerCase().replace(/[ -]/gu, '')
  const id = normalized === 'nothinking' ? 'none' : normalized === 'extrahigh' ? 'xhigh' : normalized
  return RANK.includes(id) ? id : undefined
}
const family = row => row.familyId || row.id
const lanes = row => Object.entries(row.labels ?? {}).filter(([key]) => !effortAxis(key) && !contextAxis(key)).sort(([a], [b]) => a.localeCompare(b))
const laneKey = row => JSON.stringify(lanes(row))
function modelInfo(row, name) {
  return { provider: 'devin', id: row.id, name: clean(name || row.name || row.id), inputModalities: row.supportsImages ? ['text', 'image'] : ['text'],
    ...(positive(row.context) ? { context: { contextWindow: row.context } } : {}),
    defaultMaxTokens: Math.min(positive(row.maxOutput) ? row.maxOutput : 32768, 32768) }
}

/** Family/effort/context facts are decoded from native ClientModelConfig, never inferred from ids. */
export function catalogEntries(rows) {
  const maxima = new Map()
  for (const row of rows) if (positive(row.context)) maxima.set(family(row), Math.max(maxima.get(family(row)) ?? 0, row.context))
  const eligible = rows.filter(row => !row.disabled && !row.internal && !row.router && ![3, 4, 6].includes(row.displaySlot) && row.id !== 'subagent-default')
  const full = eligible.filter(row => !positive(row.context) || row.context >= maxima.get(family(row)))
  const groups = new Map(), out = []
  for (const row of full) {
    const id = effort(row)
    if (!id) { out.push({ info: modelInfo(row), wireModelId: row.id, row }); continue }
    const key = JSON.stringify([family(row), laneKey(row), row.context, row.maxOutput, row.supportsImages])
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group)
  }
  for (const members of groups.values()) {
    if (new Set(members.map(effort)).size !== members.length) {
      for (const row of members) out.push({ info: modelInfo(row), wireModelId: row.id, row })
      continue
    }
    members.sort((a, b) => RANK.indexOf(effort(a)) - RANK.indexOf(effort(b)))
    const chosen = members.find(r => r.isDefault) ?? members.find(r => effort(r) === 'high') ?? members[0]
    const peers = full.filter(r => family(r) === family(chosen)), labels = []
    for (const [key, value] of lanes(chosen)) {
      if (!peers.some(r => JSON.stringify(r.labels?.[key]) !== JSON.stringify(value))) continue
      if (key === 'Fast Mode') { if (value.order > 0) labels.push('Fast') }
      else if (key === 'Thinking') { if (value.order > 0) labels.push('Thinking') }
      else if (key === 'Prompt Cache Retention') labels.push(`Cache ${value.name || 'Default'}`)
      else labels.push(value.name || `${key} ${value.order}`)
    }
    out.push({ info: { ...modelInfo(chosen, [chosen.familyName || chosen.name, ...labels].join(' ')), reasoning: {
      efforts: members.map(r => ({ id: ReasoningEffortId(effort(r)), name: NAMES[effort(r)] })), defaultEffort: ReasoningEffortId(effort(chosen)) } },
      wireModelId: chosen.id, row: chosen,
      efforts: members.map(r => ({ id: effort(r), wireModelId: r.id })),
      aliases: members.map(r => ({ id: r.id, effort: effort(r) })),
    })
  }
  for (const entry of out) entry.aliases ??= []
  for (const removed of eligible.filter(r => positive(r.context) && r.context < maxima.get(family(r)))) {
    const target = out.find(e => family(e.row) === family(removed) && laneKey(e.row) === laneKey(removed)
      && (effort(removed) ? e.efforts?.some(v => v.id === effort(removed)) : !e.efforts))
    if (target) target.aliases.push({ id: removed.id, ...(effort(removed) ? { effort: effort(removed) } : {}) })
  }
  for (const familyId of new Set(full.map(family))) {
    const group = out.filter(e => family(e.row) === familyId)
    const preferred = group.find(e => e.row.isDefault) ?? group[0]
    if (preferred && !out.some(e => e.info.id === familyId) && !eligible.some(r => r.id === familyId)) preferred.aliases.push({ id: familyId })
  }
  return freeze(out.map(({ row, ...entry }) => entry))
}

export function createDevinCatalog(auth, { cached, save = async () => {}, fetch, origin = NATIVE_ORIGIN, fetchModels = fetchNativeModels } = {}) {
  let state = cached?.format === 'native-v1' && Array.isArray(cached.rows) ? cached : undefined
  let entries = catalogEntries(state?.rows ?? [])
  let epoch = 0, tail = Promise.resolve()
  const lifetime = new AbortController()
  const saves = value => { const next = tail.then(() => save(value)); tail = next.catch(() => {}); return next }
  async function clear() { epoch++; state = undefined; entries = freeze([]); await saves(null) }
  return {
    entries: () => entries,
    loginId: () => state?.loginId,
    snapshot(model) {
      const exact = entries.find(e => e.info.id === model)
      if (exact) return exact
      const entry = entries.find(e => e.aliases.some(a => a.id === model))
      if (!entry) return undefined
      const alias = entry.aliases.find(a => a.id === model), route = entry.efforts?.find(e => e.id === alias.effort)
      return freeze({ ...entry, info: { ...entry.info, id: model,
        ...(route ? { reasoning: { ...entry.info.reasoning, defaultEffort: ReasoningEffortId(route.id) } } : {}) }, wireModelId: route?.wireModelId ?? entry.wireModelId })
    },
    select(entry, requested) {
      if (requested === undefined) return entry.wireModelId
      const route = entry.efforts?.find(e => e.id === requested)
      if (!route) throw new LlmError('Unsupported Devin effort for this model.', 'INVALID_REASONING_EFFORT')
      return route.wireModelId
    },
    async refresh(signal) {
      const generation = ++epoch, active = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])])
      const grant = await auth.getGrant(active)
      let rows
      try { rows = await fetchModels({ access: grant.access, signal: active, fetch, origin }) }
      catch (error) { if (error.code === 'AUTH') auth.reject(grant); throw error }
      const next = { format: 'native-v1', loginId: grant.loginId, checkedAt: Date.now(), rows }, nextEntries = catalogEntries(rows)
      active.throwIfAborted()
      if (generation !== epoch || (await auth.metadata()).loginId !== grant.loginId) return
      await saves(next); active.throwIfAborted()
      if (generation !== epoch || (await auth.metadata()).loginId !== grant.loginId) return
      state = next; entries = nextEntries
    },
    clear,
    async dispose() { epoch++; lifetime.abort(); await tail },
  }
}
