//! CanWxSim is the experimental simulation core for CanWxLab.
//!
//! The current crate intentionally implements a small, stable 2D weather sandbox, not a
//! production numerical weather prediction system. It provides the grid/state contracts,
//! timestep guardrails, and plugin/tendency seams needed for future 2.5D and 3D work.

mod grid;
mod plugin;
mod simulation;
mod state;

pub use grid::Grid2D;
pub use plugin::{NoopTendencyPlugin, Tendency2D, TendencyPlugin};
pub use simulation::{run_sample, step, SimulationConfig, SimulationDiagnostics, SimulationResult};
pub use state::ModelState2D;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_initializes() {
        let grid = Grid2D::new(8, 6, 1_000.0, 1_000.0);
        let state = ModelState2D::new(&grid);
        assert_eq!(state.len(), grid.len());
        assert!(state.validate_shape(&grid).is_ok());
    }

    #[test]
    fn one_step_runs_without_nan() {
        let grid = Grid2D::new(16, 12, 5_000.0, 5_000.0);
        let mut state = ModelState2D::demo(&grid);
        let diagnostics =
            step(&grid, &mut state, &SimulationConfig::default()).expect("step should run");
        assert!(!state.has_non_finite());
        assert!(diagnostics.max_wind_speed.is_finite());
    }

    #[test]
    fn moisture_remains_non_negative() {
        let grid = Grid2D::new(10, 10, 5_000.0, 5_000.0);
        let mut state = ModelState2D::demo(&grid);
        for _ in 0..10 {
            step(&grid, &mut state, &SimulationConfig::default()).expect("step should run");
        }
        assert!(state.moisture.iter().all(|value| *value >= 0.0));
        assert!(state.cloud_water.iter().all(|value| *value >= 0.0));
        assert!(state.precipitation.iter().all(|value| *value >= 0.0));
    }

    #[test]
    fn cloud_forms_when_saturation_threshold_exceeded() {
        let grid = Grid2D::new(6, 6, 5_000.0, 5_000.0);
        let mut state = ModelState2D::new(&grid);
        for value in &mut state.moisture {
            *value = 0.03;
        }
        let config = SimulationConfig {
            precipitation_rate: 0.0,
            ..SimulationConfig::default()
        };
        step(&grid, &mut state, &config).expect("step should run");
        assert!(state.cloud_water.iter().any(|value| *value > 0.0));
    }

    #[test]
    fn plugin_tendency_skeleton_runs() {
        let grid = Grid2D::new(6, 6, 1_000.0, 1_000.0);
        let state = ModelState2D::new(&grid);
        let mut tendency = Tendency2D::zeros(&grid);
        let plugin = NoopTendencyPlugin;
        plugin.apply(&grid, &state, &mut tendency, 30.0);
        assert_eq!(plugin.id(), "noop");
        assert!(tendency.d_temperature.iter().all(|value| *value == 0.0));
    }

    #[test]
    fn sample_run_completes() {
        let result = run_sample(16, 12, 4).expect("sample should run");
        assert_eq!(result.diagnostics.steps_completed, 4);
        assert_eq!(result.grid.width, 16);
    }
}
