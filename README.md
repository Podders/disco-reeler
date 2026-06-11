# Vinyl Reel Recorder

Vinyl Reel Recorder is a Windows-first Tauri v2 desktop app for recording short portrait videos of vinyl records. The current build focuses on the live preview workflow: webcam selection, artwork selection, Discogs collection artwork lookup and a realistic 9:16 composition preview.

## Current Status

- Phase 1 scaffolded and implemented
- Webcam enumeration and live preview run in the React frontend
- Artwork selection updates the portrait preview
- Discogs collection browsing works through a personal token and username
- Record and Stop controls are present but intentionally disabled
- Audio capture, FFmpeg export, Discogs track-list sync and ASIO are deferred to later phases

## Prerequisites

For macOS development, Tauri requires:

- Rust
- Xcode Command Line Tools
- A recent macOS WebView environment provided by the system

For Windows development, Tauri requires:

- Rust
- Microsoft C++ Build Tools with the `Desktop development with C++` workload
- Microsoft Edge WebView2 Runtime

The current repo was scaffolded with the latest Tauri v2 project generator and uses Vite, React, TypeScript and Tailwind CSS v4.

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm run tauri dev
```

On macOS, the first camera access prompt is driven by the `src-tauri/Info.plist` privacy keys, so the desktop shell can request webcam permission correctly.

Build the frontend and Rust app:

```bash
npm run tauri build
```

## What Works In Phase 1

- Webcam device enumeration via browser media-device APIs
- Permission prompting for camera access
- Live webcam preview inside the portrait canvas
- Manual artwork image selection
- Discogs collection browsing and artwork selection
- Duration selection for 15, 30, 60, 90 seconds or manual stop
- Disabled Record and Stop controls as placeholders

## Project Structure

```text
.
├── src/                  # React UI
├── src-tauri/            # Rust backend and Tauri config
├── docs/                 # Roadmap and architecture notes
├── PROJECT_SCOPE.md      # Product scope and phase plan
└── README.md             # Setup and current status
```

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for the running checklist.
