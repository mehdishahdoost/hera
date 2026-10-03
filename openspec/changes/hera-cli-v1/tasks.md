# Tasks

## 1. Package and command structure

- [x] 1.1 Create the TypeScript/Node package, npm `hera` binary, build/typecheck/test scripts, and pinned dependencies; verify a clean install and build succeed and the compiled executable prints help.
- [x] 1.2 Implement the exact public command tree with required flag validation and provider dispatch; verify parser tests cover all seven agreed command forms, missing values, unknown providers, and removal without creation flags.
- [x] 1.3 Document npm installation and the agreed commands in README.md; verify examples match CLI help and mark MCP and Claude implementation as deferred.

## 2. Local state and provider contracts

- [x] 2.1 Define provider-neutral execution, model, and plugin contracts and a registry with Codex as its initial adapter; verify a fake second adapter works through the shared handlers and unsupported capabilities fail without fallback.
- [x] 2.2 Implement versioned schedule/plugin schemas and home-directory path resolution; verify missing registries are empty, malformed/unsupported files remain untouched, and unsafe names cannot escape log directories.
- [x] 2.3 Implement locked read-modify-write operations with atomic replacement and stale-lock recovery; verify separate-process tests preserve concurrent updates and injected failures leave complete previous or new JSON.
- [x] 2.4 Document the JSON formats, paths, and provider prerequisites; verify example records validate against the schemas without credentials or copied environments.

## 3. One-shot execution and logs

- [ ] 3.1 Implement Codex execution through noninteractive CLI spawning with literal stdin prompts, the exact model, and saved/current cwd; verify a fake executable observes the correct inputs and exactly one invocation on success and failure.
- [x] 3.2 Implement streamed stdout/stderr logs, generated ad hoc session names, and appended scheduled execution records; verify unique paths, repeated-run retention, timestamp/status markers, and log creation/write failure handling.
- [ ] 3.3 Implement process exit propagation, interrupt forwarding, and cleanup without retries; verify subprocess tests cover missing binaries, nonzero exit, cancellation, and absence of schedule or scheduler side effects.
- [ ] 3.4 Document one-shot behavior, provider permission/authentication delegation, and log naming; verify the README example runs against a fake provider and prints the expected log path.

## 4. Provider model listing

- [ ] 4.1 Implement a bounded Codex app-server stdio client for initialization, paginated model/list, and shutdown; verify protocol fixtures cover pagination, empty results, malformed responses, timeout, and process cleanup.
- [ ] 4.2 Wire `hera list models --provider codex` to provider discovery and document catalog limitations and tested Codex version; verify output uses returned identifiers unchanged and no prompt or direct model API request is made.

## 5. Schedule registration and management

- [ ] 5.1 Implement task registration with required flags, five-field cron validation, captured cwd/time zone, safe globally unique names, and identical-registration recovery; verify persistence, conflicts, and invalid-input no-side-effect tests.
- [ ] 5.2 Implement `hera list schedule` and `hera schedule remove "name"`; verify empty/populated output, scheduler status, unknown names, concurrent updates, retained logs, and removal with a running invocation.
- [ ] 5.3 Document schedule storage, naming, captured execution context, and removal semantics; verify examples against CLI integration tests.

## 6. Background scheduler

- [ ] 6.1 Implement detached scheduler startup, singleton ownership with heartbeat, readiness acknowledgement, and saved-but-inactive error reporting; verify concurrent registrations start one owner, terminal closure leaves it running, and startup failures are recoverable.
- [ ] 6.2 Implement registry reconciliation and future cron dispatch through the shared runner; verify clock-controlled tests for stored cwd/time zone, DST transitions, additions/removals, missed-run skipping, and same-task overlap skipping.
- [ ] 6.3 Implement occurrence claims and active-child recovery with stale scheduler ownership checks; verify crash/restart tests avoid replay of claimed work and overlap with surviving invocations, and provider failures are not automatically retried.
- [ ] 6.4 Implement idle exit after the last task and invocation finish; verify a later registration restarts the scheduler, and run/list commands never start it or create reboot/login integration.
- [ ] 6.5 Document scheduler lifetime, restart by identical registration, runtime diagnostics, and manual process shutdown; verify a subprocess lifecycle smoke test exercises registration, execution, removal, and idle shutdown.

## 7. Plugin installation and listing

- [ ] 7.1 Implement local manifest validation and Hera-owned Codex marketplace staging using the installed CLI's supported marketplace/add interfaces; verify a harmless skill-only fixture installs in isolated provider state and provider recognition is confirmed without modifying the user's normal setup.
- [ ] 7.2 Persist successful provider/plugin installation records and support convergent reinstallation; verify rejected installs add no successful record, duplicate records are avoided, concurrent installs survive, and post-install registry failure reports a recoverable partial outcome.
- [ ] 7.3 Implement `hera list plugins` from the Hera registry and document supported local package formats and provider-managed activation; verify empty/multi-provider listings, corrupt-file preservation, and preservation of unrelated provider configuration.

## 8. End-to-end package verification

- [ ] 8.1 Build and pack the npm artifact, install it into a temporary prefix, and exercise the seven agreed commands with isolated state and fake providers; verify shipped files, executable permissions, detached entrypoint resolution, and cleanup.
- [ ] 8.2 Run typecheck and the complete test suite, including concurrency and scheduler lifecycle checks; record verified runtime/platform and Codex compatibility in the README, and confirm no MCP commands, reboot hooks, or direct inference API integration have been introduced.
