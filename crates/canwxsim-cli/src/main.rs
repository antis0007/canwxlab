use std::fs;
use std::path::PathBuf;

use anyhow::Context;
use canwxsim::{run_sample_with_config, SimulationConfig};
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "canwxsim-cli",
    version,
    about = "Run CanWxSim experimental sample simulations"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    RunSample {
        /// Explicit number of model steps. Overrides duration-hours when provided.
        #[arg(long)]
        steps: Option<usize>,
        #[arg(long, default_value_t = 1.0)]
        duration_hours: f64,
        #[arg(long, default_value_t = 30.0)]
        timestep_seconds: f64,
        #[arg(long, default_value_t = 64)]
        width: usize,
        #[arg(long, default_value_t = 64)]
        height: usize,
        #[arg(long)]
        output: Option<PathBuf>,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::RunSample {
            steps,
            duration_hours,
            timestep_seconds,
            width,
            height,
            output,
        } => {
            let step_count = steps.unwrap_or_else(|| {
                ((duration_hours.max(0.001) * 3600.0) / timestep_seconds.max(0.001))
                    .ceil()
                    .max(1.0) as usize
            });
            let config = SimulationConfig {
                dt_seconds: timestep_seconds,
                ..SimulationConfig::default()
            };
            let result = run_sample_with_config(width, height, step_count, config)
                .map_err(anyhow::Error::msg)?;
            let json =
                serde_json::to_string_pretty(&result).context("serialize simulation result")?;
            if let Some(path) = output {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("create {}", parent.display()))?;
                }
                fs::write(&path, json).with_context(|| format!("write {}", path.display()))?;
            } else {
                println!("{json}");
            }
        }
    }
    Ok(())
}
