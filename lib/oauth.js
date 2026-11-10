import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { AUTH_API, WEBAPP, fetchJSON } from './http.js'

export const TOKEN_PREFIX = 'devin-session-token$'

export function tokenExpiry(access) {
  const jwt = access.startsWith(TOKEN_PREFIX) ? access.slice(TOKEN_PREFIX.length) : access
  try {
    const { exp } = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined
  } catch { return undefined }
}

/** Temporary loopback callback only. Never opens applications or executes a CLI. */
export async function loginDevin({ signal, notify, fetch: fetchImpl, webapp = WEBAPP, api = AUTH_API }) {
  signal?.throwIfAborted()
  const timeout = AbortSignal.timeout(10 * 60_000)
  const active = AbortSignal.any([timeout, ...(signal ? [signal] : [])])
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(24).toString('base64url')
  const result = Promise.withResolvers()
  result.promise.catch(() => {})
  let accepted = false
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      response.writeHead(404).end('Not found'); return
    }
    if (accepted || url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
      response.writeHead(400).end('Invalid or expired login callback. Return to DSH and try again.'); return
    }
    accepted = true
    response.end('Authorization received. Return to DSH to check completion. You can close this tab.')
    result.resolve(url.searchParams.get('code'))
  })
  const abort = () => result.reject(active.reason)
  active.addEventListener('abort', abort, { once: true })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    active.throwIfAborted()
    const url = new URL('/auth/cli/continue', webapp)
    url.searchParams.set('redirect_uri', `http://127.0.0.1:${server.address().port}/callback`)
    url.searchParams.set('state', state)
    url.searchParams.set('prompt', 'select_account')
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
    url.searchParams.set('code_challenge_method', 'S256')
    await notify({ url: url.href, message: '请打开 Devin 登录页面。授权完成后会自动返回本机，不需要把令牌发到聊天里。' })
    const code = await result.promise
    active.throwIfAborted()
    const body = await fetchJSON(`${api}/auth/cli/token`, { signal: active, fetch: fetchImpl,
      body: { code, code_verifier: verifier } })
    if (typeof body?.token !== 'string' || !body.token || /[\s\r\n]/u.test(body.token)) {
      throw new LlmError('Devin login response did not include a valid token.', 'INVALID_RESPONSE')
    }
    const access = body.token.startsWith(TOKEN_PREFIX) ? body.token : TOKEN_PREFIX + body.token
    return { access, ...(tokenExpiry(access) ? { expires: tokenExpiry(access) } : {}) }
  } finally {
    active.removeEventListener('abort', abort)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
