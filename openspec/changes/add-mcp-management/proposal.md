# Proposal

## Why

Users currently configure the same MCP server independently in each agent platform. Hera should save one local server definition and register it with multiple installed, supported platforms through a single command.

## What Changes

- Add `hera mcp add <name> [--env KEY=value ...] -- <command> [args...]` for stdio MCP servers, including shell line continuations and repeated environment flags.
- Save versioned JSON definitions in `~/.hera/mcp.config` before offering platform registration.
- Bundle `platform.json` as the fixed supported-platform catalog, initially Codex and Claude Code; catalog membership does not imply installation.
- Detect available platform executables and offer an interactive multiple selection with a skip option.
- Register selected servers in each platform's user configuration through dedicated native CLI adapters, preserving unrelated configuration and reporting individual failures.
- Keep MCP platform support separate from agent execution support: Claude MCP registration does not enable Claude run, scheduling, models, or plugins.

## Capabilities

### New Capabilities

- `mcp-management`: Parse, persist, and register named stdio MCP definitions with installed supported platforms.

### Modified Capabilities

None. No main specs exist. The in-flight `hera-cli-v1` change explicitly defers standalone MCP management; this separate change introduces it and supersedes that deferral for MCP only.

## Impact

Affects the Commander command tree, shared state helpers, packaged assets, platform adapters, terminal interaction, tests, and README. Adds a local secret-bearing registry and native MCP registration calls. Existing run, schedule, model, and plugin commands remain within their existing provider scope. HTTP transports, shell-script interpretation, MCP server execution by Hera, removal/list commands, and general Claude execution are outside this change.
