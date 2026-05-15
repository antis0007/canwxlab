use serde::{Deserialize, Serialize};

use crate::grid::Grid2D;
use crate::state::ModelState2D;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tendency2D {
    pub d_pressure_height: Vec<f64>,
    pub d_u_wind: Vec<f64>,
    pub d_v_wind: Vec<f64>,
    pub d_temperature: Vec<f64>,
    pub d_moisture: Vec<f64>,
    pub d_cloud_water: Vec<f64>,
    pub d_precipitation: Vec<f64>,
}

impl Tendency2D {
    pub fn zeros(grid: &Grid2D) -> Self {
        let len = grid.len();
        Self {
            d_pressure_height: vec![0.0; len],
            d_u_wind: vec![0.0; len],
            d_v_wind: vec![0.0; len],
            d_temperature: vec![0.0; len],
            d_moisture: vec![0.0; len],
            d_cloud_water: vec![0.0; len],
            d_precipitation: vec![0.0; len],
        }
    }
}

pub trait TendencyPlugin {
    fn id(&self) -> &'static str;
    fn apply(
        &self,
        grid: &Grid2D,
        state: &ModelState2D,
        tendencies: &mut Tendency2D,
        dt_seconds: f64,
    );
}

#[derive(Debug, Clone, Copy)]
pub struct NoopTendencyPlugin;

impl TendencyPlugin for NoopTendencyPlugin {
    fn id(&self) -> &'static str {
        "noop"
    }

    fn apply(
        &self,
        _grid: &Grid2D,
        _state: &ModelState2D,
        _tendencies: &mut Tendency2D,
        _dt_seconds: f64,
    ) {
    }
}
