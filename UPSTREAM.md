# Protocol references

This implementation uses DSH's native LlmAdapter, credentials, authorization and attachment interfaces. No third-party harness or Devin runtime is bundled.

Protocol sources inspected as reference data

- Cognition `@cognitionai/opencode-devin` 0.3.0, MIT, for the production browser PKCE flow. Package gitHead `ef8a9df7e31272ae264d6c09577c4d645ee64a4d`.
- [Official package README](https://cdn.jsdelivr.net/npm/@cognitionai/opencode-devin@0.3.0/README.md)
- [oakimov/devin-opencode-provider](https://github.com/oakimov/devin-opencode-provider), MIT, for native model discovery, metadata and authentication field mappings.
- [CaiJingLong/devin-gateway](https://github.com/CaiJingLong/devin-gateway), MIT, for protocol field correspondence and Connect framing. The server/proxy is not used.
- [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi), MIT, for published Devin protobuf definitions, signed history and usage semantics. The runtime is not used.
- [Devin models](https://docs.devin.ai/cli/models)
- [Devin billing](https://docs.devin.ai/admin/billing/self-serve)

The binary encoder, decoder, projection, transport and DSH integration are implemented here. Reference downloads, schemas and synthetic tests are private cache artifacts. Runtime wire behavior was checked against the user's explicitly authorized native Devin login.

Provider-neutral DSH login controller/UI components originate from the same workspace's dsh-cursor project. There is no runtime dependency on dsh-cursor.
