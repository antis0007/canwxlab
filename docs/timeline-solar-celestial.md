# Timeline Solar and Celestial Plan

The CanWxLab timeline is the unified time controller for weather, history, forecasts, simulations,
verification A/B comparison, starfield time, Sun/Moon/planet positions, and future ephemeris samples.

## Current State

The bottom workbench timeline has frame controls, loop state, A/B pins, multi-scale ticks, and a
thin day/night strip. The strip is an approximate UTC visual cue, not true local solar geometry.

## Required Improvements

- Weather scale: minutes/hours.
- Archive scale: days/months/years.
- Orbital scale: days/months/years/custom astronomical ranges.
- Local solar time when an observer location is selected.
- Subsolar point and terminator overlay.
- Sunrise/sunset and twilight bands.
- Moon phase.
- Celestial event markers.
- Ephemeris sample ticks and cache coverage indicators.

## Day/Night Rendering

The day/night indicator must stay smaller than the main timeline bar. It should show daylight,
night, and twilight without dominating frame selection. Future implementation should compute true
solar context from selected time and location rather than using UTC hour alone.

### Current Implementation

`BottomTimeline.tsx` renders a 3 px instrumentation strip pinned to the bottom of the 18 px main
track. Colours come from a five-band palette keyed to the standard solar-altitude definitions:

| Band       | Approximate solar altitude | Strip colour          |
| ---------- | -------------------------- | --------------------- |
| Night      | below astronomical (≤ −18°) | very dark indigo      |
| Astronomical twilight | −18° to −12°    | dark indigo           |
| Nautical twilight     | −12° to −6°     | mid blue              |
| Civil twilight        | −6° to 0°       | grey-blue             |
| Day                   | above horizon    | pale daylight blue    |

The current model uses UTC hour as a coarse stand-in for solar altitude (no observer location).
This is honest — it is a diagnostic ribbon, not a forecast — but it must be replaced.

### Planned Replacement

1. Take observer lon/lat from the selected city/station/lat-lon or the globe camera centre.
2. Compute subsolar lon/lat from the timestamp (NOAA SPA or a cached Horizons sample).
3. Derive local solar altitude from the subsolar position and the observer geodetic frame.
4. Map altitude to the same five-band palette above.
5. Reuse the same solar model to drive the deck.gl terminator polygon on the Earth globe so the
   strip and the globe shading agree on a single source of truth.

## Source Semantics

Timeline markers should make data state visible:

- observed/live weather time.
- cached weather time.
- forecast valid time.
- simulation valid time.
- verification A/B time.
- cached/interpolated ephemeris sample.
- unavailable or out-of-range source data.
