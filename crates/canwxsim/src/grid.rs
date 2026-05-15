use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Grid2D {
    pub width: usize,
    pub height: usize,
    pub dx_m: f64,
    pub dy_m: f64,
}

impl Grid2D {
    pub fn new(width: usize, height: usize, dx_m: f64, dy_m: f64) -> Self {
        assert!(width >= 3, "width must be at least 3");
        assert!(height >= 3, "height must be at least 3");
        assert!(dx_m > 0.0, "dx_m must be positive");
        assert!(dy_m > 0.0, "dy_m must be positive");
        Self {
            width,
            height,
            dx_m,
            dy_m,
        }
    }

    pub fn len(&self) -> usize {
        self.width * self.height
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    pub fn clamp_x(&self, x: isize) -> usize {
        x.clamp(0, self.width as isize - 1) as usize
    }

    pub fn clamp_y(&self, y: isize) -> usize {
        y.clamp(0, self.height as isize - 1) as usize
    }
}
