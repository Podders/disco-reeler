use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be set"));
    let project_root = manifest_dir
        .parent()
        .expect("src-tauri must live inside the project root");
    let prepare_script = project_root.join("scripts").join("prepare-ffmpeg.mjs");
    let package_json = project_root.join("package.json");
    let package_lock = project_root.join("package-lock.json");

    println!("cargo:rerun-if-changed={}", prepare_script.display());
    println!("cargo:rerun-if-changed={}", package_json.display());
    println!("cargo:rerun-if-changed={}", package_lock.display());

    let status = Command::new("node")
        .arg(&prepare_script)
        .current_dir(project_root)
        .status()
        .expect("Failed to launch the FFmpeg preparation script");

    if !status.success() {
        panic!("FFmpeg sidecar preparation failed.");
    }

    tauri_build::build()
}
