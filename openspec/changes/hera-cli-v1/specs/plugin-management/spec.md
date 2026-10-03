# Spec Delta

## Purpose

Install local plugin packages into selected agent providers and maintain an inspectable record of Hera-managed installations across providers.

## ADDED Requirements

### Requirement: Install a local provider plugin
`hera plugin install --provider codex --path "./my-plugin"` SHALL validate a local plugin package and install it through the provider's supported integration. Success SHALL mean provider installation succeeded, not merely that a Hera record was written.

#### Scenario: Valid local package
- **WHEN** a user installs a valid local plugin with a compatible Codex CLI
- **THEN** the adapter makes the plugin available to subsequent Codex runs and reports installation success

#### Scenario: Invalid path or manifest
- **WHEN** the path is missing, empty, or does not contain a supported plugin manifest
- **THEN** Hera reports an error without recording a successful installation

#### Scenario: Provider installation failure
- **WHEN** the provider rejects installation or lacks the required capability
- **THEN** Hera reports the provider error and does not record the attempted installation as successful

### Requirement: Persist plugin installation records
Hera SHALL store successful plugin installations in `~/.hera/plugins.json`, including provider, plugin identity, canonical source path, and installation time. Reinstallation SHALL update a single provider/plugin record only after success.

#### Scenario: Record a successful installation
- **WHEN** provider installation completes successfully
- **THEN** Hera persists a record that can be read by a later CLI process

#### Scenario: Reinstall a plugin
- **WHEN** an already recorded provider/plugin is successfully installed again
- **THEN** its record is updated without creating duplicates

#### Scenario: Record write failure after installation
- **WHEN** provider installation succeeds but Hera cannot persist its registry
- **THEN** Hera reports partial success with a nonzero exit and retry can reconcile the existing installation

### Requirement: List installed plugins
`hera list plugins` SHALL list Hera-recorded installations across providers with plugin name, provider, source path, and installation time. It SHALL report an empty registry successfully without starting the scheduler.

#### Scenario: Multiple recorded providers
- **WHEN** the registry contains installations associated with different providers
- **THEN** listing includes each record and its provider identity

#### Scenario: No installed plugins
- **WHEN** `plugins.json` does not exist
- **THEN** listing reports no Hera-managed plugins and exits successfully

### Requirement: Preserve independent configuration
Plugin installation SHALL preserve unrelated provider configuration and concurrent registry updates. Corrupt or unsupported-version plugin registries SHALL produce errors without being replaced. Hera SHALL NOT bypass provider trust decisions.

#### Scenario: Existing provider setup
- **WHEN** a plugin is installed into a provider that already has other plugins and settings
- **THEN** the existing unrelated configuration remains intact

#### Scenario: Concurrent installations
- **WHEN** two different plugins are successfully installed concurrently
- **THEN** both records remain in the registry

#### Scenario: Corrupt plugin registry
- **WHEN** a plugin command encounters invalid persisted data
- **THEN** it reports the error and leaves the original registry intact
