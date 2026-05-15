# Simulation workflows

## Bridge to canwxsim-cli

`POST /api/simulations/runs` creates a run. The mode is selected by
`CANWXLAB_SIMULATION_MODE`:

- `stub` (default) — deterministic in-process completion using
  `sample_fields.generate_grid_field`. Useful for offline work.
- `cli` — invokes `canwxsim-cli` via subprocess.

In `cli` mode the resolver looks for `canwxsim-cli` in this order:

1. The `PATH`.
2. `<repo>/target/release/canwxsim-cli[.exe]`.
3. `<repo>/target/debug/canwxsim-cli[.exe]`.

The API never compiles Rust at request time. If the binary is not found, the
run is recorded with `status=failed` and `provenance.error` explaining the
miss — no HTTP exception is raised.

Subprocess invocation uses a 30-second timeout. The CLI's stdout/stderr tail
(last 512 bytes each) is captured into `provenance` for diagnosis.

## Endpoints

- `POST /api/simulations/runs` — create.
- `GET  /api/simulations/runs` — list all in-memory runs.
- `GET  /api/simulations/runs/{run_id}` — fetch one.
- `GET  /api/simulations/runs/{run_id}/fields/{field_name}` — sample field
  (stub-generated regardless of mode for now).

Runs are kept in process memory only. They do not survive an API restart.

## Frontend status

The existing simulation panel still treats runs as immediately-completed
stubs. Polling on `status` (`queued | running | completed | failed`) and
surfacing failures from `provenance.error` is the next frontend step and is
**not yet wired**. All simulation output must be labelled `EXPERIMENTAL` in
the UI.
