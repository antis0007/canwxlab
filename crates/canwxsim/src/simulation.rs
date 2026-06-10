use serde::{Deserialize, Serialize};

use crate::grid::Grid2D;
use crate::state::ModelState2D;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdvectionScheme {
    /// BFECC/MacCormack-corrected semi-Lagrangian transport. This is the default
    /// because it is stable for interactive timesteps while preserving sharper
    /// cloud/moisture structure than first-order upwind advection.
    SemiLagrangianMacCormack,
    /// Legacy first-order upwind transport. Kept for regression comparisons and
    /// ultra-conservative fallback runs.
    FirstOrderUpwind,
}

impl Default for AdvectionScheme {
    fn default() -> Self {
        Self::SemiLagrangianMacCormack
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SimulationConfig {
    pub dt_seconds: f64,
    pub pressure_gradient_scale: f64,
    pub diffusion: f64,
    pub wind_damping: f64,
    pub saturation_threshold: f64,
    pub condensation_rate: f64,
    pub precipitation_rate: f64,
    #[serde(default)]
    pub advection_scheme: AdvectionScheme,
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
            advection_scheme: AdvectionScheme::default(),
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
        config,
    );
    advect_scalar(
        grid,
        &mut state.moisture,
        &state.u_wind,
        &state.v_wind,
        config,
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
    run_sample_with_config(width, height, steps, SimulationConfig::default())
}

pub fn run_sample_with_config(
    width: usize,
    height: usize,
    steps: usize,
    config: SimulationConfig,
) -> Result<SimulationResult, String> {
    let grid = Grid2D::new(width, height, 10_000.0, 10_000.0);
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

fn advect_scalar(
    grid: &Grid2D,
    scalar: &mut [f64],
    u: &[f64],
    v: &[f64],
    config: &SimulationConfig,
) {
    match config.advection_scheme {
        AdvectionScheme::SemiLagrangianMacCormack => {
            advect_scalar_maccormack(grid, scalar, u, v, config.dt_seconds, config.diffusion);
        }
        AdvectionScheme::FirstOrderUpwind => {
            advect_scalar_upwind(grid, scalar, u, v, config.dt_seconds, config.diffusion);
        }
    }
}

fn advect_scalar_upwind(
    grid: &Grid2D,
    scalar: &mut [f64],
    u: &[f64],
    v: &[f64],
    dt: f64,
    diffusion: f64,
) {
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

fn advect_scalar_maccormack(
    grid: &Grid2D,
    scalar: &mut [f64],
    u: &[f64],
    v: &[f64],
    dt: f64,
    diffusion: f64,
) {
    let old = scalar.to_owned();
    let forward = semi_lagrangian_advect(grid, &old, u, v, dt);
    let backward = semi_lagrangian_advect(grid, &forward, u, v, -dt);

    let mut corrected = vec![0.0; grid.len()];
    for idx in 0..grid.len() {
        corrected[idx] = old[idx] + 0.5 * (old[idx] - backward[idx]);
    }

    let mut limited = semi_lagrangian_advect(grid, &corrected, u, v, dt);
    for y in 0..grid.height {
        for x in 0..grid.width {
            let idx = grid.index(x, y);
            let departure_x = x as f64 - u[idx] * dt / grid.dx_m;
            let departure_y = y as f64 - v[idx] * dt / grid.dy_m;
            let (min_value, max_value) = local_min_max(grid, &old, departure_x, departure_y);
            limited[idx] = limited[idx].clamp(min_value, max_value);
        }
    }

    scalar.copy_from_slice(&limited);
    diffuse_field(grid, scalar, diffusion);
}

fn semi_lagrangian_advect(
    grid: &Grid2D,
    field: &[f64],
    u: &[f64],
    v: &[f64],
    dt: f64,
) -> Vec<f64> {
    let mut advected = vec![0.0; grid.len()];
    for y in 0..grid.height {
        for x in 0..grid.width {
            let idx = grid.index(x, y);
            let departure_x = x as f64 - u[idx] * dt / grid.dx_m;
            let departure_y = y as f64 - v[idx] * dt / grid.dy_m;
            advected[idx] = sample_bilinear(grid, field, departure_x, departure_y);
        }
    }
    advected
}

fn sample_bilinear(grid: &Grid2D, field: &[f64], x: f64, y: f64) -> f64 {
    let x = x.clamp(0.0, (grid.width - 1) as f64);
    let y = y.clamp(0.0, (grid.height - 1) as f64);
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = grid.clamp_x(x0 as isize + 1);
    let y1 = grid.clamp_y(y0 as isize + 1);
    let fx = x - x0 as f64;
    let fy = y - y0 as f64;

    let v00 = field[grid.index(x0, y0)];
    let v10 = field[grid.index(x1, y0)];
    let v01 = field[grid.index(x0, y1)];
    let v11 = field[grid.index(x1, y1)];
    let top = v00 * (1.0 - fx) + v10 * fx;
    let bottom = v01 * (1.0 - fx) + v11 * fx;
    top * (1.0 - fy) + bottom * fy
}

fn local_min_max(grid: &Grid2D, field: &[f64], x: f64, y: f64) -> (f64, f64) {
    let cx = x.round() as isize;
    let cy = y.round() as isize;
    let mut min_value = f64::INFINITY;
    let mut max_value = f64::NEG_INFINITY;

    for oy in -1..=1 {
        for ox in -1..=1 {
            let px = grid.clamp_x(cx + ox);
            let py = grid.clamp_y(cy + oy);
            let value = field[grid.index(px, py)];
            min_value = min_value.min(value);
            max_value = max_value.max(value);
        }
    }

    if min_value.is_finite() && max_value.is_finite() {
        (min_value, max_value)
    } else {
        (0.0, 0.0)
    }
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
