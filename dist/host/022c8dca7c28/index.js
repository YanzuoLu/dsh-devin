// index.js
import { z } from "zod";
import schema from "@deepseek-ai/schemastery";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { RetryPolicySchema, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";

// lib/adapter.js
import { LlmAdapter, LlmError as LlmError7 } from "@deepseek-ai/dsh-llm";

// lib/native.js
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { attributionHeaders as attributionHeaders2, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmError as LlmError4 } from "@deepseek-ai/dsh-llm";

// lib/wire.js
import { LlmError } from "@deepseek-ai/dsh-llm";
var malformed = () => new LlmError("Invalid Devin protobuf message.", "INVALID_RESPONSE");
function varint(value) {
  let n = BigInt.asUintN(64, BigInt(value));
  const bytes2 = [];
  do {
    let b = Number(n & 127n);
    n >>= 7n;
    if (n) b |= 128;
    bytes2.push(b);
  } while (n);
  return Buffer.from(bytes2);
}
var concat = (...parts) => Buffer.concat(parts.filter(Boolean));
var bytes = (n, value) => concat(varint(n * 8 + 2), varint(value.length), value);
var string = (n, value) => value ? bytes(n, Buffer.from(value)) : Buffer.alloc(0);
var integer = (n, value) => value === void 0 ? Buffer.alloc(0) : concat(varint(n * 8), varint(value));
function double(n, value) {
  if (value === void 0) return Buffer.alloc(0);
  const out = Buffer.alloc(8);
  out.writeDoubleLE(value);
  return concat(varint(n * 8 + 1), out);
}
function fields(input) {
  const data = Buffer.from(input), out = [];
  let at = 0;
  const readVarint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (at >= data.length) throw malformed();
      const b = data[at++];
      value |= BigInt(b & 127) << shift;
      if (!(b & 128)) return value;
    }
    throw malformed();
  };
  while (at < data.length) {
    const tag = Number(readVarint()), n = tag >>> 3, wire = tag & 7;
    if (!n) throw malformed();
    let value;
    if (wire === 0) value = readVarint();
    else {
      const length = wire === 2 ? Number(readVarint()) : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (!Number.isSafeInteger(length) || length < 0 || at + length > data.length) throw malformed();
      value = data.subarray(at, at + length);
      at += length;
    }
    out.push({ n, wire, value });
  }
  return out;
}
var raw = (items, n) => items.find((f) => f.n === n && f.wire === 2)?.value;
var text = (items, n) => raw(items, n)?.toString("utf8") ?? "";
var number = (items, n) => {
  const value = items.find((f) => f.n === n && f.wire === 0)?.value;
  return value === void 0 ? void 0 : Number(value);
};
var nested = (items, n) => fields(raw(items, n) ?? Buffer.alloc(0));
var repeated = (items, n) => items.filter((f) => f.n === n && f.wire === 2).map((f) => f.value);

// lib/oauth.js
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { LlmError as LlmError3 } from "@deepseek-ai/dsh-llm";

// lib/http.js
import { attributionHeaders, LlmError as LlmError2 } from "@deepseek-ai/dsh-llm";
var AUTH_API = "https://api.devin.ai";
var WEBAPP = "https://app.devin.ai";
function headers(access) {
  return {
    ...attributionHeaders(),
    Accept: "application/json",
    "Content-Type": "application/json",
    ...access ? { Authorization: `Bearer ${access}` } : {}
  };
}
async function checkResponse(response, onUnauthorized) {
  if (response.ok) return;
  if (response.status === 401) onUnauthorized?.();
  const code = response.status === 401 ? "AUTH" : response.status === 403 ? "PERMISSION" : response.status === 429 ? "RATE_LIMIT" : response.status >= 500 ? "SERVER" : "INVALID_REQUEST";
  const retry = response.headers.get("retry-after");
  const delay = retry ? /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1e3 : Date.parse(retry) - Date.now() : void 0;
  await response.body?.cancel();
  throw new LlmError2(
    `Devin authentication API returned HTTP ${response.status}${code === "AUTH" ? "; please sign in again" : ""}.`,
    code,
    { status: response.status, ...Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {} }
  );
}
async function fetchJSON(url, { access, signal, fetch: fetchImpl = globalThis.fetch, body, onUnauthorized }) {
  const deadline = AbortSignal.timeout(3e4);
  const combined = AbortSignal.any([deadline, ...signal ? [signal] : []]);
  try {
    const response = await fetchImpl(url, {
      method: body === void 0 ? "GET" : "POST",
      headers: headers(access),
      ...body === void 0 ? {} : { body: JSON.stringify(body) },
      signal: combined,
      redirect: "error"
    });
    await checkResponse(response, onUnauthorized);
    try {
      return await response.json();
    } catch (error) {
      combined.throwIfAborted();
      throw new LlmError2("Devin returned invalid JSON.", "INVALID_RESPONSE");
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new LlmError2("Devin request timed out.", "TIMEOUT");
    if (error instanceof LlmError2) throw error;
    throw new LlmError2("Unable to reach Devin.", "TRANSPORT");
  }
}

// lib/oauth.js
var TOKEN_PREFIX = "devin-session-token$";
function tokenExpiry(access) {
  const jwt = access.startsWith(TOKEN_PREFIX) ? access.slice(TOKEN_PREFIX.length) : access;
  try {
    const { exp } = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    return Number.isFinite(exp) && exp > 0 ? exp * 1e3 : void 0;
  } catch {
    return void 0;
  }
}
async function loginDevin({ signal, notify, fetch: fetchImpl, webapp = WEBAPP, api = AUTH_API }) {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(10 * 6e4);
  const active = AbortSignal.any([timeout, ...signal ? [signal] : []]);
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const result = Promise.withResolvers();
  result.promise.catch(() => {
  });
  let accepted = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET" || url.pathname !== "/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (accepted || url.searchParams.get("state") !== state || !url.searchParams.get("code")) {
      response.writeHead(400).end("Invalid or expired login callback. Return to DSH and try again.");
      return;
    }
    accepted = true;
    response.end("Authorization received. Return to DSH to check completion. You can close this tab.");
    result.resolve(url.searchParams.get("code"));
  });
  const abort = () => result.reject(active.reason);
  active.addEventListener("abort", abort, { once: true });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    active.throwIfAborted();
    const url = new URL("/auth/cli/continue", webapp);
    url.searchParams.set("redirect_uri", `http://127.0.0.1:${server.address().port}/callback`);
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    await notify({ url: url.href, message: "\u8BF7\u6253\u5F00 Devin \u767B\u5F55\u9875\u9762\u3002\u6388\u6743\u5B8C\u6210\u540E\u4F1A\u81EA\u52A8\u8FD4\u56DE\u672C\u673A\uFF0C\u4E0D\u9700\u8981\u628A\u4EE4\u724C\u53D1\u5230\u804A\u5929\u91CC\u3002" });
    const code = await result.promise;
    active.throwIfAborted();
    const body = await fetchJSON(`${api}/auth/cli/token`, {
      signal: active,
      fetch: fetchImpl,
      body: { code, code_verifier: verifier }
    });
    if (typeof body?.token !== "string" || !body.token || /[\s\r\n]/u.test(body.token)) {
      throw new LlmError3("Devin login response did not include a valid token.", "INVALID_RESPONSE");
    }
    const access = body.token.startsWith(TOKEN_PREFIX) ? body.token : TOKEN_PREFIX + body.token;
    return { access, ...tokenExpiry(access) ? { expires: tokenExpiry(access) } : {} };
  } finally {
    active.removeEventListener("abort", abort);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// lib/native.js
var NATIVE_ORIGIN = "https://server.codeium.com";
var RPC = Object.freeze({
  models: "/exa.api_server_pb.ApiServerService/GetCliModelConfigs",
  auth: "/exa.auth_pb.AuthService/GetUserJwt",
  chat: "/exa.api_server_pb.ApiServerService/GetChatMessage",
  status: "/exa.seat_management_pb.SeatManagementService/GetUserStatus",
  organizations: "/exa.seat_management_pb.SeatManagementService/GetEligibleDevinOrganizations"
});
function metadata(access, { jwt, sessionId = randomUUID() } = {}) {
  return concat(
    string(1, "devin-cli"),
    string(2, "3000.11.3"),
    string(3, access),
    string(4, "en"),
    string(5, process.platform),
    integer(9, Date.now()),
    string(10, sessionId),
    string(7, "3000.11.3"),
    string(12, "chisel"),
    string(21, jwt),
    string(28, "chisel")
  );
}
function nativeHeaders(access, stream = false) {
  return {
    ...attributionHeaders2(),
    Accept: "*/*",
    "Content-Type": stream ? "application/connect+proto" : "application/proto",
    "Connect-Protocol-Version": "1",
    "User-Agent": "devin-cli/3000.11.3",
    ...access ? { Authorization: `Bearer ${access}` } : {},
    ...stream ? { "Connect-Content-Encoding": "gzip", "Connect-Accept-Encoding": "gzip" } : {}
  };
}
var ACCOUNT_LIMIT = /monthly acu limit reached|organization usage limit reached|usage frozen by an administrator|usage quota has been exhausted/iu;
var CONTENT_POLICY = /refused by \S+ content policy|flagged by \S+ cyber (?:verification )?policy|flagged for potentially suspicious/iu;
function nativeError(code, status, message = "") {
  const text2 = typeof message === "string" ? message.replace(/devin-session-token\$\S+|eyJ[\w-]+\.[\w-]+\.[\w-]*/gu, "[redacted]").replace(/\s+/gu, " ").trim().slice(0, 500) : "";
  const detail = `${code ?? ""} ${text2}`;
  const mapped = isQuotaExceededError(detail) || ACCOUNT_LIMIT.test(text2) ? "QUOTA" : /\bprompt is too long\b/iu.test(text2) || isContextWindowExceededError(detail) ? CONTEXT_WINDOW_EXCEEDED_CODE : CONTENT_POLICY.test(text2) ? "REFUSAL" : {
    unauthenticated: "AUTH",
    permission_denied: "PERMISSION",
    resource_exhausted: "RATE_LIMIT",
    unavailable: "SERVER",
    internal: "SERVER",
    deadline_exceeded: "TIMEOUT",
    invalid_argument: "INVALID_REQUEST",
    not_found: "DEVIN_MODEL_UNAVAILABLE",
    failed_precondition: "INVALID_REQUEST"
  }[code] ?? "INVALID_RESPONSE";
  return new LlmError4(`Devin native request failed (${code || "unknown"})${text2 ? `: ${text2}` : "."}`, mapped, status ? { status } : {});
}
async function responseError(response, signal) {
  let body;
  try {
    body = await response.json();
  } catch {
    signal.throwIfAborted();
  }
  const code = body?.code ?? (response.status === 401 ? "unauthenticated" : response.status === 403 ? "permission_denied" : response.status >= 500 ? "unavailable" : "invalid_argument");
  return nativeError(code, response.status, body?.message);
}
async function unary(path, { access, payload = bytes(1, metadata(access)), signal, fetch: fetchImpl = globalThis.fetch, origin = NATIVE_ORIGIN }) {
  const deadline = AbortSignal.timeout(3e4);
  const active = AbortSignal.any([deadline, ...signal ? [signal] : []]);
  let response;
  try {
    response = await fetchImpl(origin + path, { method: "POST", headers: nativeHeaders(access), body: payload, signal: active, redirect: "error" });
    if (!response.ok) throw await responseError(response, active);
    const body = Buffer.from(await response.arrayBuffer());
    return body[0] === 31 && body[1] === 139 ? gunzipSync(body) : body;
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new LlmError4("Devin native request timed out.", "TIMEOUT");
    if (error instanceof LlmError4) throw error;
    throw new LlmError4("Unable to reach Devin native service.", "TRANSPORT");
  }
}
function createNativeAuth({ fetch, origin = NATIVE_ORIGIN } = {}) {
  const cache = /* @__PURE__ */ new Map();
  return {
    async resolve(grant, signal) {
      const existing = cache.get(grant.loginId);
      if (existing?.access === grant.access && existing.expires > Date.now() + 6e4) return existing;
      const root = fields(await unary(RPC.auth, { access: grant.access, signal, fetch, origin }));
      const jwt = text(root, 1), custom = text(root, 2);
      if (!jwt) throw new LlmError4("Devin native authentication returned no session JWT.", "AUTH");
      const base = custom ? new URL(custom) : new URL(origin);
      if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" || base.username || base.password || base.search || base.hash) {
        throw new LlmError4("Devin returned an invalid native service origin.", "INVALID_RESPONSE");
      }
      const value = { access: grant.access, jwt, expires: tokenExpiry(jwt) ?? Date.now() + 3e5, origin: base.origin };
      signal?.throwIfAborted();
      cache.set(grant.loginId, value);
      return value;
    },
    clear() {
      cache.clear();
    }
  };
}

// lib/projection.js
import { createHash as createHash2 } from "node:crypto";
import { requestImageDimensions } from "@deepseek-ai/dsh-attachment";
import {
  LlmError as LlmError5,
  projectToolUpdates,
  projectOffloadedImages,
  offloadedImageText,
  textOnlyImageText,
  requestImageHandleText,
  requiredImageOffload,
  fileHandleText,
  resolveImageAttachmentAccess
} from "@deepseek-ai/dsh-llm";
var IMAGE_BUDGET = Object.freeze({ representation: "base64", maxBytes: 20 * 1024 * 1024 });
var contentHash = (value) => createHash2("sha256").update(JSON.stringify(value)).digest("hex");
var wireToolName = (name2) => /^[a-zA-Z0-9_-]{1,64}$/u.test(name2) ? name2 : `dsh_${contentHash(name2).slice(0, 48)}`;
function requestHash(options, messages = options.messages ?? []) {
  return contentHash({ system: options.system, messages: messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...m.role === "tool" ? { toolCallId: m.toolCallId, isError: m.isError === true } : {}
  })) });
}
function stableId(value) {
  const h = contentHash(value).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}
async function projectRequest(options, entry, wireModelId, { attachments, mapHostPath, accountScope, signal = options.signal } = {}) {
  const auxiliary = options.purpose === "compaction" || options.purpose === "session-title";
  const projected = projectToolUpdates(options.messages ?? [], options.tools, void 0, options.toolHistory);
  const access = attachments && mapHostPath ? (ref) => resolveImageAttachmentAccess(attachments, mapHostPath, ref) : () => void 0;
  const messages = projectOffloadedImages(projected.messages, (ref) => offloadedImageText(ref, access(ref)));
  const versions = /* @__PURE__ */ new Map(), vision = entry.info.inputModalities?.includes("image") && !auxiliary;
  if (vision) {
    for (const message of messages) for (const block of message.content) {
      if (block.type !== "image" || versions.has(block.attachment.attachmentId)) continue;
      signal?.throwIfAborted();
      if (!attachments) throw new LlmError5("Image input requires the DSH attachment service.", "UNSUPPORTED_CONTENT");
      const ref = block.attachment, target = { ...requestImageDimensions(ref.width, ref.height, 2048 * 2048), maxBytes: 1024 * 1024 };
      versions.set(ref.attachmentId, await attachments.readImageRequest(ref, target, signal));
    }
    const count = requiredImageOffload(messages, IMAGE_BUDGET, (block) => versions.get(block.attachment.attachmentId).data.byteLength);
    if (count) throw new LlmError5("Devin request images need native offloading.", "IMAGE_OFFLOAD_REQUIRED", { offloadImages: count });
  }
  const names = /* @__PURE__ */ new Map();
  const tools = auxiliary ? [] : (projected.tools ?? []).map((tool) => {
    const name2 = wireToolName(tool.name);
    names.set(name2, tool.name);
    return { name: name2, description: tool.description, parameters: tool.parameters };
  });
  const out = [], system = options.system ? [options.system] : [];
  for (const [index, message] of messages.entries()) {
    signal?.throwIfAborted();
    const texts = [], images = [], toolCalls = [];
    for (const block of message.content) {
      switch (block.type) {
        case "text":
          texts.push(block.text);
          break;
        case "reasoning":
          break;
        case "file":
          texts.push(fileHandleText(block.attachment, void 0));
          break;
        case "image": {
          if (!vision) {
            texts.push(textOnlyImageText(block.attachment));
            break;
          }
          if (!["user", "tool"].includes(message.role)) throw new LlmError5("Devin cannot replay assistant image output.", "UNSUPPORTED_CONTENT");
          const version = versions.get(block.attachment.attachmentId);
          texts.push(requestImageHandleText(block.attachment, version, access(block.attachment)));
          images.push({ data: Buffer.from(version.data).toString("base64"), mediaType: version.mediaType });
          break;
        }
        case "tool-call":
          if (auxiliary) texts.push(JSON.stringify(block));
          else {
            names.set(wireToolName(block.name), block.name);
            toolCalls.push({ id: String(block.id), name: wireToolName(block.name), arguments: block.arguments });
          }
          break;
        case "tool-addition":
        case "tool-removal":
          break;
        default:
          throw new LlmError5(`Unsupported Devin content block ${block.type}.`, "UNSUPPORTED_CONTENT");
      }
    }
    if (message.role === "system") {
      if (texts.length) system.push(texts.join("\n"));
      continue;
    }
    if (message.role === "developer" && !texts.length) continue;
    const prompt = texts.join("\n");
    const source = message.role === "assistant" ? 2 : message.role === "tool" && !auxiliary ? 4 : 1;
    const raw2 = options.messages?.findIndex((m) => m === projected.messages[index]) ?? -1;
    const envelope = message.source?.provider === "devin" ? message.source.replayState : void 0;
    const replay = envelope?.response;
    const compatible = !auxiliary && replay?.protocol === "devin-native-v1" && replay.wireModelId === wireModelId && replay.accountScope === accountScope && replay.historyHash === requestHash(options, options.messages.slice(0, raw2 >= 0 ? raw2 : index));
    const signed = compatible && envelope.blocks?.length === message.content.length ? message.content.flatMap((block, i) => block.type === "reasoning" && envelope.blocks[i]?.signature && envelope.blocks[i].textHash === contentHash(block.text) ? [{ block, metadata: envelope.blocks[i] }] : []) : [];
    out.push({
      messageId: compatible && replay.messageId ? replay.messageId : stableId([message.id ?? index, message.role, message.toolCallId]),
      source,
      prompt: message.role === "tool" && auxiliary ? JSON.stringify({ type: "tool-result", toolCallId: message.toolCallId, isError: message.isError === true, text: prompt }) : prompt,
      toolCalls,
      images,
      ...message.role === "tool" && !auxiliary ? { toolCallId: String(message.toolCallId), isError: message.isError === true } : {},
      ...signed.length === 1 ? { thinking: signed[0].block.text, signature: signed[0].metadata.signature, signatureType: signed[0].metadata.signatureType } : {}
    });
  }
  return { system: system.join("\n\n"), messages: out, tools, names, historyHash: requestHash(options), accountScope };
}

// lib/native-chat.js
import { randomUUID as randomUUID2 } from "node:crypto";
import { gzipSync, gunzipSync as gunzipSync2 } from "node:zlib";
import { LlmError as LlmError6, ToolCallId } from "@deepseek-ai/dsh-llm";
function encodeChat({ access, jwt, wireModelId, projected, cascadeId, maxTokens = 32768, temperature = 1, stop = [] }) {
  const config = concat(
    integer(1, 1),
    integer(2, maxTokens),
    integer(3, 400),
    double(5, temperature),
    double(6, temperature),
    integer(7, 40),
    double(8, Math.fround(0.95)),
    ...stop.map((s) => string(9, s))
  );
  const prompts = projected.messages.map((p) => bytes(3, concat(
    string(1, p.messageId),
    integer(2, p.source),
    string(3, p.prompt),
    ...p.toolCalls.map((t) => bytes(6, concat(string(1, t.id), string(2, t.name), string(3, t.arguments)))),
    string(7, p.toolCallId),
    p.isError ? integer(9, 1) : void 0,
    ...p.images.map((image) => bytes(10, concat(string(1, image.data), string(2, image.mediaType)))),
    string(11, p.thinking),
    string(12, p.signature),
    string(18, p.signatureType)
  )));
  const tools = projected.tools.map((t) => bytes(10, concat(string(1, t.name), string(2, t.description), string(3, JSON.stringify(t.parameters)))));
  return concat(
    bytes(1, metadata(access, { jwt, sessionId: cascadeId })),
    string(2, projected.system),
    ...prompts,
    integer(7, 5),
    bytes(8, config),
    ...tools,
    integer(11, 0),
    bytes(12, string(1, "auto")),
    bytes(13, integer(1, 1)),
    string(16, cascadeId),
    integer(20, 1),
    string(21, wireModelId),
    string(22, randomUUID2())
  );
}
function decodeChat(data) {
  const f = fields(data), u = raw(f, 7), usage = u ? fields(u) : void 0;
  const count = (n) => number(usage, n) ?? 0;
  return {
    text: text(f, 3),
    thinking: text(f, 9),
    signature: text(f, 10),
    signatureType: text(f, 21),
    messageId: text(f, 1),
    actualModelUid: text(f, 23),
    stop: number(f, 5) ?? 0,
    redacted: number(f, 8) === 1,
    thinkingRedacted: number(f, 11) === 1,
    ...usage ? { usage: {
      inputTokens: count(2),
      outputTokens: count(3),
      cacheWriteTokens: count(4),
      cacheReadTokens: count(5),
      totalTokens: count(2) + count(3) + count(4) + count(5)
    } } : {},
    calls: repeated(f, 6).map((value) => {
      const call = fields(value);
      return { id: text(call, 1), name: text(call, 2), arguments: text(call, 3), invalid: Boolean(text(call, 4) || text(call, 5)) };
    }),
    quotaCost: number(f, 26),
    overageCents: number(f, 27)
  };
}
function connectFrame(bytes2, flags = 0) {
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(bytes2.length, 1);
  return Buffer.concat([header, bytes2]);
}
async function* connectMessages(body, signal, touch) {
  if (!body) throw new LlmError6("Devin returned no native response stream.", "INVALID_RESPONSE");
  const reader = body.getReader();
  let pending = Buffer.alloc(0), ended = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      touch?.();
      if (value) pending = Buffer.concat([pending, value]);
      while (pending.length >= 5) {
        const flag = pending[0], size = pending.readUInt32BE(1);
        if (flag & ~3 || size > 32 * 1024 * 1024) throw new LlmError6("Invalid Devin Connect frame.", "INVALID_RESPONSE");
        if (pending.length < size + 5) break;
        if (ended) throw new LlmError6("Devin sent data after its terminal frame.", "INVALID_RESPONSE");
        const encoded = pending.subarray(5, size + 5);
        pending = pending.subarray(size + 5);
        let payload;
        try {
          payload = flag & 1 ? gunzipSync2(encoded, { maxOutputLength: 32 * 1024 * 1024 }) : encoded;
        } catch {
          throw new LlmError6("Invalid compressed Devin response.", "INVALID_RESPONSE");
        }
        if (flag & 2) {
          let trailer;
          try {
            trailer = JSON.parse(payload.toString("utf8"));
          } catch {
            throw new LlmError6("Invalid Devin completion trailer.", "INVALID_RESPONSE");
          }
          if (trailer.error) throw nativeError(trailer.error.code, void 0, trailer.error.message);
          ended = true;
        } else yield decodeChat(payload);
      }
      if (done) break;
    }
    if (pending.length || !ended) throw new LlmError6("Devin stream ended without a complete terminal frame.", "INVALID_RESPONSE");
  } finally {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
var appendDelta = (previous, incoming) => incoming.startsWith(previous) ? incoming : previous + incoming;
async function* streamNative({
  access,
  nativeSession,
  wireModelId,
  projected,
  cascadeId,
  options,
  signal,
  fetch: fetchImpl = globalThis.fetch,
  idleTimeoutMs = 18e4,
  onUnauthorized
}) {
  const idle = new AbortController(), local = new AbortController();
  const active = AbortSignal.any([idle.signal, local.signal, ...signal ? [signal] : []]);
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), idleTimeoutMs);
    timer.unref?.();
  };
  const blocks = [], calls = /* @__PURE__ */ new Map();
  let activeCall, textBlock, thinkingBlock, lastThinking, stop = 0, usage, messageId, actualModelUid, quotaCost, overageCents;
  touch();
  try {
    const request = encodeChat({
      access,
      jwt: nativeSession.jwt,
      wireModelId,
      projected,
      cascadeId,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      stop: options.stop
    });
    const response = await fetchImpl(nativeSession.origin + RPC.chat, {
      method: "POST",
      headers: nativeHeaders(access, true),
      body: connectFrame(gzipSync(request), 1),
      signal: active,
      redirect: "error"
    });
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.();
      throw await responseError(response, active);
    }
    for await (const msg of connectMessages(response.body, active, touch)) {
      if (msg.redacted) throw new LlmError6("Devin redacted the model response.", "REFUSAL");
      if (msg.thinking) {
        textBlock = void 0;
        if (!thinkingBlock) {
          thinkingBlock = { index: blocks.length, block: { type: "reasoning", text: "" }, signature: "", signatureType: "" };
          blocks.push(thinkingBlock);
          lastThinking = thinkingBlock;
          yield { type: "block-start", index: thinkingBlock.index, blockType: "reasoning" };
        }
        thinkingBlock.block.text += msg.thinking;
        yield { type: "reasoning-delta", index: thinkingBlock.index, text: msg.thinking };
      }
      if (msg.signature && lastThinking) lastThinking.signature = appendDelta(lastThinking.signature, msg.signature);
      if (msg.signatureType && lastThinking) lastThinking.signatureType = msg.signatureType;
      if (msg.thinkingRedacted && lastThinking) lastThinking.redacted = true;
      if (msg.text) {
        thinkingBlock = void 0;
        if (!textBlock) {
          textBlock = { index: blocks.length, block: { type: "text", text: "" } };
          blocks.push(textBlock);
          yield { type: "block-start", index: textBlock.index, blockType: "text" };
        }
        textBlock.block.text += msg.text;
        yield { type: "text-delta", index: textBlock.index, text: msg.text };
      }
      for (const delta of msg.calls) {
        textBlock = void 0;
        thinkingBlock = void 0;
        if (delta.invalid) throw new LlmError6("Devin returned invalid tool arguments.", "INVALID_RESPONSE");
        const id = delta.id || activeCall;
        if (!id) throw new LlmError6("Devin tool fragment has no call identity.", "INVALID_RESPONSE");
        let record = calls.get(id);
        if (!record) {
          record = { index: blocks.length, wireName: "", block: { type: "tool-call", id: ToolCallId(id), name: "", arguments: "" } };
          calls.set(id, record);
          blocks.push(record);
          yield { type: "block-start", index: record.index, blockType: "tool-call" };
        }
        if (delta.name && record.wireName && record.wireName !== delta.name) throw new LlmError6("Devin changed a tool identity.", "INVALID_RESPONSE");
        activeCall = id;
        if (delta.name) record.wireName = delta.name;
        record.block.name = projected.names.get(record.wireName) ?? record.wireName;
        const next = appendDelta(record.block.arguments, delta.arguments);
        const argumentsDelta = next.slice(record.block.arguments.length);
        record.block.arguments = next;
        yield {
          type: "tool-call-delta",
          index: record.index,
          id: record.block.id,
          ...record.block.name ? { name: record.block.name } : {},
          argumentsDelta
        };
      }
      if (msg.stop) stop = msg.stop;
      if (msg.usage) usage = msg.usage;
      if (msg.messageId) messageId = msg.messageId;
      if (msg.actualModelUid) actualModelUid = msg.actualModelUid;
      if (msg.quotaCost !== void 0) quotaCost = msg.quotaCost;
      if (msg.overageCents !== void 0) overageCents = msg.overageCents;
    }
    active.throwIfAborted();
    if ([1, 7, 9, 11, 13].includes(stop)) throw new LlmError6("Devin did not complete the response normally.", stop === 11 ? "REFUSAL" : "INVALID_RESPONSE");
    if (!blocks.length) throw new LlmError6("Devin returned an empty response.", "EMPTY_RESPONSE");
    if (calls.size && stop === 3) throw new LlmError6("Devin tool response was truncated.", "INVALID_RESPONSE");
    for (const record of calls.values()) {
      if (!record.block.name) throw new LlmError6("Devin tool call has no name.", "INVALID_RESPONSE");
      if (!record.block.arguments) {
        record.block.arguments = "{}";
        yield { type: "tool-call-delta", index: record.index, id: record.block.id, argumentsDelta: "{}" };
      }
      let args;
      try {
        args = JSON.parse(record.block.arguments);
      } catch {
        throw new LlmError6("Devin tool arguments are incomplete JSON.", "INVALID_RESPONSE");
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new LlmError6("Devin tool arguments must be an object.", "INVALID_RESPONSE");
    }
    for (const record of blocks) yield { type: "block-end", index: record.index, block: record.block };
    if (usage) yield { type: "usage", usage };
    yield {
      type: "finish",
      reason: { kind: calls.size ? "tool-calls" : stop === 3 ? "max-tokens" : "stop" },
      replayState: {
        response: {
          protocol: "devin-native-v1",
          wireModelId,
          historyHash: projected.historyHash,
          ...projected.accountScope ? { accountScope: projected.accountScope } : {},
          ...actualModelUid ? { actualModelUid } : {},
          ...messageId ? { messageId } : {},
          ...quotaCost === void 0 ? {} : { quotaCost },
          ...overageCents === void 0 ? {} : { overageCents }
        },
        blocks: blocks.map((r) => r.block.type === "reasoning" && r.signature && !r.redacted ? { signature: r.signature, signatureType: r.signatureType, textHash: contentHash(r.block.text) } : null)
      }
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (idle.signal.aborted) throw new LlmError6("Devin native stream timed out.", "TIMEOUT");
    if (error instanceof LlmError6) {
      if (error.code === "AUTH") onUnauthorized?.();
      throw error;
    }
    throw new LlmError6("Devin native stream transport failed.", "TRANSPORT");
  } finally {
    clearTimeout(timer);
    local.abort();
  }
}

// lib/adapter.js
var DevinAdapter = class extends LlmAdapter {
  constructor(ctx, auth, catalog, { fetch, origin = NATIVE_ORIGIN, retryPolicy, idleTimeoutMs, nativeAuth } = {}) {
    super();
    Object.assign(this, { ctx, auth, catalog, fetch, retryPolicy, idleTimeoutMs });
    this.nativeAuth = nativeAuth ?? createNativeAuth({ fetch, origin });
    this.lifetime = new AbortController();
    this.active = /* @__PURE__ */ new Set();
  }
  assertProvider(provider) {
    if (provider !== "devin") throw new LlmError7("This adapter only owns Devin.", "NO_ADAPTER");
  }
  providerInfo(provider) {
    this.assertProvider(provider);
    return { id: "devin", name: "Devin" };
  }
  providerRetryPolicy(provider) {
    this.assertProvider(provider);
    return this.retryPolicy;
  }
  async listModels(provider) {
    this.assertProvider(provider);
    return this.catalog.entries().map((e) => e.info);
  }
  capture(provider, model, signal) {
    this.assertProvider(provider);
    signal?.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
    const entry = this.catalog.snapshot(model);
    if (!entry) throw new LlmError7("Sign in to Devin and refresh its model directory in DSH settings.", "DEVIN_MODEL_UNAVAILABLE");
    return { entry, loginId: this.catalog.loginId() };
  }
  async resolveModel(provider, model, signal) {
    return this.capture(provider, model, signal).entry.info;
  }
  async prepareCall(provider, model, signal) {
    const captured = this.capture(provider, model, signal);
    return Object.freeze({ model: captured.entry.info, stream: (options) => {
      if (options.provider !== provider || options.model !== model) throw new LlmError7("Prepared Devin route changed before dispatch.", "INVALID_PREPARED_CALL");
      return this.dispatch(options, captured);
    } });
  }
  async *stream(options) {
    yield* (await this.prepareCall(options.provider, options.model, options.signal)).stream(options);
  }
  async *dispatch(options, { entry, loginId }) {
    const controller = new AbortController();
    const operation = { loginId, controller };
    this.active.add(operation);
    const signal = AbortSignal.any([this.lifetime.signal, controller.signal, ...options.signal ? [options.signal] : []]);
    try {
      const grant = await this.auth.getGrant(signal);
      if (grant.loginId !== loginId) throw new LlmError7("Devin account changed. Refresh the model directory.", "AUTH");
      const wireModelId = this.catalog.select(entry, options.reasoningEffort);
      const attachments = this.ctx.get("attachments");
      const filesystem = this.ctx.get("fs");
      const projected = await projectRequest(options, entry, wireModelId, {
        signal,
        attachments,
        accountScope: loginId,
        mapHostPath: filesystem ? (path) => filesystem.processPathFromHostPath(path) : void 0
      });
      signal.throwIfAborted();
      if ((await this.auth.metadata()).loginId !== loginId) throw new LlmError7("Devin account changed before dispatch.", "AUTH");
      const nativeSession = await this.nativeAuth.resolve(grant, signal);
      signal.throwIfAborted();
      if ((await this.auth.metadata()).loginId !== loginId) throw new LlmError7("Devin account changed during native authentication.", "AUTH");
      const cascadeId = stableId([grant.loginId, options.sessionId ?? projected.historyHash, options.purpose ?? "main"]);
      yield* streamNative({
        access: grant.access,
        nativeSession,
        wireModelId,
        projected,
        cascadeId,
        options,
        signal,
        fetch: this.fetch,
        idleTimeoutMs: this.idleTimeoutMs,
        onUnauthorized: () => this.auth.reject(grant)
      });
    } finally {
      this.active.delete(operation);
    }
  }
  invalidateAccount(loginId) {
    this.nativeAuth.clear();
    for (const item of this.active) if (item.loginId !== loginId) item.controller.abort();
  }
  dispose() {
    this.lifetime.abort();
    this.nativeAuth.clear();
  }
};

// lib/auth.js
import { randomUUID as randomUUID3 } from "node:crypto";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { LlmError as LlmError8 } from "@deepseek-ai/dsh-llm";
var DEVIN_GRANT_KEY = credentialKey("dsh-devin", "default");
function grantOf(record) {
  const grant = record?.kind === "grant" ? record.payload : void 0;
  return grant?.type === "oauth" && typeof grant.loginId === "string" && grant.loginId && typeof grant.access === "string" && grant.access && !/[^\x21-\x7e]/.test(grant.access) && (grant.expires === void 0 || Number.isFinite(grant.expires)) ? grant : void 0;
}
function createDevinAuth(ctx, { login = loginDevin, fetch } = {}) {
  const lifetime = new AbortController();
  let rejectedLoginId, unregister;
  async function metadata2() {
    const grant = grantOf(await ctx.credentials.readRecord(DEVIN_GRANT_KEY));
    return {
      key: DEVIN_GRANT_KEY,
      configured: Boolean(grant),
      ...grant ? { loginId: grant.loginId, ...grant.expires ? { expires: grant.expires } : {} } : {},
      needsLogin: !grant || grant.loginId === rejectedLoginId || grant.expires <= Date.now()
    };
  }
  async function getGrant(signal) {
    signal?.throwIfAborted();
    lifetime.signal.throwIfAborted();
    const grant = grantOf(await ctx.credentials.readRecord(DEVIN_GRANT_KEY));
    signal?.throwIfAborted();
    lifetime.signal.throwIfAborted();
    if (!grant || grant.loginId === rejectedLoginId || grant.expires <= Date.now()) {
      throw new LlmError8("Please sign in to Devin in DSH settings.", "AUTH");
    }
    return Object.freeze({ ...grant });
  }
  function registerFlow() {
    if (unregister) return unregister;
    unregister = ctx.authorization.registerFlow({
      key: DEVIN_GRANT_KEY,
      label: "Devin",
      methods: [{ id: "oauth", label: "\u6D4F\u89C8\u5668\u767B\u5F55" }],
      async run(session) {
        const signal = AbortSignal.any([session.signal, lifetime.signal]);
        const tokens = await login({ signal, notify: (notice) => session.notify(notice), fetch });
        signal.throwIfAborted();
        const payload = { type: "oauth", loginId: randomUUID3(), ...tokens };
        if (!grantOf({ kind: "grant", payload })) throw new LlmError8("Invalid Devin login response.", "INVALID_RESPONSE");
        await session.commit({ kind: "grant", payload });
        rejectedLoginId = void 0;
      }
    });
    return unregister;
  }
  return {
    key: DEVIN_GRANT_KEY,
    metadata: metadata2,
    getGrant,
    registerFlow,
    reject(grant) {
      rejectedLoginId = grant.loginId;
    },
    dispose() {
      lifetime.abort();
      unregister?.();
      unregister = void 0;
    }
  };
}

// lib/catalog.js
import { LlmError as LlmError9, ReasoningEffortId } from "@deepseek-ai/dsh-llm";

// lib/native-catalog.js
function decodeModels(data) {
  return repeated(fields(data), 1).map((value) => {
    const row = fields(value), info = nested(row, 23), features = nested(info, 6), family2 = nested(row, 30);
    const labels = Object.fromEntries(repeated(family2, 2).map((value2) => {
      const pair = fields(value2), detail = nested(pair, 2);
      return [text(pair, 1), { name: text(detail, 2), order: number(detail, 1) ?? 0 }];
    }));
    return {
      id: text(row, 22),
      name: text(row, 1),
      familyId: text(info, 23),
      familyName: text(family2, 1),
      labels,
      disabled: number(row, 4) === 1,
      supportsImages: (number(row, 5) ?? number(features, 11)) === 1,
      context: number(row, 18) ?? number(info, 4),
      maxOutput: number(info, 13),
      isDefault: number(row, 31) === 1 || number(family2, 3) === 1,
      internal: number(info, 2) === 1,
      displaySlot: number(info, 22),
      router: number(info, 25) === 1,
      harnesses: repeated(info, 20).map((value2) => value2.toString("utf8"))
    };
  }).filter((row) => row.id);
}
async function fetchNativeModels(options) {
  return decodeModels(await unary(RPC.models, options));
}

// lib/catalog.js
var positive = (value) => Number.isFinite(value) && value > 0;
var clean = (name2) => name2.replace(/·/gu, " ").replace(/\bno[ _-]*zdr\b/giu, "").replace(/\b\d+(?:\.\d+)?[km]\b/giu, "").replace(/\(\s*\)|\[\s*\]/gu, "").replace(/\s+/gu, " ").trim();
var RANK = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
var NAMES = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra High", max: "Max" };
var effortAxis = (key) => /^(?:reasoning )?effort$/iu.test(key);
var contextAxis = (key) => /context/iu.test(key);
var freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
var effort = (row) => {
  const label = Object.entries(row.labels ?? {}).find(([key]) => effortAxis(key))?.[1]?.name;
  if (!label) return void 0;
  const normalized = label.toLowerCase().replace(/[ -]/gu, "");
  const id = normalized === "nothinking" ? "none" : normalized === "extrahigh" ? "xhigh" : normalized;
  return RANK.includes(id) ? id : void 0;
};
var family = (row) => row.familyId || row.id;
var lanes = (row) => Object.entries(row.labels ?? {}).filter(([key]) => !effortAxis(key) && !contextAxis(key)).sort(([a], [b]) => a.localeCompare(b));
var laneKey = (row) => JSON.stringify(lanes(row));
function modelInfo(row, name2) {
  return {
    provider: "devin",
    id: row.id,
    name: clean(name2 || row.name || row.id),
    inputModalities: row.supportsImages ? ["text", "image"] : ["text"],
    ...positive(row.context) ? { context: { contextWindow: row.context } } : {},
    defaultMaxTokens: Math.min(positive(row.maxOutput) ? row.maxOutput : 32768, 32768)
  };
}
function catalogEntries(rows) {
  const maxima = /* @__PURE__ */ new Map();
  for (const row of rows) if (positive(row.context)) maxima.set(family(row), Math.max(maxima.get(family(row)) ?? 0, row.context));
  const eligible = rows.filter((row) => !row.disabled && !row.internal && !row.router && ![3, 4, 6].includes(row.displaySlot) && row.id !== "subagent-default");
  const full = eligible.filter((row) => !positive(row.context) || row.context >= maxima.get(family(row)));
  const groups = /* @__PURE__ */ new Map(), out = [];
  for (const row of full) {
    const id = effort(row);
    if (!id) {
      out.push({ info: modelInfo(row), wireModelId: row.id, row });
      continue;
    }
    const key = JSON.stringify([family(row), laneKey(row), row.context, row.maxOutput, row.supportsImages]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const members of groups.values()) {
    if (new Set(members.map(effort)).size !== members.length) {
      for (const row of members) out.push({ info: modelInfo(row), wireModelId: row.id, row });
      continue;
    }
    members.sort((a, b) => RANK.indexOf(effort(a)) - RANK.indexOf(effort(b)));
    const chosen = members.find((r) => r.isDefault) ?? members.find((r) => effort(r) === "high") ?? members[0];
    const peers = full.filter((r) => family(r) === family(chosen)), labels = [];
    for (const [key, value] of lanes(chosen)) {
      if (!peers.some((r) => JSON.stringify(r.labels?.[key]) !== JSON.stringify(value))) continue;
      if (key === "Fast Mode") {
        if (value.order > 0) labels.push("Fast");
      } else if (key === "Thinking") {
        if (value.order > 0) labels.push("Thinking");
      } else if (key === "Prompt Cache Retention") labels.push(`Cache ${value.name || "Default"}`);
      else labels.push(value.name || `${key} ${value.order}`);
    }
    out.push({
      info: { ...modelInfo(chosen, [chosen.familyName || chosen.name, ...labels].join(" ")), reasoning: {
        efforts: members.map((r) => ({ id: ReasoningEffortId(effort(r)), name: NAMES[effort(r)] })),
        defaultEffort: ReasoningEffortId(effort(chosen))
      } },
      wireModelId: chosen.id,
      row: chosen,
      efforts: members.map((r) => ({ id: effort(r), wireModelId: r.id })),
      aliases: members.map((r) => ({ id: r.id, effort: effort(r) }))
    });
  }
  for (const entry of out) entry.aliases ??= [];
  for (const removed of eligible.filter((r) => positive(r.context) && r.context < maxima.get(family(r)))) {
    const target = out.find((e) => family(e.row) === family(removed) && laneKey(e.row) === laneKey(removed) && (effort(removed) ? e.efforts?.some((v) => v.id === effort(removed)) : !e.efforts));
    if (target) target.aliases.push({ id: removed.id, ...effort(removed) ? { effort: effort(removed) } : {} });
  }
  for (const familyId of new Set(full.map(family))) {
    const group = out.filter((e) => family(e.row) === familyId);
    const preferred = group.find((e) => e.row.isDefault) ?? group[0];
    if (preferred && !out.some((e) => e.info.id === familyId) && !eligible.some((r) => r.id === familyId)) preferred.aliases.push({ id: familyId });
  }
  return freeze(out.map(({ row, ...entry }) => entry));
}
function createDevinCatalog(auth, { cached, save = async () => {
}, fetch, origin = NATIVE_ORIGIN, fetchModels = fetchNativeModels } = {}) {
  let state = cached?.format === "native-v1" && Array.isArray(cached.rows) ? cached : void 0;
  let entries = catalogEntries(state?.rows ?? []);
  let epoch = 0, tail = Promise.resolve();
  const lifetime = new AbortController();
  const saves = (value) => {
    const next = tail.then(() => save(value));
    tail = next.catch(() => {
    });
    return next;
  };
  async function clear() {
    epoch++;
    state = void 0;
    entries = freeze([]);
    await saves(null);
  }
  return {
    entries: () => entries,
    loginId: () => state?.loginId,
    snapshot(model) {
      const exact = entries.find((e) => e.info.id === model);
      if (exact) return exact;
      const entry = entries.find((e) => e.aliases.some((a) => a.id === model));
      if (!entry) return void 0;
      const alias = entry.aliases.find((a) => a.id === model), route = entry.efforts?.find((e) => e.id === alias.effort);
      return freeze({ ...entry, info: {
        ...entry.info,
        id: model,
        ...route ? { reasoning: { ...entry.info.reasoning, defaultEffort: ReasoningEffortId(route.id) } } : {}
      }, wireModelId: route?.wireModelId ?? entry.wireModelId });
    },
    select(entry, requested) {
      if (requested === void 0) return entry.wireModelId;
      const route = entry.efforts?.find((e) => e.id === requested);
      if (!route) throw new LlmError9("Unsupported Devin effort for this model.", "INVALID_REASONING_EFFORT");
      return route.wireModelId;
    },
    async refresh(signal) {
      const generation = ++epoch, active = AbortSignal.any([lifetime.signal, ...signal ? [signal] : []]);
      const grant = await auth.getGrant(active);
      let rows;
      try {
        rows = await fetchModels({ access: grant.access, signal: active, fetch, origin });
      } catch (error) {
        if (error.code === "AUTH") auth.reject(grant);
        throw error;
      }
      const next = { format: "native-v1", loginId: grant.loginId, checkedAt: Date.now(), rows }, nextEntries = catalogEntries(rows);
      active.throwIfAborted();
      if (generation !== epoch || (await auth.metadata()).loginId !== grant.loginId) return;
      await saves(next);
      active.throwIfAborted();
      if (generation !== epoch || (await auth.metadata()).loginId !== grant.loginId) return;
      state = next;
      entries = nextEntries;
    },
    clear,
    async dispose() {
      epoch++;
      lifetime.abort();
      await tail;
    }
  };
}

// lib/provider-login.js
import { randomUUID as randomUUID4 } from "node:crypto";
import { credentialKey as credentialKey2 } from "@deepseek-ai/dsh-credentials";
var LOGIN_TIMEOUT_MS = 15 * 60 * 1e3;
var MAX_INPUT_LENGTH = 8192;
var MESSAGES = {
  NO_FLOW: "\u539F\u751F OAuth \u767B\u5F55\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u786E\u8BA4\u5BF9\u5E94\u6A21\u578B\u63D0\u4F9B\u65B9\u5DF2\u542F\u7528\u3002",
  ALREADY_IN_FLIGHT: "\u6B64\u63D0\u4F9B\u65B9\u6B63\u5728\u5176\u4ED6\u9875\u9762\u767B\u5F55\uFF0C\u8BF7\u5148\u5B8C\u6210\u6216\u53D6\u6D88\u539F\u6765\u7684\u767B\u5F55\u3002",
  NO_PROMPT: "\u8FD9\u4E2A\u767B\u5F55\u95EE\u9898\u5DF2\u7ED3\u675F\uFF0C\u8BF7\u4F7F\u7528\u5F53\u524D\u9875\u9762\u4E2D\u7684\u6700\u65B0\u95EE\u9898\u3002",
  INVALID_ANSWER: "\u8F93\u5165\u5185\u5BB9\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u540E\u91CD\u8BD5\u3002",
  LOGIN_FAILED: "\u767B\u5F55\u672A\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5\u5F53\u524D\u51ED\u636E\u72B6\u6001\u540E\u91CD\u8BD5\u3002",
  LOGIN_TIMEOUT: "\u767B\u5F55\u7B49\u5F85\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u5F00\u59CB\u3002",
  DISPOSED: "\u767B\u5F55\u754C\u9762\u5DF2\u505C\u6B62\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u3002",
  OPERATION_FAILED: "\u8BA4\u8BC1\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002"
};
var ProviderLoginError = class extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.OPERATION_FAILED);
    this.name = "ProviderLoginError";
    this.code = code in MESSAGES ? code : "OPERATION_FAILED";
  }
};
function withdrawn() {
  return new DOMException("Authorization prompt withdrawn", "AbortError");
}
function publicPrompt(request) {
  if (!["text", "secret", "select"].includes(request.kind) || typeof request.message !== "string") {
    throw new TypeError("Unsupported native authorization prompt");
  }
  const view = { id: randomUUID4(), kind: request.kind, message: request.message.slice(0, 2048) };
  if (request.kind === "select") {
    if (!Array.isArray(request.options) || request.options.length > 100 || request.options.some((option) => typeof option.id !== "string" || !option.id || option.id.length > 256 || typeof option.label !== "string")) {
      throw new TypeError("Invalid native authorization choices");
    }
    view.options = request.options.map((option) => ({
      id: option.id,
      label: option.label.slice(0, 512),
      ...typeof option.description === "string" ? { description: option.description.slice(0, 1024) } : {}
    }));
  } else if (typeof request.placeholder === "string") view.placeholder = request.placeholder.slice(0, 1024);
  return view;
}
function createProviderLogin(ctx, { provider, label, allowedAuthHosts, recordKey }) {
  const key = recordKey ?? credentialKey2("llm-pi-ai", provider);
  const hosts = new Set(allowedAuthHosts.map((host) => host.toLowerCase()));
  let flow;
  let generation = 0;
  let disposed = false;
  let logoutTask;
  const tasks = /* @__PURE__ */ new Set();
  function current(candidate) {
    return !disposed && flow === candidate && candidate.generation === generation;
  }
  function accepting(candidate) {
    return current(candidate) && candidate.status === "pending" && !candidate.controller.signal.aborted;
  }
  function withdrawPrompt(candidate) {
    const pending = candidate?.prompt;
    if (!pending) return;
    candidate.prompt = void 0;
    pending.cleanup();
    pending.reject(withdrawn());
  }
  function stop(candidate) {
    if (!candidate || candidate.status !== "pending") return;
    candidate.controller.abort(withdrawn());
    withdrawPrompt(candidate);
    candidate.ready.resolve();
  }
  function authUrl(raw2) {
    if (typeof raw2 !== "string" || raw2.length > MAX_INPUT_LENGTH) return void 0;
    let url;
    try {
      url = new URL(raw2);
    } catch {
      return void 0;
    }
    return url.protocol === "https:" && !url.username && !url.password && hosts.has(url.hostname.toLowerCase()) ? url.href : void 0;
  }
  async function status() {
    const entry = ctx.authorization.describe(key);
    const record = await ctx.credentials.readRecord(key);
    const oauth = record?.kind === "grant" && record.payload?.type === "oauth";
    const expires = oauth && typeof record.payload.expires === "number" && Number.isFinite(record.payload.expires) ? record.payload.expires : void 0;
    const pending = flow?.status === "pending";
    return {
      authenticated: Boolean(record),
      ...record ? { credentialKind: oauth ? "oauth" : record.kind } : {},
      ...expires === void 0 ? {} : { expires, expired: expires <= Date.now() },
      available: Boolean(entry?.methods.some((method) => method.id === "oauth")),
      inFlight: Boolean(entry?.inFlight),
      login: {
        status: flow?.status ?? "idle",
        ...pending && flow.authUrl ? { authUrl: flow.authUrl } : {},
        ...pending && flow.notice ? { notice: flow.notice } : {},
        ...pending && flow.deviceCode ? { deviceCode: flow.deviceCode } : {},
        ...pending && flow.prompt ? { prompt: flow.prompt.view } : {},
        ...flow?.status === "error" ? { error: MESSAGES[flow.errorCode] ?? MESSAGES.LOGIN_FAILED } : {}
      }
    };
  }
  async function startLogin() {
    if (disposed) throw new ProviderLoginError("DISPOSED");
    if (logoutTask) throw new ProviderLoginError("ALREADY_IN_FLIGHT");
    if (flow?.status === "pending") {
      await flow.ready.promise;
      return status();
    }
    const entry = ctx.authorization.describe(key);
    if (!entry?.methods.some((method) => method.id === "oauth")) throw new ProviderLoginError("NO_FLOW");
    if (entry.inFlight) throw new ProviderLoginError("ALREADY_IN_FLIGHT");
    const candidate = {
      generation: ++generation,
      controller: new AbortController(),
      ready: Promise.withResolvers(),
      status: "pending"
    };
    flow = candidate;
    const timeout = setTimeout(() => {
      candidate.timedOut = true;
      stop(candidate);
    }, LOGIN_TIMEOUT_MS);
    timeout.unref?.();
    candidate.task = (async () => {
      try {
        const outcome = await ctx.authorization.begin({
          key,
          method: "oauth",
          signal: candidate.controller.signal,
          interaction: {
            notify(notice) {
              if (!accepting(candidate)) return;
              if (typeof notice.message === "string") candidate.notice = notice.message.slice(0, 2048);
              const url = authUrl(notice.url);
              if (url) candidate.authUrl = url;
              if (typeof notice.code === "string") candidate.deviceCode = notice.code.slice(0, 256);
              candidate.ready.resolve();
            },
            prompt(request) {
              if (!accepting(candidate) || request.signal?.aborted) return Promise.reject(withdrawn());
              withdrawPrompt(candidate);
              const view = publicPrompt(request);
              const result = Promise.withResolvers();
              const pending = {
                view,
                resolve: result.resolve,
                reject: result.reject,
                cleanup() {
                  request.signal?.removeEventListener("abort", abort);
                }
              };
              const abort = () => {
                if (candidate.prompt === pending) candidate.prompt = void 0;
                pending.cleanup();
                result.reject(withdrawn());
              };
              candidate.prompt = pending;
              request.signal?.addEventListener("abort", abort, { once: true });
              candidate.ready.resolve();
              return result.promise;
            }
          }
        });
        if (current(candidate)) candidate.status = outcome.status === "authorized" ? "complete" : candidate.timedOut ? "error" : "cancelled";
        if (candidate.timedOut) candidate.errorCode = "LOGIN_TIMEOUT";
      } catch (error) {
        if (current(candidate)) {
          candidate.status = candidate.controller.signal.aborted && !candidate.timedOut ? "cancelled" : "error";
          candidate.errorCode = candidate.timedOut ? "LOGIN_TIMEOUT" : error?.code === "NO_FLOW" || error?.code === "UNKNOWN_METHOD" ? "NO_FLOW" : error?.code === "ALREADY_IN_FLIGHT" ? "ALREADY_IN_FLIGHT" : "LOGIN_FAILED";
        }
      } finally {
        clearTimeout(timeout);
        withdrawPrompt(candidate);
        candidate.authUrl = void 0;
        candidate.notice = void 0;
        candidate.deviceCode = void 0;
        candidate.ready.resolve();
      }
    })();
    tasks.add(candidate.task);
    candidate.task.finally(() => tasks.delete(candidate.task)).catch(() => {
    });
    await candidate.ready.promise;
    return status();
  }
  return {
    status,
    startLogin,
    async answer({ promptId, input }) {
      const candidate = flow;
      const pending = candidate?.prompt;
      if (!candidate || !accepting(candidate) || !pending || pending.view.id !== promptId) {
        throw new ProviderLoginError("NO_PROMPT");
      }
      if (typeof input !== "string" || !input.trim() || input.length > MAX_INPUT_LENGTH || pending.view.kind === "select" && !pending.view.options.some((option) => option.id === input)) {
        throw new ProviderLoginError("INVALID_ANSWER");
      }
      candidate.prompt = void 0;
      pending.cleanup();
      pending.resolve(input);
      return status();
    },
    async cancelLogin() {
      const candidate = flow;
      stop(candidate);
      if (candidate?.task) await candidate.task;
      return status();
    },
    logout() {
      if (logoutTask) return logoutTask;
      const candidate = flow;
      if (ctx.authorization.describe(key)?.inFlight && candidate?.status !== "pending") {
        return Promise.reject(new ProviderLoginError("ALREADY_IN_FLIGHT"));
      }
      const operation = (async () => {
        stop(candidate);
        if (candidate?.task) await candidate.task;
        if (ctx.authorization.describe(key)?.inFlight) throw new ProviderLoginError("ALREADY_IN_FLIGHT");
        await ctx.credentials.deleteRecord(key);
        if (flow === candidate) flow = void 0;
        return status();
      })();
      logoutTask = operation;
      operation.finally(() => {
        if (logoutTask === operation) logoutTask = void 0;
      }).catch(() => {
      });
      return operation;
    },
    async dispose() {
      disposed = true;
      generation++;
      stop(flow);
      await Promise.allSettled([...tasks, ...logoutTask ? [logoutTask] : []]);
    }
  };
}

// lib/provider-login-routes.js
function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
function failure(status, code, message) {
  return json(status, { ok: false, error: { code, message } });
}
function mountProviderLoginRoutes(ctx, controller, { apiPath, refreshModels }) {
  if (!/^\/api\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(apiPath)) throw new TypeError("Invalid login API path");
  const actions = {
    status: () => controller.status(),
    "start-login": () => controller.startLogin(),
    answer: (body) => controller.answer(body),
    "cancel-login": () => controller.cancelLogin(),
    logout: () => controller.logout()
  };
  if (refreshModels) actions["refresh-models"] = async (_body, request) => {
    await refreshModels(request.signal);
    return controller.status();
  };
  const disposers = Object.entries(actions).map(([action, execute]) => ctx.connection.fetch.register({
    path: `${apiPath}/${action}`,
    methods: ["POST"],
    requestBody: "buffered",
    async fetch(request) {
      const admission = ctx.connection.admit(request);
      if ("rejection" in admission) return failure(admission.rejection, "UNAUTHORIZED", "\u8BF7\u5148\u767B\u5F55 DSH\u3002");
      if (request.method !== "POST") return failure(405, "METHOD_NOT_ALLOWED", "\u53EA\u63A5\u53D7 POST \u8BF7\u6C42\u3002");
      if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        return failure(415, "INVALID_CONTENT_TYPE", "\u8BF7\u6C42\u5FC5\u987B\u4F7F\u7528 application/json\u3002");
      }
      let body;
      try {
        const text2 = await request.text();
        if (text2.length > 65536) return failure(413, "INVALID_REQUEST", "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u957F\u3002");
        body = JSON.parse(text2);
      } catch {
        return failure(400, "INVALID_REQUEST", "\u8BF7\u6C42\u5FC5\u987B\u5305\u542B JSON \u5BF9\u8C61\u3002");
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => action !== "answer" || !["promptId", "input"].includes(key)) || action === "answer" && (typeof body.promptId !== "string" || !body.promptId || body.promptId.length > 64 || typeof body.input !== "string" || !body.input.trim() || body.input.length > 8192)) {
        return failure(400, "INVALID_REQUEST", "\u8BF7\u6C42\u53C2\u6570\u65E0\u6548\u3002");
      }
      try {
        return json(200, { ok: true, value: await execute(body, request) });
      } catch (error) {
        if (error instanceof ProviderLoginError) {
          const status = error.code === "NO_FLOW" ? 503 : error.code === "ALREADY_IN_FLIGHT" || error.code === "NO_PROMPT" ? 409 : error.code === "INVALID_ANSWER" ? 400 : error.code === "DISPOSED" ? 410 : 500;
          return failure(status, error.code, error.message);
        }
        return failure(500, "OPERATION_FAILED", "\u8BA4\u8BC1\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      }
    }
  }));
  return async () => {
    await Promise.all(disposers.map((dispose) => dispose()));
  };
}

// index.js
var name = "devin";
var inject = ["llm", "credentials", "authorization", "storageDomain"];
var Config = schema.object({ retryPolicy: RetryPolicySchema.description("Devin model request retry policy") });
var DEFAULT_RETRY = {
  mode: "normal",
  maxRetries: 35,
  retryableCodes: ["EMPTY_RESPONSE", "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT", "INVALID_RESPONSE"],
  backoff: { initialDelayMs: 2e3, maxDelayMs: 12e4, jitterRatio: 0.1 }
};
var cacheSpec = defineDomain({
  name: "devin_catalog",
  version: 1,
  invalidRecords: "backup-and-skip",
  tables: { cache: domainTable(z.object({ loginId: z.string(), checkedAt: z.number(), rows: z.array(z.unknown()), format: z.literal("native-v1").optional() })) }
});
async function apply(ctx, config) {
  return ctx.effect(async function* () {
    const domain = await ctx.storageDomain.open(cacheSpec);
    yield () => domain.close();
    const records = domain.table("cache"), lifetime = new AbortController(), tasks = /* @__PURE__ */ new Set();
    const auth = createDevinAuth(ctx);
    let catalog, adapter, controller, accountTail = Promise.resolve();
    yield async () => {
      lifetime.abort();
      auth.dispose();
      adapter?.dispose();
      await controller?.dispose();
      await catalog?.dispose();
      await accountTail;
      await Promise.allSettled(tasks);
    };
    const initial = await auth.metadata();
    yield void 0;
    const persisted = records.get("default");
    catalog = createDevinCatalog(auth, {
      cached: initial.configured && persisted?.loginId === initial.loginId ? persisted : void 0,
      save: (value) => value === null ? records.delete("default") : records.put("default", value)
    });
    adapter = new DevinAdapter(ctx, auth, catalog, { retryPolicy: resolveRetryPolicy(config?.retryPolicy ?? DEFAULT_RETRY, "devin.retryPolicy") });
    controller = createProviderLogin(ctx, { provider: "devin", label: "Devin", recordKey: auth.key, allowedAuthHosts: ["app.devin.ai"] });
    let observedLoginId = initial.loginId, loads = 0, catalogError;
    const baseStatus = controller.status;
    controller.status = async () => {
      const [status, metadata2] = await Promise.all([baseStatus(), auth.metadata()]);
      return { ...status, needsLogin: metadata2.needsLogin, catalog: {
        models: catalog.entries().length,
        loading: loads > 0,
        ...catalogError ? { error: catalogError } : {}
      } };
    };
    const notify = () => ctx.emit("llm/adapters-updated");
    const track = (work) => {
      const task = Promise.resolve().then(work);
      tasks.add(task);
      task.finally(() => tasks.delete(task)).catch(() => {
      });
      return task;
    };
    const syncAccount = () => {
      const task = accountTail.then(async () => {
        const metadata2 = await auth.metadata();
        if (metadata2.loginId === observedLoginId) return;
        observedLoginId = metadata2.loginId;
        catalogError = void 0;
        adapter.invalidateAccount(metadata2.loginId);
        await catalog.clear();
        if (!lifetime.signal.aborted) notify();
      });
      accountTail = task.catch(() => {
      });
      return task;
    };
    const refreshModels = (signal) => track(async () => {
      const active = AbortSignal.any([lifetime.signal, ...signal ? [signal] : []]);
      await syncAccount();
      active.throwIfAborted();
      loads++;
      catalogError = void 0;
      try {
        await catalog.refresh(active);
        active.throwIfAborted();
        notify();
      } catch (error) {
        if (!active.aborted) catalogError = error.code === "AUTH" ? "\u767B\u5F55\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002" : error.code === "PERMISSION" ? "\u8D26\u6237\u6CA1\u6709\u539F\u751F\u6A21\u578B\u8BBF\u95EE\u6743\u9650\uFF0C\u8BF7\u6838\u5BF9 Devin \u7EC4\u7EC7\u548C\u5957\u9910\u3002" : "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u6A21\u578B\u91CD\u8BD5\u3002";
        throw error;
      } finally {
        loads--;
      }
    });
    yield auth.registerFlow();
    yield ctx.llm.registerAdapter(["devin"], adapter);
    yield ctx.on("credentials/record-updated", (key) => {
      if (key === auth.key && !lifetime.signal.aborted) return track(syncAccount);
    });
    yield ctx.on("authorization/settled", (key, settlement) => {
      if (key !== auth.key || settlement !== "authorized" || lifetime.signal.aborted) return;
      return refreshModels(lifetime.signal).catch(() => {
        if (!lifetime.signal.aborted) ctx.logger.warn("devin: model directory refresh failed after login");
      });
    });
    const routes = ctx.inject(["connection"], (child) => child.effect(
      () => mountProviderLoginRoutes(child, controller, { apiPath: "/api/dsh-devin", refreshModels }),
      "Devin native login routes"
    ));
    yield () => routes.dispose();
  }, "Devin provider lifetime");
}
export {
  Config,
  DevinAdapter,
  apply,
  inject,
  name
};
