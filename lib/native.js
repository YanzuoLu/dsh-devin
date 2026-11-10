import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { attributionHeaders, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmError } from '@deepseek-ai/dsh-llm'
import * as wire from './wire.js'
import { tokenExpiry } from './oauth.js'

export const NATIVE_ORIGIN = 'https://server.codeium.com'
export const RPC = Object.freeze({
  models: '/exa.api_server_pb.ApiServerService/GetCliModelConfigs',
  auth: '/exa.auth_pb.AuthService/GetUserJwt',
  chat: '/exa.api_server_pb.ApiServerService/GetChatMessage',
  status: '/exa.seat_management_pb.SeatManagementService/GetUserStatus',
  organizations: '/exa.seat_management_pb.SeatManagementService/GetEligibleDevinOrganizations',
})
export function metadata(access, { jwt, sessionId = randomUUID() } = {}) {
  return wire.concat(wire.string(1, 'devin-cli'), wire.string(2, '3000.11.3'), wire.string(3, access),
    wire.string(4, 'en'), wire.string(5, process.platform), wire.integer(9, Date.now()), wire.string(10, sessionId),
    wire.string(7, '3000.11.3'), wire.string(12, 'chisel'), wire.string(21, jwt), wire.string(28, 'chisel'))
}
export function nativeHeaders(access, stream = false) {
  return { ...attributionHeaders(), Accept: '*/*', 'Content-Type': stream ? 'application/connect+proto' : 'application/proto',
    'Connect-Protocol-Version': '1', 'User-Agent': 'devin-cli/3000.11.3',
    ...(access ? { Authorization: `Bearer ${access}` } : {}),
    ...(stream ? { 'Connect-Content-Encoding': 'gzip', 'Connect-Accept-Encoding': 'gzip' } : {}),
  }
}
// Service wording the native client classifies; generic DSH classifiers miss Anthropic's "prompt is too long".
const ACCOUNT_LIMIT = /monthly acu limit reached|organization usage limit reached|usage frozen by an administrator|usage quota has been exhausted/iu
const CONTENT_POLICY = /refused by \S+ content policy|flagged by \S+ cyber (?:verification )?policy|flagged for potentially suspicious/iu
/** Connect error envelope or trailer, keeping the service explanation that routes recovery. */
export function nativeError(code, status, message = '') {
  const text = typeof message === 'string' ? message.replace(/devin-session-token\$\S+|eyJ[\w-]+\.[\w-]+\.[\w-]*/gu, '[redacted]')
    .replace(/\s+/gu, ' ').trim().slice(0, 500) : ''
  const detail = `${code ?? ''} ${text}`
  const mapped = isQuotaExceededError(detail) || ACCOUNT_LIMIT.test(text) ? 'QUOTA'
    : /\bprompt is too long\b/iu.test(text) || isContextWindowExceededError(detail) ? CONTEXT_WINDOW_EXCEEDED_CODE
    : CONTENT_POLICY.test(text) ? 'REFUSAL'
    : { unauthenticated: 'AUTH', permission_denied: 'PERMISSION', resource_exhausted: 'RATE_LIMIT',
      unavailable: 'SERVER', internal: 'SERVER', deadline_exceeded: 'TIMEOUT', invalid_argument: 'INVALID_REQUEST',
      not_found: 'DEVIN_MODEL_UNAVAILABLE', failed_precondition: 'INVALID_REQUEST' }[code] ?? 'INVALID_RESPONSE'
  return new LlmError(`Devin native request failed (${code || 'unknown'})${text ? `: ${text}` : '.'}`, mapped, status ? { status } : {})
}
/** Read a non-OK Connect response body without masking cancellation. */
export async function responseError(response, signal) {
  let body
  try { body = await response.json() } catch { signal.throwIfAborted() }
  const code = body?.code ?? (response.status === 401 ? 'unauthenticated' : response.status === 403 ? 'permission_denied'
    : response.status >= 500 ? 'unavailable' : 'invalid_argument')
  return nativeError(code, response.status, body?.message)
}
export async function unary(path, { access, payload = wire.bytes(1, metadata(access)), signal, fetch: fetchImpl = globalThis.fetch, origin = NATIVE_ORIGIN }) {
  const deadline = AbortSignal.timeout(30_000)
  const active = AbortSignal.any([deadline, ...(signal ? [signal] : [])])
  let response
  try {
    response = await fetchImpl(origin + path, { method: 'POST', headers: nativeHeaders(access), body: payload, signal: active, redirect: 'error' })
    if (!response.ok) throw await responseError(response, active)
    const body = Buffer.from(await response.arrayBuffer())
    return body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body
  } catch (error) {
    signal?.throwIfAborted()
    if (deadline.aborted) throw new LlmError('Devin native request timed out.', 'TIMEOUT')
    if (error instanceof LlmError) throw error
    throw new LlmError('Unable to reach Devin native service.', 'TRANSPORT')
  }
}

export async function accountStatus(options) {
  const root = wire.fields(await unary(RPC.status, options))
  const user = wire.nested(root, 1), quota = wire.nested(user, 13), nested = wire.nested(quota, 1)
  // The billing organization lives in the user's plan status; the top-level plan copy may omit it.
  const plan = wire.nested(nested, 33).length ? nested : wire.nested(root, 2), devin = wire.nested(plan, 33)
  return { orgId: wire.text(devin, 4) || wire.text(user, 5), orgName: wire.text(devin, 8), plan: wire.text(plan, 2),
    ...(wire.number(devin, 2) === undefined ? {} : { canUseCli: wire.number(devin, 2) === 1 }),
    ...(wire.number(devin, 1) === undefined ? {} : { canUseCascade: wire.number(devin, 1) === 1 }),
    billingStrategy: wire.number(plan, 35), dailyRemainingPercent: wire.number(quota, 14), weeklyRemainingPercent: wire.number(quota, 15) }
}
export async function eligibleOrganizations(options) {
  const root = wire.fields(await unary(RPC.organizations, { ...options, payload: Buffer.alloc(0) }))
  return wire.repeated(root, 1).map(value => {
    const org = wire.fields(value)
    return { id: wire.text(org, 1), name: wire.text(org, 2), canUseCli: wire.number(org, 5) === 1, canUseCascade: wire.number(org, 6) === 1 }
  })
}

/** Short-lived native JWTs never leave memory or survive account invalidation. */
export function createNativeAuth({ fetch, origin = NATIVE_ORIGIN } = {}) {
  const cache = new Map()
  return {
    async resolve(grant, signal) {
      const existing = cache.get(grant.loginId)
      if (existing?.access === grant.access && existing.expires > Date.now() + 60_000) return existing
      const root = wire.fields(await unary(RPC.auth, { access: grant.access, signal, fetch, origin }))
      const jwt = wire.text(root, 1), custom = wire.text(root, 2)
      if (!jwt) throw new LlmError('Devin native authentication returned no session JWT.', 'AUTH')
      const base = custom ? new URL(custom) : new URL(origin)
      if ((base.protocol !== 'https:' && base.hostname !== '127.0.0.1') || base.username || base.password || base.search || base.hash) {
        throw new LlmError('Devin returned an invalid native service origin.', 'INVALID_RESPONSE')
      }
      const value = { access: grant.access, jwt, expires: tokenExpiry(jwt) ?? Date.now() + 300_000, origin: base.origin }
      signal?.throwIfAborted()
      cache.set(grant.loginId, value)
      return value
    },
    clear() { cache.clear() },
  }
}
