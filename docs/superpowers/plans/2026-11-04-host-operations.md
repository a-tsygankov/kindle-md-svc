# Host Operations Implementation Plan

> Execute inline using superpowers:executing-plans. Track progress below and in
> docs/PROGRESS.md; this request authorizes the utilities and documentation.

**Goal:** Reproduce and manage the current proof safely on another host, with
durable progress and handoff records.

**Architecture:** Node owns config, diagnostics, lifecycle, and reset validation.
Thin PowerShell wrappers select Node and bootstrap pinned local Windows tools.

**Spec:** ../specs/2026-11-04-host-operations-design.md

## Constraints and review focus

- No hard-coded user paths or credentials in committed files.
- Source stays read-only; reset preflights all targets before any deletion.
- Start/stop describe a finite proof, not the future picker service.
- Stored PIDs cannot authorize killing unrelated processes.
- Exercise paths with spaces, traversal, source/target overlaps, junctions,
  malformed config, cancelled runs, and stale process state.

## Tasks

1. [x] Configuration and reset: write failing Node tests in `scripts/host.test.mjs`;
   implement `loadConfig`, `configure`, `resolveSelection`, `resetPlan`, and
   `resetHost` in `scripts/host-lib.mjs`. Tests use isolated temporary repos and
   assert source/config preservation, whole-plan preflight, and dry-run behavior.
2. [x] Lifecycle: write failing tests for `startRun`, `readStatus`, and `stopRun`;
   add `scripts/worker.mjs` and CLI `scripts/host.mjs`. A run-specific cancellation
   marker stops only a live owned child. Assert complete/failed/stopped outcomes,
   duplicate-start prevention, and stale state behavior.
3. [x] Host entry points: add pinned `toolchain.json`, config example,
   PowerShell common/setup/configure/start/status/stop/doctor/reset/test wrappers;
   route existing proof wrapper through shared tool selection. Test fresh Windows
   setup and lifecycle in a disposable repo with spaces; run the full suite.
4. [x] Document operations, status, decisions, progress, and handoff with actual
   evidence. Self-review scripts and ensure docs describe all remaining work.

No automatic commit/push is needed for this request. Record the uncommitted
state explicitly in the handoff so another session does not assume persistence
on the remote.
