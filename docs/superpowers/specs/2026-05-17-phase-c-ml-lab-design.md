# Phase C: ML Lab + Forecast Verification Engine

**Date:** 2026-05-17
**Status:** Draft design, awaiting Phase A + B completion
**Depends on:** Phase A (event log for training data), Phase B (multi-domain data)

## Problem Statement

The platform accumulates a rich event log of observations and forecasts. Turn that archive into a scientific instrument: train models on historical data, backtest predictions against reality, serve live predictions as layers, and measure model skill systematically.

## What Gets Built

### C1: Prediction Record Schema
A model prediction is recorded as a claim about the future — a special `SpatiotemporalEvent` with `truth_mode = "predicted"` and a `model_id` field.

```python
class ModelPrediction(SpatiotemporalEvent):
    model_id: str
    model_version: str
    issued_at: datetime       # when the model made the prediction
    valid_for: datetime       # what time it predicts
    featureset_id: str        # training data version
    prediction_ensemble: list[float]  # p10, mean, p90
```

### C2: Forecast vs. Reality Validation
When observed reality arrives for a predicted time window, the system creates a `ModelValidation` record:

```python
class ModelValidation(BaseModel):
    prediction_id: UUID
    observed_value: float
    absolute_error: float
    bias: float
    skill_score: float
    compared_at: datetime
```

Metrics computed per model, per variable, per region, per lead time:
- MAE, RMSE, bias (already in `VerificationMetric`)
- Add: CRPS (continuous ranked probability score), Brier score, reliability diagrams
- Add: spatial displacement error (did the model get the pattern right but shift it 50km east?)

### C3: ML Workbench
- **Feature extraction**: query the event log for a time window → produce a feature matrix
- **Model training**: integrate with sklearn/xgboost/lightgbm for baseline models; support custom PyTorch/TensorFlow via plugin system
- **Backtesting**: train on [T-90d, T-30d], predict [T-30d, T], compare to actuals
- **Model registry**: track which model version produced which predictions (MLflow-compatible)
- **Live inference**: serve trained models as prediction layers on the globe

### C4: Error Visualization
- Error heatmaps on the globe (where does this model fail?)
- Error by lead time charts
- Error by region / season / weather regime
- Model comparison side-by-side diff (Model A vs. Model B on same forecast case)

## Architecture

```
Event Log (Phase A)
    │
    ├──► Feature Extractor ──► Training Dataset
    │                              │
    │                              ▼
    │                         Model Training
    │                              │
    │                              ▼
    │                         Model Registry ──► Live Inference
    │                                              │
    │                                              ▼
    ├──► Observed Reality ◄──► Model Prediction (event)
    │         │
    │         ▼
    └──► Model Validation (event)
              │
              ▼
         Error Visualizations (layers on globe)
```

## Key Design Decisions

1. **Predictions are events.** A forecast frame enters the same event log as an observation, just with `truth_mode = "predicted"`. This means the event log is the single source for both training data and validation.

2. **Validation is automatic.** When an observation arrives for a cell that has an unvalidated prediction, the system computes the error and stores a `ModelValidation` event. No manual "run validation" step.

3. **Features are versioned.** Every training dataset carries a `featureset_id` so you can reproduce exactly what a model was trained on.

4. **Baseline persistence model first.** Before training any ML, implement a persistence baseline ("tomorrow = today") and a climatology baseline ("tomorrow = 30-year average for this date"). If your ML model can't beat these, it's not adding value.

## New Files (sketch)

| File | Purpose |
|------|---------|
| `services/api/canwxlab_api/core/feature_extractor.py` | Event log → feature matrix |
| `services/api/canwxlab_api/core/model_registry.py` | Model version tracking |
| `services/api/canwxlab_api/core/validation_engine.py` | Auto-validation on observation ingest |
| `services/api/canwxlab_api/routes/ml.py` | ML workbench API endpoints |
| `apps/web/src/components/ModelLabPanel.tsx` | ML workbench UI |
| `apps/web/src/layers/renderers/errorHeatmap.ts` | Error heatmap renderer |

## Integration with Phase A

- Phase A's `EventStore.query(bbox, time_range, variables)` is the feature extraction primitive
- Phase A's confidence model distinguishes "this is a forecast" from "this is observed" — the ML lab depends on that distinction
- Phase A's evidence API lets the ML lab expose *why* a model made a prediction (feature importance, training data provenance)
