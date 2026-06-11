import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

function getHostTriple() {
  try {
    return execSync("rustc --print host-tuple", { encoding: "utf8" }).trim();
  } catch {
    const output = execSync("rustc -Vv", { encoding: "utf8" });
    const match = output.match(/^host:\s+(\S+)$/m);

    if (!match?.[1]) {
      throw new Error("Failed to determine the Rust host target triple.");
    }

    return match[1];
  }
}

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not provide a bundled binary for this platform.");
}

const targetTriple = getHostTriple();
const extension = process.platform === "win32" ? ".exe" : "";
const sourcePath = path.resolve(ffmpegPath);
const destinationDir = path.resolve("src-tauri", "binaries");
const destinationPath = path.join(destinationDir, `ffmpeg-${targetTriple}${extension}`);

fs.mkdirSync(destinationDir, { recursive: true });
fs.copyFileSync(sourcePath, destinationPath);

if (process.platform !== "win32") {
  fs.chmodSync(destinationPath, 0o755);
}

console.log(`Prepared FFmpeg sidecar: ${destinationPath}`);
