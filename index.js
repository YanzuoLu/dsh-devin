import { z } from 'zod'
import schema from '@deepseek-ai/schemastery'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { RetryPolicySchema, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { DevinAdapter } from './lib/adapter.js'
import { createDevinAuth } from './lib/auth.js'
import { createDevinCatalog } from './lib/catalog.js'
import { createProviderLogin } from './lib/provider-login.js'
import { mountProviderLoginRoutes } from './lib/provider-login-routes.js'

export const name = 'devin'
export const inject = ['llm', 'credentials', 'authorization', 'storageDomain']
export { DevinAdapter } from './lib/adapter.js'
export const Config = schema.object({ retryPolicy: RetryPolicySchema.description('Devin model request retry policy') })
const DEFAULT_RETRY = { mode: 'normal', maxRetries: 35,
  retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'INVALID_RESPONSE'],
  backoff: { initialDelayMs: 2000, maxDelayMs: 120000, jitterRatio: 0.1 } }
const cacheSpec = defineDomain({ name: 'devin_catalog', version: 1, invalidRecords: 'backup-and-skip',
  tables: { cache: domainTable(z.object({ loginId: z.string(), checkedAt: z.number(), rows: z.array(z.unknown()), format: z.literal('native-v1').optional() })) } })

export async function apply(ctx, config) {
  return ctx.effect(async function* () {
    const domain = await ctx.storageDomain.open(cacheSpec)
    yield () => domain.close()
    const records = domain.table('cache'), lifetime = new AbortController(), tasks = new Set()
    const auth = createDevinAuth(ctx)
    let catalog, adapter, controller, accountTail = Promise.resolve()
    yield async () => {
      lifetime.abort(); auth.dispose(); adapter?.dispose()
      await controller?.dispose()
      await catalog?.dispose()
      await accountTail
      await Promise.allSettled(tasks)
    }
    const initial = await auth.metadata()
    yield undefined
    const persisted = records.get('default')
    catalog = createDevinCatalog(auth, { cached: initial.configured && persisted?.loginId === initial.loginId ? persisted : undefined,
      save: value => value === null ? records.delete('default') : records.put('default', value) })
    adapter = new DevinAdapter(ctx, auth, catalog, { retryPolicy: resolveRetryPolicy(config?.retryPolicy ?? DEFAULT_RETRY, 'devin.retryPolicy') })
    controller = createProviderLogin(ctx, { provider: 'devin', label: 'Devin', recordKey: auth.key, allowedAuthHosts: ['app.devin.ai'] })
    let observedLoginId = initial.loginId, loads = 0, catalogError
    const baseStatus = controller.status
    controller.status = async () => {
      const [status, metadata] = await Promise.all([baseStatus(), auth.metadata()])
      return { ...status, needsLogin: metadata.needsLogin, catalog: { models: catalog.entries().length, loading: loads > 0,
        ...(catalogError ? { error: catalogError } : {}) } }
    }
    const notify = () => ctx.emit('llm/adapters-updated')
    const track = work => {
      const task = Promise.resolve().then(work); tasks.add(task)
      task.finally(() => tasks.delete(task)).catch(() => {})
      return task
    }
    const syncAccount = () => {
      const task = accountTail.then(async () => {
        const metadata = await auth.metadata()
        if (metadata.loginId === observedLoginId) return
        observedLoginId = metadata.loginId; catalogError = undefined
        adapter.invalidateAccount(metadata.loginId)
        await catalog.clear()
        if (!lifetime.signal.aborted) notify()
      })
      accountTail = task.catch(() => {}); return task
    }
    const refreshModels = signal => track(async () => {
      const active = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])])
      await syncAccount(); active.throwIfAborted()
      loads++; catalogError = undefined
      try { await catalog.refresh(active); active.throwIfAborted(); notify() }
      catch (error) {
        if (!active.aborted) catalogError = error.code === 'AUTH' ? '登录已失效，请重新登录。'
          : error.code === 'PERMISSION' ? '账户没有原生模型访问权限，请核对 Devin 组织和套餐。' : '模型目录读取失败，请刷新模型重试。'
        throw error
      } finally { loads-- }
    })
    yield auth.registerFlow()
    yield ctx.llm.registerAdapter(['devin'], adapter)
    yield ctx.on('credentials/record-updated', key => {
      if (key === auth.key && !lifetime.signal.aborted) return track(syncAccount)
    })
    yield ctx.on('authorization/settled', (key, settlement) => {
      if (key !== auth.key || settlement !== 'authorized' || lifetime.signal.aborted) return
      return refreshModels(lifetime.signal).catch(() => {
        if (!lifetime.signal.aborted) ctx.logger.warn('devin: model directory refresh failed after login')
      })
    })
    const routes = ctx.inject(['connection'], child => child.effect(
      () => mountProviderLoginRoutes(child, controller, { apiPath: '/api/dsh-devin', refreshModels }), 'Devin native login routes'))
    yield () => routes.dispose()
  }, 'Devin provider lifetime')
}
