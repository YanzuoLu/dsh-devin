import { createHash } from 'node:crypto'
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import { LlmError, projectToolUpdates, projectOffloadedImages, offloadedImageText, textOnlyImageText,
  requestImageHandleText, requiredImageOffload, fileHandleText, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'

export const IMAGE_BUDGET = Object.freeze({ representation: 'base64', maxBytes: 20 * 1024 * 1024 })
export const contentHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const wireToolName = name => /^[a-zA-Z0-9_-]{1,64}$/u.test(name) ? name : `dsh_${contentHash(name).slice(0, 48)}`
export function requestHash(options, messages = options.messages ?? []) {
  return contentHash({ system: options.system, messages: messages.map(m => ({ role: m.role, content: m.content,
    ...(m.role === 'tool' ? { toolCallId: m.toolCallId, isError: m.isError === true } : {}) })) })
}
export function stableId(value) {
  const h = contentHash(value).slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`
}

/** Serialize only DSH's effective request. No provider-side agent context is retained. */
export async function projectRequest(options, entry, wireModelId, { attachments, mapHostPath, accountScope, signal = options.signal } = {}) {
  const auxiliary = options.purpose === 'compaction' || options.purpose === 'session-title'
  const projected = projectToolUpdates(options.messages ?? [], options.tools, undefined, options.toolHistory)
  const access = attachments && mapHostPath ? ref => resolveImageAttachmentAccess(attachments, mapHostPath, ref) : () => undefined
  const messages = projectOffloadedImages(projected.messages, ref => offloadedImageText(ref, access(ref)))
  const versions = new Map(), vision = entry.info.inputModalities?.includes('image') && !auxiliary
  if (vision) {
    for (const message of messages) for (const block of message.content) {
      if (block.type !== 'image' || versions.has(block.attachment.attachmentId)) continue
      signal?.throwIfAborted()
      if (!attachments) throw new LlmError('Image input requires the DSH attachment service.', 'UNSUPPORTED_CONTENT')
      const ref = block.attachment, target = { ...requestImageDimensions(ref.width, ref.height, 2048 * 2048), maxBytes: 1024 * 1024 }
      versions.set(ref.attachmentId, await attachments.readImageRequest(ref, target, signal))
    }
    const count = requiredImageOffload(messages, IMAGE_BUDGET, block => versions.get(block.attachment.attachmentId).data.byteLength)
    if (count) throw new LlmError('Devin request images need native offloading.', 'IMAGE_OFFLOAD_REQUIRED', { offloadImages: count })
  }
  const names = new Map()
  const tools = auxiliary ? [] : (projected.tools ?? []).map(tool => {
    const name = wireToolName(tool.name); names.set(name, tool.name)
    return { name, description: tool.description, parameters: tool.parameters }
  })
  const out = [], system = options.system ? [options.system] : []
  for (const [index, message] of messages.entries()) {
    signal?.throwIfAborted()
    const texts = [], images = [], toolCalls = []
    for (const block of message.content) {
      switch (block.type) {
        case 'text': texts.push(block.text); break
        case 'reasoning': break
        case 'file': texts.push(fileHandleText(block.attachment, undefined)); break
        case 'image': {
          if (!vision) { texts.push(textOnlyImageText(block.attachment)); break }
          if (!['user', 'tool'].includes(message.role)) throw new LlmError('Devin cannot replay assistant image output.', 'UNSUPPORTED_CONTENT')
          const version = versions.get(block.attachment.attachmentId)
          texts.push(requestImageHandleText(block.attachment, version, access(block.attachment)))
          images.push({ data: Buffer.from(version.data).toString('base64'), mediaType: version.mediaType })
          break
        }
        case 'tool-call':
          if (auxiliary) texts.push(JSON.stringify(block))
          else { names.set(wireToolName(block.name), block.name); toolCalls.push({ id: String(block.id), name: wireToolName(block.name), arguments: block.arguments }) }
          break
        case 'tool-addition': case 'tool-removal': break
        default: throw new LlmError(`Unsupported Devin content block ${block.type}.`, 'UNSUPPORTED_CONTENT')
      }
    }
    if (message.role === 'system') { if (texts.length) system.push(texts.join('\n')); continue }
    if (message.role === 'developer' && !texts.length) continue
    const prompt = texts.join('\n')
    const source = message.role === 'assistant' ? 2 : message.role === 'tool' && !auxiliary ? 4 : 1
    const raw = options.messages?.findIndex(m => m === projected.messages[index]) ?? -1
    const envelope = message.source?.provider === 'devin' ? message.source.replayState : undefined
    const replay = envelope?.response
    const compatible = !auxiliary && replay?.protocol === 'devin-native-v1' && replay.wireModelId === wireModelId
      && replay.accountScope === accountScope
      && replay.historyHash === requestHash(options, options.messages.slice(0, raw >= 0 ? raw : index))
    const signed = compatible && envelope.blocks?.length === message.content.length
      ? message.content.flatMap((block, i) => block.type === 'reasoning' && envelope.blocks[i]?.signature
        && envelope.blocks[i].textHash === contentHash(block.text) ? [{ block, metadata: envelope.blocks[i] }] : []) : []
    out.push({ messageId: compatible && replay.messageId ? replay.messageId : stableId([message.id ?? index, message.role, message.toolCallId]), source,
      prompt: message.role === 'tool' && auxiliary ? JSON.stringify({ type: 'tool-result', toolCallId: message.toolCallId, isError: message.isError === true, text: prompt }) : prompt,
      toolCalls, images,
      ...(message.role === 'tool' && !auxiliary ? { toolCallId: String(message.toolCallId), isError: message.isError === true } : {}),
      ...(signed.length === 1 ? { thinking: signed[0].block.text, signature: signed[0].metadata.signature, signatureType: signed[0].metadata.signatureType } : {}),
    })
  }
  return { system: system.join('\n\n'), messages: out, tools, names, historyHash: requestHash(options), accountScope }
}
