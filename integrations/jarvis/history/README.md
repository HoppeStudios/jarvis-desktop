# Codex history import

This source-only migration utility converts an authorized private Codex inventory
and history exports into inert Pi v3 JSONL snapshots. It does not run old tools,
move project files, copy authentication or modify Codex databases.

## Requirements

- Windows with Python 3.11 or newer; only the standard library is used.
- A local Codex installation and its existing readable `state_5.sqlite` metadata.
- An authorized private inventory with `projects.projects` and `threads` from
  native Codex project/chat listing. Each chat needs `id`, `kind` (`codex` or
  `chatgpt`), title, creation/update timestamps and its existing project path.
- Available local rollout JSONL, native `read_thread` exports (`metadata` and
  `pages`), or official app-server paginated exports (`metadata`, `itemsFile`
  JSONL of `{turnId,item}`, and `turnMetadata`). A missing legacy rollout path
  is normal for paginated Codex histories. Export them with read-only
  `thread/read`, `thread/turns/list` and `thread/items/list`; do not resume work.
- The reviewed Jarvis Desktop build from this repository, an existing provider
  login in that application, and its opt-in local MCP endpoint.

Keep the inventory, exports, snapshots and receipts outside every repository.
They contain private conversations. Never include browser/authentication stores.

```powershell
python integrations/jarvis/history/import-history.py `
  --inventory <private-inventory.json> --exports <private-exports-directory> `
  --pi-home <private-staging-root> --receipt <private-receipt.json>
python -m unittest discover -s integrations/jarvis/history -p 'test_*.py'
```

Launch the reviewed desktop with `PI_DESKTOP_PI_IMPORT_DIR` set to the staging
root's `sessions` directory and `PI_DESKTOP_MCP_CONTROL=1`. Use the existing
`session/importScan`, then `session/importRun` with returned candidate identities
in small batches. Deterministic UUID5 source identities prevent duplicate
imports. The desktop imports them into its managed sessions; writing CLI JSONL
alone does not make them managed desktop chats. Bind imported sessions to the
actual logged-in desktop provider ID with `session/configure`, not the vendor
name. Open the existing project and imported session through the desktop API to
verify visible transcript loading. No keyboard or clipboard input is necessary.

Existing snapshots are preserved. `--refresh-owned` replaces a staging snapshot
only when its receipt hash still matches, with a second check before atomic
publication. This does not update an already-imported managed session.

## Scope and limits

User/assistant text is retained; reasoning and analysis messages are excluded.
Media remains a reference to the original conversation. Large historical tool
records are abbreviated with a reference to their private source and imported
as explicitly inert text. Empty sessions are skipped by the desktop importer.
Original chats and project folders remain intact. Missing project folders get a
clearly separated archive location; cloud project file content is not exported.
This is a point-in-time migration, not ongoing bidirectional chat sync.

The installed migration was verified with 428 nonempty chats from 429 source
records, 12 local project registrations, and bounded native transcript reads of
small and large imported conversations. These are counts from the private local
acceptance receipt, not test fixtures or a promise of identical media rendering.
