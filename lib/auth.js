import { randomUUID } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { loginDevin } from './oauth.js'

export const DEVIN_GRANT_KEY = credentialKey('dsh-devin', 'default')
function grantOf(record) {
  const grant = record?.kind === 'grant' ? record.payload : undefined
  return grant?.type === 'oauth' && typeof grant.loginId === 'string' && grant.loginId
    && typeof grant.access === 'string' && grant.access && !/[^\x21-\x7e]/.test(grant.access)
    && (grant.expires === undefined || Number.isFinite(grant.expires)) ? grant : undefined
}

/** Native credential owner. Devin's session-token flow has no refresh token. */
export function createDevinAuth(ctx, { login = loginDevin, fetch } = {}) {
  const lifetime = new AbortController()
  let rejectedLoginId, unregister
  async function metadata() {
    const grant = grantOf(await ctx.credentials.readRecord(DEVIN_GRANT_KEY))
    return { key: DEVIN_GRANT_KEY, configured: Boolean(grant),
      ...(grant ? { loginId: grant.loginId, ...(grant.expires ? { expires: grant.expires } : {}) } : {}),
      needsLogin: !grant || grant.loginId === rejectedLoginId || grant.expires <= Date.now() }
  }
  async function getGrant(signal) {
    signal?.throwIfAborted(); lifetime.signal.throwIfAborted()
    const grant = grantOf(await ctx.credentials.readRecord(DEVIN_GRANT_KEY))
    signal?.throwIfAborted(); lifetime.signal.throwIfAborted()
    if (!grant || grant.loginId === rejectedLoginId || grant.expires <= Date.now()) {
      throw new LlmError('Please sign in to Devin in DSH settings.', 'AUTH')
    }
    return Object.freeze({ ...grant })
  }
  function registerFlow() {
    if (unregister) return unregister
    unregister = ctx.authorization.registerFlow({ key: DEVIN_GRANT_KEY, label: 'Devin',
      methods: [{ id: 'oauth', label: '浏览器登录' }],
      async run(session) {
        const signal = AbortSignal.any([session.signal, lifetime.signal])
        const tokens = await login({ signal, notify: notice => session.notify(notice), fetch })
        signal.throwIfAborted()
        const payload = { type: 'oauth', loginId: randomUUID(), ...tokens }
        if (!grantOf({ kind: 'grant', payload })) throw new LlmError('Invalid Devin login response.', 'INVALID_RESPONSE')
        await session.commit({ kind: 'grant', payload })
        rejectedLoginId = undefined
      },
    })
    return unregister
  }
  return { key: DEVIN_GRANT_KEY, metadata, getGrant, registerFlow,
    reject(grant) { rejectedLoginId = grant.loginId },
    dispose() { lifetime.abort(); unregister?.(); unregister = undefined },
  }
}
