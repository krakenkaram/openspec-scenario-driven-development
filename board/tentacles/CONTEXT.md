# Context — Tentacles Board

The Tentacles board is a native macOS app that surveys the OpenSpec changes across your
repositories and shows, at a glance, how far each one has progressed.

## Glossary

### Change
A single OpenSpec unit of work living under a repo's `openspec/changes/<name>/`. The board
shows one card chain per change.

### Phase
A stage in a change's lifecycle, shown as a node in the card chain:
grill → proposal → specs → design → tasks → apply → review → done.

### Phase complete
A phase is **complete when the next phase's artifact exists**, not merely when the phase's own
artifact exists. For example, grilling is complete once `proposal.md` exists — the presence of
`grill.md` alone does **not** mean grilling has finished, because that file is written while the
interview is still in progress. The final planning phase, having no successor artifact, is
complete once the plan as a whole is complete.

### Repository
A git repository the board surveys, identified by its shared git common-dir. One repository owns one
or more Worktrees. Its display label is derived from the repository, not from any single worktree
folder.
_Avoid_: Project, folder, repo (informal).

### Worktree
A single git checkout under a Repository (a working directory on a branch). A Worktree may hold one
or more Changes at once. The **primary** worktree is the repository's main checkout; the others are
linked worktrees.
_Avoid_: Checkout, clone, project.

### Sidebar
The left-hand navigation tree listing each Repository and, when expanded, its Worktrees. The sidebar
navigates only — choosing what the main panel shows — and holds no other chrome (no title, settings,
or status strip).

### Selection
The single active scope chosen in the Sidebar. Selecting a Repository shows all its Changes'
phase-node progress in the main panel; selecting a Worktree shows that worktree's own Change
chain(s) pinned above its live branch diff. Exactly one selection is active at a time.
_Avoid_: Focus, active tab.

### Status indicator
The per-Worktree signal shown on its sidebar row: **done**, **in progress**, or **idle**. When a
Worktree holds more than one Change the least-done Change wins, so it reads done only when all its
Changes are done. It is derived from the same phase state the card chain shows.
_Avoid_: Badge, health, traffic light.

### Scan root
The directory the board scans for repositories that contain OpenSpec changes. Chosen by the user
in Settings; falls back to an environment override and then to a default location when unset.

### Target
An AI coding host the workflow can be set up for: **Claude**, **Kiro**, or **Kiro Crew**. Kiro Crew
is a superset of Kiro (everything Kiro needs, plus its host wiring). A user may set up more than one
target on the same machine.
_Avoid_: Tool, adapter, platform.

### Setup
Installing everything a chosen target needs — globally, on the user's machine — so the atdd-driven
OpenSpec workflow can run: the canonical skills, the agent adapters, OpenSpec's global configuration,
and any target-specific host wiring. Setup is global only; it never overlays an individual repository.
_Avoid_: Install, configure, provision.

### Doctor
A check that verifies a target's Setup is present and correct and reports each finding pass/fail. When
findings fail, the doctor offers to repair them (a repair re-runs Setup for the affected target).
_Avoid_: Health check, verify, lint.
