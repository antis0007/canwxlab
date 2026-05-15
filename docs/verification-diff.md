# Verification & diff overlay

## Current state

The verification API exposes:

- `GET /api/verification/cases` — list cases (in-memory, default-seeded).
- `POST /api/verification/cases` — create a new case.
- `GET /api/verification/cases/{case_id}` — fetch a single case.
- `GET /api/verification/cases/{case_id}/summary` — per-field error metrics
  (MAE, RMSE, bias, max abs error, sample count).
- `GET /api/verification/cases/{case_id}/diff/{field_name}?diff_mode=…` —
  spatial diff grid; modes: `A_MINUS_B`, `ABSOLUTE_ERROR`, `PERCENT_ERROR`,
  `THRESHOLD_EXCEEDANCE`.

The diff grid is **deterministic, generated, MOCK**. The response includes
`is_generated_mock: true` so downstream consumers can flag it in UI. Real
observed/forecast archive ingestion is not yet implemented.

## Data model

- `VerificationCase` — id, name, two `VerificationTarget`s (A vs B), fields,
  bounding box, grid dimensions.
- `VerificationTarget` — label, source_id, optional model_name.
- `VerificationField` — name, unit.
- `SpatialDiffSummary` — field, mode, bbox, rows×cols grid (row-major), and
  `is_generated_mock` flag.
- `ErrorMetric` — MAE, RMSE, bias, max abs error, sample count.

## Frontend status

The existing `DiffPanel` UI still consumes the legacy
`/api/verification/summary` endpoint. Rendering a real deck.gl diff layer
sourced from `/cases/{id}/diff/{field}` is the next frontend step and is **not
yet wired**. When wired, the overlay must be visually labelled
`MOCK/GENERATED` until real archives back the case.

## Limitations

- In-memory case store; nothing is persisted across API restarts.
- No real observed/forecast ingest; values are synthetic.
- Diff modes are computed from the generator output only — they do not yet
  reflect true model-minus-obs deltas.
