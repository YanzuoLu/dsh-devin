import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import * as w from './wire.js'
import { metadata, nativeHeaders, nativeError, responseError, RPC } from './native.js'
import { contentHash } from './projection.js'

export function encodeChat({ access, jwt, wireModelId, projected, cascadeId, maxTokens = 32768, temperature = 1, stop = [] }) {
  const config = w.concat(w.integer(1, 1), w.integer(2, maxTokens), w.integer(3, 400), w.double(5, temperature),
    w.double(6, temperature), w.integer(7, 40), w.double(8, Math.fround(0.95)), ...stop.map(s => w.string(9, s)))
  const prompts = projected.messages.map(p => w.bytes(3, w.concat(w.string(1, p.messageId), w.integer(2, p.source),
    w.string(3, p.prompt), ...p.toolCalls.map(t => w.bytes(6, w.concat(w.string(1, t.id), w.string(2, t.name), w.string(3, t.arguments)))),
    w.string(7, p.toolCallId), p.isError ? w.integer(9, 1) : undefined,
    ...p.images.map(image => w.bytes(10, w.concat(w.string(1, image.data), w.string(2, image.mediaType)))),
    w.string(11, p.thinking), w.string(12, p.signature), w.string(18, p.signatureType))))
  const tools = projected.tools.map(t => w.bytes(10, w.concat(w.string(1, t.name), w.string(2, t.description), w.string(3, JSON.stringify(t.parameters)))))
  return w.concat(w.bytes(1, metadata(access, { jwt, sessionId: cascadeId })), w.string(2, projected.system), ...prompts,
    w.integer(7, 5), w.bytes(8, config), ...tools, w.integer(11, 0),
    w.bytes(12, w.string(1, 'auto')), w.bytes(13, w.integer(1, 1)), w.string(16, cascadeId),
    w.integer(20, 1), w.string(21, wireModelId), w.string(22, randomUUID()))
}
export function decodeChat(data) {
  const f = w.fields(data), u = w.raw(f, 7), usage = u ? w.fields(u) : undefined
  const count = n => w.number(usage, n) ?? 0
  return { text: w.text(f, 3), thinking: w.text(f, 9), signature: w.text(f, 10), signatureType: w.text(f, 21),
    messageId: w.text(f, 1), actualModelUid: w.text(f, 23), stop: w.number(f, 5) ?? 0,
    redacted: w.number(f, 8) === 1, thinkingRedacted: w.number(f, 11) === 1,
    ...(usage ? { usage: { inputTokens: count(2), outputTokens: count(3), cacheWriteTokens: count(4), cacheReadTokens: count(5),
      totalTokens: count(2) + count(3) + count(4) + count(5) } } : {}),
    calls: w.repeated(f, 6).map(value => { const call = w.fields(value); return { id: w.text(call, 1), name: w.text(call, 2), arguments: w.text(call, 3), invalid: Boolean(w.text(call, 4) || w.text(call, 5)) } }),
    quotaCost: w.number(f, 26), overageCents: w.number(f, 27),
  }
}
export function connectFrame(bytes, flags = 0) {
  const header = Buffer.alloc(5); header[0] = flags; header.writeUInt32BE(bytes.length, 1)
  return Buffer.concat([header, bytes])
}

export async function* connectMessages(body, signal, touch) {
  if (!body) throw new LlmError('Devin returned no native response stream.', 'INVALID_RESPONSE')
  const reader = body.getReader()
  let pending = Buffer.alloc(0), ended = false
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read(); touch?.()
      if (value) pending = Buffer.concat([pending, value])
      while (pending.length >= 5) {
        const flag = pending[0], size = pending.readUInt32BE(1)
        if (flag & ~3 || size > 32 * 1024 * 1024) throw new LlmError('Invalid Devin Connect frame.', 'INVALID_RESPONSE')
        if (pending.length < size + 5) break
        if (ended) throw new LlmError('Devin sent data after its terminal frame.', 'INVALID_RESPONSE')
        const encoded = pending.subarray(5, size + 5); pending = pending.subarray(size + 5)
        let payload
        try { payload = flag & 1 ? gunzipSync(encoded, { maxOutputLength: 32 * 1024 * 1024 }) : encoded }
        catch { throw new LlmError('Invalid compressed Devin response.', 'INVALID_RESPONSE') }
        if (flag & 2) {
          let trailer
          try { trailer = JSON.parse(payload.toString('utf8')) } catch { throw new LlmError('Invalid Devin completion trailer.', 'INVALID_RESPONSE') }
          if (trailer.error) throw nativeError(trailer.error.code, undefined, trailer.error.message)
          ended = true
        } else yield decodeChat(payload)
      }
      if (done) break
    }
    if (pending.length || !ended) throw new LlmError('Devin stream ended without a complete terminal frame.', 'INVALID_RESPONSE')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

const appendDelta = (previous, incoming) => incoming.startsWith(previous) ? incoming : previous + incoming
export async function* streamNative({ access, nativeSession, wireModelId, projected, cascadeId, options,
  signal, fetch: fetchImpl = globalThis.fetch, idleTimeoutMs = 180_000, onUnauthorized }) {
  const idle = new AbortController(), local = new AbortController()
  const active = AbortSignal.any([idle.signal, local.signal, ...(signal ? [signal] : [])])
  let timer
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(), idleTimeoutMs); timer.unref?.() }
  const blocks = [], calls = new Map()
  let activeCall, textBlock, thinkingBlock, lastThinking, stop = 0, usage, messageId, actualModelUid, quotaCost, overageCents
  touch()
  try {
    const request = encodeChat({ access, jwt: nativeSession.jwt, wireModelId, projected, cascadeId,
      maxTokens: options.maxTokens, temperature: options.temperature, stop: options.stop })
    const response = await fetchImpl(nativeSession.origin + RPC.chat, { method: 'POST', headers: nativeHeaders(access, true),
      body: connectFrame(gzipSync(request), 1), signal: active, redirect: 'error' })
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.()
      throw await responseError(response, active)
    }
    for await (const msg of connectMessages(response.body, active, touch)) {
      if (msg.redacted) throw new LlmError('Devin redacted the model response.', 'REFUSAL')
      if (msg.thinking) {
        textBlock = undefined
        if (!thinkingBlock) {
          thinkingBlock = { index: blocks.length, block: { type: 'reasoning', text: '' }, signature: '', signatureType: '' }; blocks.push(thinkingBlock)
          lastThinking = thinkingBlock
          yield { type: 'block-start', index: thinkingBlock.index, blockType: 'reasoning' }
        }
        thinkingBlock.block.text += msg.thinking
        yield { type: 'reasoning-delta', index: thinkingBlock.index, text: msg.thinking }
      }
      if (msg.signature && lastThinking) lastThinking.signature = appendDelta(lastThinking.signature, msg.signature)
      if (msg.signatureType && lastThinking) lastThinking.signatureType = msg.signatureType
      if (msg.thinkingRedacted && lastThinking) lastThinking.redacted = true
      if (msg.text) {
        thinkingBlock = undefined
        if (!textBlock) { textBlock = { index: blocks.length, block: { type: 'text', text: '' } }; blocks.push(textBlock); yield { type: 'block-start', index: textBlock.index, blockType: 'text' } }
        textBlock.block.text += msg.text
        yield { type: 'text-delta', index: textBlock.index, text: msg.text }
      }
      for (const delta of msg.calls) {
        textBlock = undefined; thinkingBlock = undefined
        if (delta.invalid) throw new LlmError('Devin returned invalid tool arguments.', 'INVALID_RESPONSE')
        const id = delta.id || activeCall
        if (!id) throw new LlmError('Devin tool fragment has no call identity.', 'INVALID_RESPONSE')
        let record = calls.get(id)
        if (!record) {
          record = { index: blocks.length, wireName: '', block: { type: 'tool-call', id: ToolCallId(id), name: '', arguments: '' } }
          calls.set(id, record); blocks.push(record)
          yield { type: 'block-start', index: record.index, blockType: 'tool-call' }
        }
        if (delta.name && record.wireName && record.wireName !== delta.name) throw new LlmError('Devin changed a tool identity.', 'INVALID_RESPONSE')
        activeCall = id
        if (delta.name) record.wireName = delta.name
        record.block.name = projected.names.get(record.wireName) ?? record.wireName
        const next = appendDelta(record.block.arguments, delta.arguments)
        const argumentsDelta = next.slice(record.block.arguments.length); record.block.arguments = next
        yield { type: 'tool-call-delta', index: record.index, id: record.block.id,
          ...(record.block.name ? { name: record.block.name } : {}), argumentsDelta }
      }
      if (msg.stop) stop = msg.stop
      if (msg.usage) usage = msg.usage
      if (msg.messageId) messageId = msg.messageId
      if (msg.actualModelUid) actualModelUid = msg.actualModelUid
      if (msg.quotaCost !== undefined) quotaCost = msg.quotaCost
      if (msg.overageCents !== undefined) overageCents = msg.overageCents
    }
    active.throwIfAborted()
    if ([1, 7, 9, 11, 13].includes(stop)) throw new LlmError('Devin did not complete the response normally.', stop === 11 ? 'REFUSAL' : 'INVALID_RESPONSE')
    if (!blocks.length) throw new LlmError('Devin returned an empty response.', 'EMPTY_RESPONSE')
    if (calls.size && stop === 3) throw new LlmError('Devin tool response was truncated.', 'INVALID_RESPONSE')
    for (const record of calls.values()) {
      if (!record.block.name) throw new LlmError('Devin tool call has no name.', 'INVALID_RESPONSE')
      if (!record.block.arguments) {
        record.block.arguments = '{}'
        yield { type: 'tool-call-delta', index: record.index, id: record.block.id, argumentsDelta: '{}' }
      }
      let args
      try { args = JSON.parse(record.block.arguments) } catch { throw new LlmError('Devin tool arguments are incomplete JSON.', 'INVALID_RESPONSE') }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new LlmError('Devin tool arguments must be an object.', 'INVALID_RESPONSE')
    }
    for (const record of blocks) yield { type: 'block-end', index: record.index, block: record.block }
    if (usage) yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: calls.size ? 'tool-calls' : stop === 3 ? 'max-tokens' : 'stop' },
      replayState: { response: { protocol: 'devin-native-v1', wireModelId, historyHash: projected.historyHash,
        ...(projected.accountScope ? { accountScope: projected.accountScope } : {}),
        ...(actualModelUid ? { actualModelUid } : {}), ...(messageId ? { messageId } : {}),
        ...(quotaCost === undefined ? {} : { quotaCost }), ...(overageCents === undefined ? {} : { overageCents }) }, 
      blocks: blocks.map(r => r.block.type === 'reasoning' && r.signature && !r.redacted
        ? { signature: r.signature, signatureType: r.signatureType, textHash: contentHash(r.block.text) } : null) } }
  } catch (error) {
    signal?.throwIfAborted()
    if (idle.signal.aborted) throw new LlmError('Devin native stream timed out.', 'TIMEOUT')
    if (error instanceof LlmError) { if (error.code === 'AUTH') onUnauthorized?.(); throw error }
    throw new LlmError('Devin native stream transport failed.', 'TRANSPORT')
  } finally { clearTimeout(timer); local.abort() }
}
