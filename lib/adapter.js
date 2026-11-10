import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { NATIVE_ORIGIN, createNativeAuth } from './native.js'
import { projectRequest, stableId } from './projection.js'
import { streamNative } from './native-chat.js'

export class DevinAdapter extends LlmAdapter {
  constructor(ctx, auth, catalog, { fetch, origin = NATIVE_ORIGIN, retryPolicy, idleTimeoutMs, nativeAuth } = {}) {
    super()
    Object.assign(this, { ctx, auth, catalog, fetch, retryPolicy, idleTimeoutMs })
    this.nativeAuth = nativeAuth ?? createNativeAuth({ fetch, origin })
    this.lifetime = new AbortController()
    this.active = new Set()
  }
  assertProvider(provider) {
    if (provider !== 'devin') throw new LlmError('This adapter only owns Devin.', 'NO_ADAPTER')
  }
  providerInfo(provider) { this.assertProvider(provider); return { id: 'devin', name: 'Devin' } }
  providerRetryPolicy(provider) { this.assertProvider(provider); return this.retryPolicy }
  async listModels(provider) { this.assertProvider(provider); return this.catalog.entries().map(e => e.info) }
  capture(provider, model, signal) {
    this.assertProvider(provider); signal?.throwIfAborted(); this.lifetime.signal.throwIfAborted()
    const entry = this.catalog.snapshot(model)
    if (!entry) throw new LlmError('Sign in to Devin and refresh its model directory in DSH settings.', 'DEVIN_MODEL_UNAVAILABLE')
    return { entry, loginId: this.catalog.loginId() }
  }
  async resolveModel(provider, model, signal) { return this.capture(provider, model, signal).entry.info }
  async prepareCall(provider, model, signal) {
    const captured = this.capture(provider, model, signal)
    return Object.freeze({ model: captured.entry.info, stream: options => {
      if (options.provider !== provider || options.model !== model) throw new LlmError('Prepared Devin route changed before dispatch.', 'INVALID_PREPARED_CALL')
      return this.dispatch(options, captured)
    } })
  }
  async *stream(options) { yield* (await this.prepareCall(options.provider, options.model, options.signal)).stream(options) }
  async *dispatch(options, { entry, loginId }) {
    const controller = new AbortController()
    const operation = { loginId, controller }
    this.active.add(operation)
    const signal = AbortSignal.any([this.lifetime.signal, controller.signal, ...(options.signal ? [options.signal] : [])])
    try {
      const grant = await this.auth.getGrant(signal)
      if (grant.loginId !== loginId) throw new LlmError('Devin account changed. Refresh the model directory.', 'AUTH')
      const wireModelId = this.catalog.select(entry, options.reasoningEffort)
      const attachments = this.ctx.get('attachments')
      const filesystem = this.ctx.get('fs')
      const projected = await projectRequest(options, entry, wireModelId, { signal, attachments, accountScope: loginId,
        mapHostPath: filesystem ? path => filesystem.processPathFromHostPath(path) : undefined })
      signal.throwIfAborted()
      if ((await this.auth.metadata()).loginId !== loginId) throw new LlmError('Devin account changed before dispatch.', 'AUTH')
      const nativeSession = await this.nativeAuth.resolve(grant, signal)
      signal.throwIfAborted()
      if ((await this.auth.metadata()).loginId !== loginId) throw new LlmError('Devin account changed during native authentication.', 'AUTH')
      const cascadeId = stableId([grant.loginId, options.sessionId ?? projected.historyHash, options.purpose ?? 'main'])
      yield* streamNative({ access: grant.access, nativeSession, wireModelId, projected, cascadeId, options, signal,
        fetch: this.fetch, idleTimeoutMs: this.idleTimeoutMs, onUnauthorized: () => this.auth.reject(grant) })
    } finally { this.active.delete(operation) }
  }
  invalidateAccount(loginId) {
    this.nativeAuth.clear()
    for (const item of this.active) if (item.loginId !== loginId) item.controller.abort()
  }
  dispose() { this.lifetime.abort(); this.nativeAuth.clear() }
}
