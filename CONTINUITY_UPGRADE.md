# Nemotron Agent Lab — Continuity Upgrade

This delivery continues the v2 repository. It does not replace the existing application or its NVIDIA/Python runtime.

## Added in this continuity pass

- OAuth identity collections for Google, GitHub and Discord, retaining legacy provider fields for compatibility.
- Verified-email handling and explicit authenticated provider-linking flows. Matching emails are not silently merged.
- Profile editing, username availability validation, reserved-name protection and case-insensitive uniqueness.
- A migration command that backfills linked accounts/usernames, stable message IDs, root branches and revision metadata.
- Branch-aware conversation persistence. Branches retain only their own suffix after the fork point; the main branch remains compatible with the legacy `messages` field.
- Message editing as a new branch, response regeneration as a new version, and previous/next response version navigation.
- Assistant response copy/share/regenerate/branch actions; public read-only share snapshots; owner list, copy and revocation controls.
- Context-aware title updates, manual title protection and stale-update checks.
- IndexedDB composer drafts, last-chat restoration, scroll-position restoration and interrupted-generation detection.
- Chat navigation while a generation continues, branch-specific stream persistence and follow-the-bottom scrolling.
- Memory refresh after agent saves, settings changes, cross-tab events and browser focus changes.
- Dynamic starter suggestions using recent chat titles plus built-in capability prompts.

## Upgrade steps

1. Back up MongoDB.
2. Install dependencies with `npm ci` (or `npm install`).
3. Configure the existing `.env` values, especially `MONGODB_URI`, `SESSION_SECRET`, `FRONTEND_URL`, OAuth credentials and NVIDIA API key.
4. Run `npm run migrate:users` once before using the new account/branch features. It is safe to rerun.
5. Rebuild the Python sandbox using `npm run sandbox:build` on the API runner host.
6. Build and start using `npm run build` and `npm start`.
7. Test provider linking, branch editing/regeneration, public sharing/revocation and Python sandbox isolation in the target deployment.

## API additions

- `GET/PATCH /api/account/profile`
- `GET /api/account/profile/username-availability`
- `GET /api/auth/:provider/link` (authenticated OAuth linking start)
- `POST /api/chats/:id/branches`
- `PATCH /api/chats/:id/branches/:branchId/activate`
- `POST /api/chats/:id/messages/:messageId/versions`
- `PATCH /api/chats/:id/messages/:messageId/version`
- `GET/POST /api/shares`
- `DELETE /api/shares/:shareId`
- `GET /api/public/shares/:shareId` (public read-only snapshot)

## Verification performed here

- Backend JavaScript syntax checks passed.
- Nine Node unit tests passed, covering branch-prefix behavior and interpreter validation/queue limits.
- The frontend production build was not verified in this environment: dependency installation timed out and Vite was unavailable. No claim is made that the production build or live OAuth/MongoDB/Docker integration has been tested here.

## Known remaining limitations

- Attachment ingestion into Python is not yet wired end-to-end; current image/video model input behavior remains separate from the interpreter artifact pipeline.
- The OAuth migration and account linking require a real MongoDB database and live provider credentials for deployment testing.
- A complete production security audit, browser/device QA, live Docker sandbox threat tests and end-to-end regression suite remain necessary before public deployment.


## v4 — Docker-optional native Python provider

The interpreter no longer requires a Docker image or Docker CLI. `sandboxManager.js`
runs the configured Python executable (`PYTHON_BIN`, default `python3` on Unix or
`python` on Windows) as a child process in a fresh temporary working directory.
The public `execute_python` tool and `/api/interpreter/execute`,
`/api/interpreter/cancel/:id`, and artifact download API contracts are retained.

### Managed hosting setup

1. Confirm the hosting plan provides Python 3 and permits Node.js `child_process.spawn`.
2. Set `PYTHON_BIN` to the provider's Python executable if it is not on PATH.
3. Set `PYTHON_ALLOW_UNSANDBOXED=true` only for a private/trusted deployment.
4. Run `npm run sandbox:check` to verify Python is executable.
5. Install required Python packages in the host's permitted environment/image. The app
   does not run `pip install` dynamically.

### Critical security limitation

A native Python subprocess is not a security sandbox. It runs under the same OS account
as the Node service. The implementation uses a temporary working directory, a minimal
environment, output limits, a timeout, cancellation and artifact limits, but Python code
can still access files and network resources permitted to that OS account. These controls
do not provide filesystem, network, CPU or memory isolation.

Therefore this native mode is suitable only for a trusted/private deployment where users
are authorized to run arbitrary code with the application's OS-account permissions.
Do not expose it to arbitrary public users or untrusted prompts. Managed hosting without
root access cannot provide strong per-execution OS isolation by application code alone.
For public multi-user use, configure a separate isolated execution service and keep its
credentials on the backend. Docker is optional for this app, but a real isolation boundary
is still required for hostile code.

### Docker

The `sandbox:build` script was removed. The interpreter does not invoke Docker.
