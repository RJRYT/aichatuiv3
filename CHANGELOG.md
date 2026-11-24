# Changelog

## [8.5.5] - 2026-11-24

### Fixed
- Reworked the conversation metadata/delete dialog layout and switch semantics; corrected nested-label markup that could distort the pinned toggle.
- Added component-scoped theme styles for dialogs, pinned controls, model selection, branch selection, and other interactive menus instead of relying on broad inherited overrides.
- Fixed a stale-revision persistence conflict: completed assistant responses now merge against the latest chat revision and preserve messages added from another tab/device while generation was running.
- Increased the default soft agent-turn deadline from one hour to four hours so long tasks are not prematurely finalized at the previous one-hour boundary.
- Clarified that workspace paths are private server-side storage and that requested deliverables must be exported to the user's File Library before they are reported as available.

### Improved
- Replaced native browser alert, prompt, and confirm dialogs with a consistent in-app dialog system.
- Replaced native select menus used for model, branch, and preference selection with theme-aware custom dropdowns.

### Verification
- Focused server tests and source-contract tests pass; full dependency install and production build remain subject to the environment's dependency availability.

All notable changes to this project are documented here. Entries describe release-level changes; patch notes are consolidated here rather than appended to the README.

## [8.5.4] - 2026-11-24

### Fixed
- Fixed the agent-status tool's missing checkpoint-manager import, which caused `get_agent_status` to fail with `getLatestAgentCheckpoint is not defined`.
- Made usage analytics independent of chat documents; user messages, assistant responses, and regenerated versions are backfilled before deletion so usage history remains.

### Improved
- Added server-side discovery of active generations for same-account recovery on another device.
- Added a File Library search/read tool for inspecting generated project artifacts and previously uploaded attachments.
- Unified generated artifacts and uploaded conversation files in the File Library, with re-attach support.
- Added attachment source choices for Photos, Files, From library, and From URL; URL selection adds a link as prompt context rather than downloading the remote file.
- Restricted user-configurable tool controls to Python sandbox, Node.js sandbox, Web search, and Image generation; custom endpoint tools are no longer offered or exposed to the model.
- Rebuilt the system prompt around Nemi and removed volunteered product, owner, provider, hosting, and runtime disclosures.
- Replaced generic hardcoded starter cards with context-derived suggestions from saved memories and recent conversations.
- Moved File Library access to the composer area and added response-duration metadata after the model badge.
- Updated visible application branding to Nemi and added semantic theme-aware styling for common controls.

### Notes
- Uploaded files and generated artifacts remain distinct storage records internally, but are presented together in the File Library.
- From URL currently adds the public URL to the message context; it does not download and persist a remote copy.
- Cross-device active-generation discovery and plan replay are implemented server-side and in the client; end-to-end multi-device validation still requires a live account and persistent database.

## [8.5.3]

### Improved
- Extended long-running agent execution limits and introduced graceful Stop/timeout summaries, bounded retry recovery, and ZIP-first project delivery guidance.

## [8.5.2]

### Improved
- Limited suggested next steps to the latest assistant response, restored elapsed-time display from persisted start timestamps, and made chat deletion options resource-aware.

## [8.5.1]

### Improved
- Added chat refresh recovery, model-generated next-step suggestions, complete chat-associated cleanup, bulk chat deletion, and bulk File Library deletion.

## [8.5.0]

### Improved
- Added durable generation recovery foundations, workspace file/directory handling, archive verification, and execution retry safeguards.

## [8.4.2]

### Fixed
- Improved automatic model routing for tool-requiring follow-ups and controlled recovery from empty model responses.

## [8.4.1]

### Improved
- Unified personality and communication controls and applied them consistently to system instructions.

## [8.4.0]

### Improved
- Added slider-based assistant character controls and saved personality profiles.

## [8.3.0]

### Improved
- Added behavior-focused assistant personas and user-defined personality instructions.

## [8.2.0]

### Improved
- Added automatic model routing, personal integrations, and expanded usage analytics.

## [8.1.0]

### Improved
- Added agent execution experience and reliability improvements.

## [8.0.0]

### Added
- Introduced the autonomous agent experience and tool orchestration foundation.
