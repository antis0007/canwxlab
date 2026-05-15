use serde::{Deserialize, Serialize};

use crate::grid::Grid2D;
use crate::state::ModelState2D;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SimulationConfig {
    pub dt_seconds: f64,
    pub pressure_gradient_scale: f64,
    pub diffusion: f64,
    pub wind_damping: f64,
    pub saturation_threshold: f64,
    pub condensation_rate: f64,
    pub precipitation_rate: f64,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            dt_seconds: 30.0,
            pressure_gradient_scale: 0.0025,
            diffusion: 0.015,
            wind_damping: 0.0008,
            saturation_threshold: 0.014,
            condensation_rate: 0.18,
            precipitation_rate: 0.04,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SimulationDiagnostics {
    pub steps_completed: usize,
    pub min_pressure_height: f64,
    pub max_pressure_height: f64,
    pub min_temperature: f64,
    pub max_temperature: f64,
    pub min_moisture: f64,
    pub max_moisture: f64,
    pub max_wind_speed: f64,
    pub water_budget_error: f64,
    pub stability_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    pub grid: Grid2D,
    pub config: SimulationConfig,
    pub diagnostics: SimulationDiagnostics,
    pub state: ModelState2D,
}

pub fn step(
    grid: &Grid2D,
    state: &mut ModelState2D,
    config: &SimulationConfig,
) -> Result<SimulationDiagnostics, String> {
    state.validate_shape(grid)?;
    if state.has_non_finite() {
        return Err("state contains NaN or Inf before step".to_string());
    }

    let before_water = total_water(state);
    apply_pressure_gradient(grid, state, config);
    advect_scalar(
        grid,
        &mut state.temperature,
        &state.u_wind,
        &state.v_wind,
        config.dt_seconds,
        config.diffusion,
    );
    advect_scalar(
        grid,
        &mut state.moisture,
        &state.u_wind,
        &state.v_wind,
        config.dt_seconds,
        config.diffusion,
    );
    apply_cloud_microphysics(state, config);
    diffuse_field(grid, &mut state.pressure_height, config.diffusion * 0.3);
    damp_wind(state, config);
    state.clamp_non_negative_water();

    if state.has_non_finite() {
        return Err("state contains NaN or Inf after step".to_string());
    }

    let after_water = total_water(state);
    let mut diagnostics = diagnose(grid, state);
    diagnostics.water_budget_error = (after_water - before_water).abs();
    diagnostics.stability_warnings = stability_warnings(grid, state, config);
    Ok(diagnostics)
}

pub fn run_sample(width: usize, height: usize, steps: usize) -> Result<SimulationResult, String> {
    let grid = Grid2D::new(width, height, 10_000.0, 10_000.0);
    let config = SimulationConfig::default();
    let mut state = ModelState2D::demo(&grid);
    let mut diagnostics = diagnose(&grid, &state);
    for completed in 1..=steps {
        diagnostics = step(&grid, &mut state, &config)?;
        diagnostics.steps_completed = completed;
    }
    Ok(SimulationResult {
        grid,
        config,
        diagnostics,
        state,
    })
}

fn apply_pressure_gradient(grid: &Grid2D, state: &mut ModelState2D, config: &SimulationConfig) {
    let old_u = state.u_wind.clone();
    let old_v = state.v_wind.clone();
    for y in 0..grid.height {
        for x in 0..grid.width {
            let idx = grid.index(x, y);
            let left = grid.index(grid.clamp_x(x as isize - 1), y);
            let right = grid.index(grid.clamp_x(x as isize + 1), y);
            let down = grid.index(x, grid.clamp_y(y as isize - 1));
            let up = grid.index(x, grid.clamp_y(y as isize + 1));
            let grad_x =
                (state.pressure_height[right] - state.pressure_height[left]) / (2.0 * grid.dx_m);
            let grad_y =
                (state.pressure_height[up] - state.pressure_height[down]) / (2.0 * grid.dy_m);
            state.u_wind[idx] =
                old_u[idx] - config.pressure_gradient_scale * grad_x * config.dt_seconds;
            state.v_wind[idx] =
                old_v[idx] - config.pressure_gradient_scale * grad_y * config.dt_seconds;
        }
    }
}

fn advect_scalar(grid: &Grid2D, scalar: &mut [f64], u: &[f64], v: &[f64], dt: f64, diffusion: f64) {
    let old = scalar.to_owned();
    for y in 0..grid.height {
        for x in 0..grid.width {
            let idx = grid.index(x, y);
            let x_upwind = if u[idx] >= 0.0 {
                x as isize - 1
            } else {
                x as isize + 1
            };
            let y_upwind = if v[idx] >= 0.0 {
                y as isize - 1
            } else {
                y as isize + 1
            };
            let upwind_x = grid.index(grid.clamp_x(x_upwind), y);
            let upwind_y = grid.index(x, grid.clamp_y(y_upwind));
            let d_dx = (old[idx] - old[upwind_x]) / grid.dx_m;
            let d_dy = (old[idx] - old[upwind_y]) / grid.dy_m;
            scalar[idx] = old[idx] - dt * (u[idx] * d_dx + v[idx] * d_dy);
        }
    }
    diffuse_field(grid, scalar, diffusion);
}

fn diffuse_field(grid: &Grid2D, field: &mut [f64], coefficient: f64) {
    if coefficient <= 0.0 {
        return;
    }
    let old = field.to_owned();
    for y in 0..grid.height {
        for x in 0..grid.width {
            let idx = grid.index(x, y);
            let left = old[grid.index(grid.clamp_x(x as isize - 1), y)];
            let right = old[grid.index(grid.clamp_x(x as isize + 1), y)];
            let down = old[grid.index(x, grid.clamp_y(y as isize - 1))];
            let up = old[grid.index(x, grid.clamp_y(y as isize + 1))];
            let laplacian = left + right + down + up - 4.0 * old[idx];
            field[idx] = old[idx] + coefficient * laplacian;
        }
    }
}

fn apply_cloud_microphysics(state: &mut ModelState2D, config: &SimulationConfig) {
    for idx in 0..state.len() {
        let excess = (state.moisture[idx] - config.saturation_threshold).max(0.0);
        let condensed = excess.min(excess * config.condensation_rate * config.dt_seconds);
        state.moisture[idx] -= condensed;
        state.cloud_water[idx] += condensed;
        state.temperature[idx] += condensed * 180.0;

        let fallout = (state.cloud_water[idx] * config.precipitation_rate * config.dt_seconds)
            .min(state.cloud_water[idx]);
        state.cloud_water[idx] -= fallout;
        state.precipitation[idx] += fallout;
    }
}

fn damp_wind(state: &mut ModelState2D, config: &SimulationConfig) {
    let damping = (1.0 - config.wind_damping * config.dt_seconds).clamp(0.0, 1.0);
    for value in state.u_wind.iter_mut().chain(state.v_wind.iter_mut()) {
        *value *= damping;
    }
}

fn total_water(state: &ModelState2D) -> f64 {
    state.moisture.iter().sum::<f64>()
        + state.cloud_water.iter().sum::<f64>()
        + state.precipitation.iter().sum::<f64>()
}

fn min_max(values: &[f64]) -> (f64, f64) {
    values.iter().fold(
        (f64::INFINITY, f64::NEG_INFINITY),
        |(min_value, max_value), value| (min_value.min(*value), max_value.max(*value)),
    )
}

fn diagnose(_grid: &Grid2D, state: &ModelState2D) -> SimulationDiagnostics {
    let (min_pressure_height, max_pressure_height) = min_max(&state.pressure_height);
    let (min_temperature, max_temperature) = min_max(&state.temperature);
    let (min_moisture, max_moisture) = min_max(&state.moisture);
    let max_wind_speed = state
        .u_wind
        .iter()
        .zip(&state.v_wind)
        .map(|(u, v)| (u * u + v * v).sqrt())
        .fold(0.0_f64, f64::max);
    SimulationDiagnostics {
        steps_completed: 0,
        min_pressure_height,
        max_pressure_height,
        min_temperature,
        max_temperature,
        min_moisture,
        max_moisture,
        max_wind_speed,
        water_budget_error: 0.0,
        stability_warnings: Vec::new(),
    }
}

fn stability_warnings(
    grid: &Grid2D,
    state: &ModelState2D,
    config: &SimulationConfig,
) -> Vec<String> {
    let max_wind = state
        .u_wind
        .iter()
        .zip(&state.v_wind)
        .map(|(u, v)| (u * u + v * v).sqrt())
        .fold(0.0_f64, f64::max);
    let cfl = max_wind * config.dt_seconds / grid.dx_m.min(grid.dy_m);
    let mut warnings = Vec::new();
    if cfl > 0.8 {
        warnings.push(format!(
            "CFL warning: estimated {cfl:.3}; reduce timestep or grid spacing"
        ));
    }
    if state.min_moisture_value() < -1e-12 {
        warnings.push("negative moisture detected before clamp".to_string());
    }
    warnings
}

trait MoistureDiagnostics {
    fn min_moisture_value(&self) -> f64;
}

impl MoistureDiagnostics for ModelState2D {
    fn min_moisture_value(&self) -> f64 {
        self.moisture.iter().copied().fold(f64::INFINITY, f64::min)
    }
}
