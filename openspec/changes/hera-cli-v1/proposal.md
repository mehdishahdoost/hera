# Proposal

## Why

Running recurring agent tasks currently requires manually coordinating provider CLIs, configuration, and output. Hera will provide one npm-installed CLI for one-shot execution, scheduled work, and plugin management while keeping provider-specific behavior behind adapters.

## What Changes

- Build a TypeScript/Node.js CLI distributed through npm with a `hera` executable.
- Support Codex first, with an adapter boundary for future providers such as Claude Code.
- Add `hera run --provider codex --model "gpt-6.1" --prompt "Test"` for exactly one provider invocation, with no Hera retries or schedule creation.
- Add `hera schedule --provider codex --model "gpt-6.1" --prompt "Test" --cron "0 9 * * *" --name "daily-test"`, `hera list schedule`, and `hera schedule remove "daily-test"`.
- Persist schedules in `~/.hera/schedule.json`; automatically start one background scheduler on registration, survive terminal closure, and omit reboot autostart.
- Stream provider output and preserve logs at `~/.hera/<provider>/<session-name>.log`.
- Add `hera plugin install --provider codex --path "./my-plugin"` and `hera list plugins`, recording installations in `~/.hera/plugins.json`.
- Add `hera list models --provider codex` using provider model discovery.
- Defer standalone MCP commands and `mcp.json`, a separate skill-install command, Claude implementation, and reboot startup integration.

## Capabilities

### New Capabilities

- `provider-execution`: One-shot provider execution, adapter contracts, model discovery, and per-session logging.
- `task-scheduling`: Persistent cron schedules and automatic background execution.
- `plugin-management`: Local plugin installation through provider adapters and persistent installation records.

### Modified Capabilities

None; the repository has no existing capability specs or implementation.

## Impact

Introduces the npm package, command parser, provider adapters, scheduler, JSON persistence, and tests. Proposed dependencies are Commander, Zod, Croner, and Vitest. Runtime state lives under the user's home directory. Codex must be installed and authenticated independently; Hera delegates model access to its CLI. Implementation must verify the installed Codex plugin and model-discovery interfaces rather than assume common commands across providers.
