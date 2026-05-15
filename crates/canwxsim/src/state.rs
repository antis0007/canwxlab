use serde::{Deserialize, Serialize};

use crate::grid::Grid2D;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelState2D {
    pub pressure_height: Vec<f64>,
    pub u_wind: Vec<f64>,
    pub v_wind: Vec<f64>,
    pub temperature: Vec<f64>,
    pub moisture: Vec<f64>,
    pub cloud_water: Vec<f64>,
    pub precipitation: Vec<f64>,
}

impl ModelState2D {
    pub fn new(grid: &Grid2D) -> Self {
        let len = grid.len();
        Self {
            pressure_height: vec![1000.0; len],
            u_wind: vec![0.0; len],
            v_wind: vec![0.0; len],
            temperature: vec![273.15; len],
            moisture: vec![0.006; len],
            cloud_water: vec![0.0; len],
            precipitation: vec![0.0; len],
        }
    }

    pub fn demo(grid: &Grid2D) -> Self {
        let mut state = Self::new(grid);
        for y in 0..grid.height {
            for x in 0..grid.width {
                let idx = grid.index(x, y);
                let xn = x as f64 / (grid.width - 1) as f64;
                let yn = y as f64 / (grid.height - 1) as f64;
                let wave =
                    (xn * std::f64::consts::TAU * 2.0).sin() * (yn * std::f64::consts::TAU).cos();
                state.pressure_height[idx] = 1000.0 + 18.0 * wave + 10.0 * (0.5 - yn);
                state.temperature[idx] = 283.15 + 11.0 * (1.0 - yn) + 3.0 * wave;
                state.moisture[idx] = 0.006 + 0.010 * (1.0 - (yn - 0.45).abs()).max(0.0);
                state.u_wind[idx] = 4.0 + 2.0 * (yn * std::f64::consts::PI).sin();
                state.v_wind[idx] = 1.5 * (xn * std::f64::consts::TAU).cos();
            }
        }
        state
    }

    pub fn len(&self) -> usize {
        self.pressure_height.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pressure_height.is_empty()
    }

    pub fn validate_shape(&self, grid: &Grid2D) -> Result<(), String> {
        let expected = grid.len();
        let fields = [
            ("pressure_height", self.pressure_height.len()),
            ("u_wind", self.u_wind.len()),
            ("v_wind", self.v_wind.len()),
            ("temperature", self.temperature.len()),
            ("moisture", self.moisture.len()),
            ("cloud_water", self.cloud_water.len()),
            ("precipitation", self.precipitation.len()),
        ];
        for (name, len) in fields {
            if len != expected {
                return Err(format!(
                    "field {name} has length {len}; expected {expected}"
                ));
            }
        }
        Ok(())
    }

    pub fn has_non_finite(&self) -> bool {
        self.pressure_height
            .iter()
            .chain(&self.u_wind)
            .chain(&self.v_wind)
            .chain(&self.temperature)
            .chain(&self.moisture)
            .chain(&self.cloud_water)
            .chain(&self.precipitation)
            .any(|value| !value.is_finite())
    }

    pub fn clamp_non_negative_water(&mut self) {
        for field in [
            &mut self.moisture,
            &mut self.cloud_water,
            &mut self.precipitation,
        ] {
            for value in field.iter_mut() {
                if *value < 0.0 || !value.is_finite() {
                    *value = 0.0;
                }
            }
        }
    }
}
