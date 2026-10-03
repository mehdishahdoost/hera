# Spec Delta

## Purpose

Provide a consistent CLI for invoking installed agent providers once, discovering their models, and preserving provider output for later inspection.

## ADDED Requirements

### Requirement: npm CLI entry point
The package SHALL expose a `hera` executable through npm installation and provide command help and validation errors.

#### Scenario: Installed executable
- **WHEN** a user installs the built package into an npm prefix and runs `hera --help`
- **THEN** the executable lists the supported commands and exits successfully

### Requirement: One-shot invocation
`hera run` SHALL require `--provider`, `--model`, and `--prompt`, invoke the selected provider exactly once in the current working directory, stream its output, wait for completion, and exit without creating a schedule or retrying.

#### Scenario: Successful run
- **WHEN** `hera run --provider codex --model "gpt-6.1" --prompt "Test"` is executed with a working provider
- **THEN** one provider task receives the exact model and prompt, and Hera exits successfully after completion
- **AND** no schedule is created and no scheduler is started

#### Scenario: Provider failure
- **WHEN** the provider exits with a nonzero status
- **THEN** Hera records and reports the failure, exits nonzero, and does not launch a replacement task

#### Scenario: Literal prompt
- **WHEN** the prompt contains quotes, newlines, or shell syntax
- **THEN** it reaches the provider as literal prompt content and is not evaluated by a shell

#### Scenario: Missing input
- **WHEN** a required flag is missing or its value is empty
- **THEN** Hera reports a validation error before launching the provider

### Requirement: Provider boundaries
Hera SHALL support Codex initially, delegate execution and authentication to its installed CLI, and select providers explicitly. An unregistered provider or unavailable capability SHALL produce an actionable error without fallback.

#### Scenario: Future provider not yet implemented
- **WHEN** a user selects `claude` before its adapter is available
- **THEN** Hera identifies the unsupported provider and does not invoke Codex instead

#### Scenario: Missing Codex executable
- **WHEN** a Codex operation is requested without the executable installed
- **THEN** Hera exits nonzero with installation guidance

### Requirement: Session logs
Hera SHALL record provider stdout, stderr, timestamps, execution identity, and outcome under `~/.hera/<provider>/<session-name>.log`. Ad hoc runs SHALL receive unique generated names displayed with their log path. Repeated scheduled runs SHALL append to the schedule-name log.

#### Scenario: Two ad hoc runs
- **WHEN** two runs start at the same timestamp
- **THEN** they have distinct session names and log files

#### Scenario: Repeated scheduled execution
- **WHEN** schedule `daily-test` runs twice with provider `codex`
- **THEN** `~/.hera/codex/daily-test.log` retains both executions with distinct execution identifiers and outcomes

#### Scenario: Log cannot be created
- **WHEN** Hera cannot open a run's log
- **THEN** it reports the error before starting the provider task

#### Scenario: Log write fails during execution
- **WHEN** a provider is running and persistence of its output fails
- **THEN** Hera terminates that invocation and reports a logging failure

### Requirement: Run cancellation
Hera SHALL forward user termination to the active provider process, complete log cleanup, and report cancellation without restarting the task.

#### Scenario: Interrupt a foreground run
- **WHEN** the user interrupts `hera run`
- **THEN** Hera stops its provider invocation and exits nonzero after flushing available logs

### Requirement: Provider model discovery
`hera list models --provider codex` SHALL display model identifiers and names returned by Codex's model discovery interface. It SHALL retrieve the complete paginated catalog, avoid hard-coded substitutes, and treat catalog membership as distinct from guaranteed inference access.

#### Scenario: Paginated catalog
- **WHEN** the provider returns two pages of visible models
- **THEN** Hera lists entries from both pages and exits without running a prompt

#### Scenario: Discovery unavailable
- **WHEN** discovery times out or the installed provider lacks a compatible interface
- **THEN** Hera exits nonzero with the cause and does not display fabricated models
