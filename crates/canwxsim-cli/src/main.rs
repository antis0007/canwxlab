use std::fs;
use std::path::PathBuf;

use anyhow::Context;
use canwxsim::run_sample;
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "canwxsim-cli",
    version,
    about = "Run CanWxSim sample simulations"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    RunSample {
        #[arg(long, default_value_t = 20)]
        steps: usize,
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
            width,
            height,
            output,
        } => {
            let result = run_sample(width, height, steps).map_err(anyhow::Error::msg)?;
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
