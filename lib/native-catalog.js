import * as w from './wire.js'
import { RPC, unary } from './native.js'

/** Decode only picker and capability fields, never internal provider URLs. */
export function decodeModels(data) {
  return w.repeated(w.fields(data), 1).map(value => {
    const row = w.fields(value), info = w.nested(row, 23), features = w.nested(info, 6), family = w.nested(row, 30)
    const labels = Object.fromEntries(w.repeated(family, 2).map(value => {
      const pair = w.fields(value), detail = w.nested(pair, 2)
      return [w.text(pair, 1), { name: w.text(detail, 2), order: w.number(detail, 1) ?? 0 }]
    }))
    return { id: w.text(row, 22), name: w.text(row, 1), familyId: w.text(info, 23), familyName: w.text(family, 1), labels,
      disabled: w.number(row, 4) === 1, supportsImages: (w.number(row, 5) ?? w.number(features, 11)) === 1,
      context: w.number(row, 18) ?? w.number(info, 4), maxOutput: w.number(info, 13),
      isDefault: w.number(row, 31) === 1 || w.number(family, 3) === 1,
      internal: w.number(info, 2) === 1, displaySlot: w.number(info, 22), router: w.number(info, 25) === 1,
      harnesses: w.repeated(info, 20).map(value => value.toString('utf8')) }
  }).filter(row => row.id)
}
export async function fetchNativeModels(options) { return decodeModels(await unary(RPC.models, options)) }
