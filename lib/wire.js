import { LlmError } from '@deepseek-ai/dsh-llm'

const malformed = () => new LlmError('Invalid Devin protobuf message.', 'INVALID_RESPONSE')
export function varint(value) {
  let n = BigInt.asUintN(64, BigInt(value))
  const bytes = []
  do { let b = Number(n & 127n); n >>= 7n; if (n) b |= 128; bytes.push(b) } while (n)
  return Buffer.from(bytes)
}
export const concat = (...parts) => Buffer.concat(parts.filter(Boolean))
export const bytes = (n, value) => concat(varint(n * 8 + 2), varint(value.length), value)
export const string = (n, value) => value ? bytes(n, Buffer.from(value)) : Buffer.alloc(0)
export const integer = (n, value) => value === undefined ? Buffer.alloc(0) : concat(varint(n * 8), varint(value))
export function double(n, value) {
  if (value === undefined) return Buffer.alloc(0)
  const out = Buffer.alloc(8); out.writeDoubleLE(value)
  return concat(varint(n * 8 + 1), out)
}
export function fields(input) {
  const data = Buffer.from(input), out = []
  let at = 0
  const readVarint = () => {
    let value = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (at >= data.length) throw malformed()
      const b = data[at++]; value |= BigInt(b & 127) << shift
      if (!(b & 128)) return value
    }
    throw malformed()
  }
  while (at < data.length) {
    const tag = Number(readVarint()), n = tag >>> 3, wire = tag & 7
    if (!n) throw malformed()
    let value
    if (wire === 0) value = readVarint()
    else {
      const length = wire === 2 ? Number(readVarint()) : wire === 1 ? 8 : wire === 5 ? 4 : -1
      if (!Number.isSafeInteger(length) || length < 0 || at + length > data.length) throw malformed()
      value = data.subarray(at, at + length); at += length
    }
    out.push({ n, wire, value })
  }
  return out
}
export const raw = (items, n) => items.find(f => f.n === n && f.wire === 2)?.value
export const text = (items, n) => raw(items, n)?.toString('utf8') ?? ''
export const number = (items, n) => {
  const value = items.find(f => f.n === n && f.wire === 0)?.value
  return value === undefined ? undefined : Number(value)
}
export const nested = (items, n) => fields(raw(items, n) ?? Buffer.alloc(0))
export const repeated = (items, n) => items.filter(f => f.n === n && f.wire === 2).map(f => f.value)
