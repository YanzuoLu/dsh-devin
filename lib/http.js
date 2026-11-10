import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'

export const AUTH_API = 'https://api.devin.ai'
export const WEBAPP = 'https://app.devin.ai'

export function headers(access) {
  return { ...attributionHeaders(), Accept: 'application/json', 'Content-Type': 'application/json',
    ...(access ? { Authorization: `Bearer ${access}` } : {}) }
}

export async function checkResponse(response, onUnauthorized) {
  if (response.ok) return
  if (response.status === 401) onUnauthorized?.()
  const code = response.status === 401 ? 'AUTH' : response.status === 403 ? 'PERMISSION'
    : response.status === 429 ? 'RATE_LIMIT' : response.status >= 500 ? 'SERVER' : 'INVALID_REQUEST'
  const retry = response.headers.get('retry-after')
  const delay = retry ? (/^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : undefined
  await response.body?.cancel()
  // Provider error bodies can echo prompts or credentials. Only publish routing facts.
  throw new LlmError(`Devin authentication API returned HTTP ${response.status}${code === 'AUTH' ? '; please sign in again' : ''}.`, code,
    { status: response.status, ...(Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {}) })
}

export async function fetchJSON(url, { access, signal, fetch: fetchImpl = globalThis.fetch, body, onUnauthorized }) {
  const deadline = AbortSignal.timeout(30_000)
  const combined = AbortSignal.any([deadline, ...(signal ? [signal] : [])])
  try {
    const response = await fetchImpl(url, { method: body === undefined ? 'GET' : 'POST', headers: headers(access),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: combined, redirect: 'error' })
    await checkResponse(response, onUnauthorized)
    try { return await response.json() } catch (error) {
      combined.throwIfAborted()
      throw new LlmError('Devin returned invalid JSON.', 'INVALID_RESPONSE')
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (deadline.aborted) throw new LlmError('Devin request timed out.', 'TIMEOUT')
    if (error instanceof LlmError) throw error
    throw new LlmError('Unable to reach Devin.', 'TRANSPORT')
  }
}
