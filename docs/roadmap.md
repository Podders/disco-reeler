# Roadmap

## Phase 1: Visual Preview Shell

- [x] Scaffold a Tauri v2 React, TypeScript and Vite app
- [x] Add Tailwind CSS v4
- [x] Create a clean single-screen desktop layout
- [x] Add webcam device selection
- [x] Handle camera permission prompting
- [x] Enumerate webcams with browser media-device APIs
- [x] Render a live webcam preview
- [x] Build a 9:16 portrait composition preview
- [x] Add manual artwork image selection
- [x] Add duration controls for 15, 30, 60, 90 seconds and manual stop
- [x] Show Record and Stop controls as disabled placeholders
- [ ] Add polishing pass after review

## Phase 2: Basic Recording

- [ ] Add a three-second countdown
- [ ] Enable Record and Stop controls
- [ ] Capture webcam footage to a temporary file
- [ ] Add selected-duration auto-stop
- [ ] Show a recording state indicator
- [ ] Add a simple temporary export output

## Phase 3: FFmpeg Final Rendering

- [ ] Add FFmpeg as a Tauri sidecar
- [ ] Render a final 1080 × 1920 MP4
- [ ] Crop and scale webcam footage
- [ ] Place artwork and metadata in the export
- [ ] Select an output directory
- [ ] Report render progress
- [ ] Remove temporary files after successful export

## Phase 4: Standard Windows Audio

- [ ] Enumerate audio devices in Rust
- [ ] Capture stereo input with CPAL and WASAPI
- [ ] Record stereo WAV output
- [ ] Add input level meters
- [ ] Warn on clipping
- [ ] Sync audio capture with webcam recording

## Phase 5: ASIO Spike and Implementation

- [ ] Write a technical note covering CPAL ASIO setup and licensing
- [ ] Add ASIO mode
- [ ] Add ASIO device and stereo pair selection
- [ ] Support XR18-compatible stereo capture
- [ ] Add graceful fallback to WASAPI

## Phase 6: Optional Discogs Lookup

- [x] Add local token storage
- [x] Add release search and selection
- [x] Add artwork retrieval
- [ ] Add track-list retrieval
- [x] Add manual fallback when Discogs data is missing
