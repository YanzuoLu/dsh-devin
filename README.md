# dsh-devin

In-process native Devin model provider for DeepSeek Harness. Uses Devin's Connect-RPC model protocol directly. It does not run Devin CLI, OpenCode, a remote Devin Agent, proxy, or MCP server.

## Use

```sh
dsh plugin --profile web add github:YanzuoLu/dsh-devin
```

Enable this bundle in the web profile, refresh the GUI, then open **Settings → Devin → 登录**. Open the supplied browser link yourself. The temporary loopback callback completes PKCE login and DSH stores the grant in its native credential service. Login refreshes the model directory. **刷新模型** reloads it explicitly.

No applications open automatically. No desktop/CLI credentials are imported. Your default model is unchanged. The persistent session-token flow has no refresh token. Short-lived native JWTs are minted in memory with `GetUserJwt` and refreshed when close to expiry. Expired or rejected persistent credentials require another login.

## Ownership

DSH owns system instructions, effective history, pruning, compaction, image offloading, tool schemas, execution, approval and durable records. The adapter serializes only this assembled request. It adds no Devin agent prompt or separate history. A local HTTP listener exists only during OAuth.

The service's internal behavior is outside this adapter. No claim is made that the server adds no hidden instructions.

## Models

`GetCliModelConfigs` supplies concrete model UIDs, per-model context/output limits, image capability and structured family dimensions. Effort dimensions become native selectors. Fast and distinct Thinking lanes remain separate. Known context tiers below their family's largest declared window are hidden, including a capped lane whose full-window counterpart is unavailable. Unknown capacities stay unknown. Labels use spaces, not middle dots.

Saved effort-specific IDs retain their effort. Removed capped IDs resolve only to an advertised full-window route with matching mode and effort. Disabled, internal, router and composite Fusion entries are not fabricated as ordinary models. Catalog membership does not guarantee entitlement to every listed model.

## Requests and tools

`GetChatMessage` streams Connect-framed protobuf directly into DSH text/reasoning/tool chunks. Tool definitions and results are protocol fields, not prompt-injected tool simulations. DSH alone executes tools. Images remain attached to their original user/tool messages and use native DSH request versions. Documents remain native file handles.

Native reasoning signatures are retained only for the same login, exact model, unchanged effective history prefix and unchanged reasoning block. There is no cross-account or cross-model opaque replay. Auxiliary title/compaction calls flatten historical tool traffic and declare no tools.

Streams require a valid terminal trailer. Incomplete frames, invalid tool JSON, truncated tool responses and error trailers cannot become successful tool calls. Cancellation releases the request. Native DSH retry policy, not an internal transport retry loop, decides whether a failed call should be repeated. The default retries transport, timeout, rate-limit, server and broken-stream failures.

Devin's error explanation is kept in the failure message, with credentials redacted. Context-overflow wording becomes `CONTEXT_WINDOW_EXCEEDED`, so DSH compaction can recover. Account limits become `QUOTA`, and provider content-policy refusals become `REFUSAL`. None of these three is retried automatically.

## Organizations, billing and validation

The plugin uses the current Devin authorization and does not switch organizations. Devin's documentation attributes Desktop and CLI usage to the user's primary billing organization, which an enterprise administrator assigns. This plugin signs in with the CLI flow and has no per-request organization selector. Check subscription and credit attribution in the Devin account before large workloads.

The native path has been live-tested with Claude Haiku 5.5, GPT-6 Astra and SWE-2 through the actual DSH AgentLoop, including host-owned tool execution and the subsequent model response. This does not prove every advertised model or large-context workload works. The native protocol is private and can change.

## Build

`npm install` then `npm run build`. Host entries are content-addressed and generated client/patch files are replaced atomically to avoid pnpm hardlink mutation of running installations. Tests, captures and intermediate artifacts remain in `.cache` and are not shipped.
