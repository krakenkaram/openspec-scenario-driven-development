# Board phase list derives from CLI status, not schema.yaml

- Status: accepted

The board must render each change's planning phases from its actual schema
(atdd-driven has a `grill` phase; spec-driven does not), instead of a hardcoded
five-phase list. The phase ids and their order for a change are taken from the
`artifactPaths` keys returned by `openspec status --change <name> --json`, not by
locating and parsing the schema's `schema.yaml`. The decisive reason: built-in
schemas such as `spec-driven` have no `schema.yaml` on disk in the surveyed repo,
whereas the CLI status output returns the real per-change artifact ids for every
schema. The board already fetches this status per change and previously discarded
the ids by intersecting them with the hardcoded `PHASES` array.

## Considered options

- **CLI status output (chosen).** Always present for every change regardless of
  schema origin; already fetched; requires no file discovery. The board renders
  the returned artifact ids in order.
- **Parse `.openspec.yaml` + `schema.yaml`.** Gives the ordered artifact list with
  rich descriptions, but breaks for any schema whose `schema.yaml` is not in the
  repo (spec-driven and other built-ins) and adds "walk up the tree" resolution.
  Rejected as the per-change source.
- **Widen the `PhaseId` union to a known superset.** Re-hardcodes the closed-world
  assumption and breaks the moment a new schema introduces a new id. Rejected.

## Consequences

- `PhaseId` becomes `string` and the hardcoded `PHASES` constant is repurposed as
  `ATDD_FALLBACK_PHASES`, used only as the status-failure fallback (below);
  `shapeChange` derives the ordered phase list from `artifactPaths` keys.
- Verified against the CLI: `artifactPaths` key order equals the schema's declared
  artifact order for both bundled schemas (atdd-driven and spec-driven), so the
  board trusts the returned key order and imposes none.
- The Settings "available schemas" list (name, description, ordered steps) is a
  separate concern sourced from `openspec schemas --json`, consistent with this
  decision.
- On a status failure with no `artifactPaths`, the board falls back to the
  atdd-driven five phases rather than a blank chain (accepted edge trade-off).
