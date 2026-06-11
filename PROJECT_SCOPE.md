# Vinyl Reel Recorder — Project Scope

## Overview

**Vinyl Reel Recorder** is a small Windows desktop application for personal use.

The purpose of the app is to make it quick and easy to record short, portrait-format social media videos of records from a vinyl collection. The finished output should be suitable for TikTok, Instagram Reels and YouTube Shorts without requiring manual editing afterwards.

This is a standalone personal utility. Do not integrate it with any existing projects. Keep the architecture simple and avoid unnecessary abstractions or features.

---

## Core User Workflow

The intended workflow is:

1. Open the desktop app.
2. Select a webcam.
3. Select an audio input.
4. Select or manually provide album artwork.
5. Enter the artist, release and track information.
6. Preview the final vertical composition.
7. Choose a duration or use manual stop.
8. Press **Record**.
9. Show a short countdown.
10. Record the webcam and stereo audio.
11. Press **Stop** or wait for the selected duration to end.
12. Render and export a finished portrait MP4.

The intended default video layout is:

```text
┌────────────────────────────┐
│                            │
│                            │
│       LIVE DECK CAM        │
│                            │
│                            │
├────────────────────────────┤
│                            │
│       RELEASE ARTWORK      │
│                            │
│   Artist                   │
│   Track title              │
│   Release · Label · Year   │
│                            │
└────────────────────────────┘
```

The output should eventually be a **1080 × 1920 portrait MP4**.

---

## Technology Choices

Use:

- Tauri v2
- React
- TypeScript
- Vite
- Tailwind CSS
- Rust for native functionality
- CPAL for native audio input when audio capture is implemented
- FFmpeg as a bundled Tauri sidecar when export is implemented
- Tauri Store plugin for saved settings when persistence is added

Target Windows first.

Do not spend time on macOS or Linux compatibility unless an implementation choice can remain cross-platform without adding complexity.

Use the current official documentation for Tauri v2, CPAL and FFmpeg. Do not rely on outdated Tauri v1 examples.

---

## Important Architectural Boundaries

### React Frontend Responsibilities

The React frontend should be responsible for:

- Application layout
- Device-selection controls
- Webcam preview
- Portrait composition preview
- Artwork and metadata controls
- Record, stop and countdown UI
- Displaying recording and export status
- Basic user-facing error messages

### Rust Backend Responsibilities

The Rust backend should eventually be responsible for:

- Enumerating native audio devices
- Capturing stereo audio
- Supporting standard Windows audio through WASAPI
- Supporting ASIO as an optional professional-audio mode
- Managing temporary recording files
- Calling FFmpeg to render the final MP4
- Returning structured progress and errors to the frontend

### Explicit Constraints

- Do not attempt to capture ASIO audio from browser APIs.
- ASIO support belongs in the Rust backend.
- Do not attempt to solve the complete final application in the first implementation pass.
- Prefer a simple, reliable personal utility over a generic media-editing tool.

---

## Audio Requirements for Later Phases

The finished app should eventually support two audio modes:

```text
Standard Windows Audio
└── WASAPI
    └── Select a stereo recording input

Professional Audio
└── ASIO
    └── Select an ASIO device
        └── Select a stereo input pair
```

The likely real-world device is a **Behringer XR18**. The app may need to select a pair such as USB channels **17 and 18** as the stereo recording source.

ASIO is an important requirement, but it must not block the initial implementation.

Treat ASIO as a dedicated later spike. Investigate the current CPAL ASIO feature, required build dependencies, Windows toolchain requirements and any licensing implications before implementing or distributing it.

---

## Recording and Export Strategy

Prefer a robust **record-then-render** workflow rather than trying to encode the complete final composition live.

The eventual flow should look like:

```text
During recording
────────────────
Webcam ───────────────> Temporary webcam recording
Selected audio input ─> Temporary stereo WAV recording

After recording
───────────────
Webcam recording ─┐
Stereo WAV ───────┼──> FFmpeg render ──> Final portrait MP4
Album artwork ────┤
Track metadata ───┘
```

FFmpeg should eventually:

- Create a 1080 × 1920 portrait composition
- Crop and scale the webcam footage into the top section
- Place the artwork into the lower section
- Add readable metadata text
- Use the clean captured stereo WAV file as the audio source
- Encode an H.264 video stream with AAC audio in an MP4 container
- Write the finished file to a chosen output directory
- Remove temporary files only after a successful render

Keep FFmpeg command generation isolated behind a small backend module so it can be tested independently.

---

## MVP Roadmap

Work incrementally.

### Phase 1: Tauri Shell and Visual Preview

Build this first.

Create a working Tauri v2 application with React, TypeScript, Vite and Tailwind CSS.

Implement:

- A clean single-screen desktop layout
- A settings area containing a webcam dropdown
- Webcam permission handling
- Webcam enumeration using browser media-device APIs
- A live webcam preview
- A 9:16 portrait composition preview
- A manual artwork image picker
- Text inputs for:
  - Artist
  - Release title
  - Track title
  - Label
  - Year
- A fixed stacked template:
  - Webcam in the upper portion
  - Artwork and metadata in the lower portion
- A basic duration selector with:
  - 15 seconds
  - 30 seconds
  - 60 seconds
  - 90 seconds
  - Manual stop
- Disabled or placeholder **Record** and **Stop** controls
- Clear empty, loading and error states

Do not implement audio capture, video recording, FFmpeg, Discogs or ASIO yet.

The first milestone is complete when the app can launch, allow a connected webcam to be selected, allow an artwork image to be chosen, accept metadata and show a convincing live preview of the finished portrait composition.

### Phase 2: Basic Recording

Do not start this until Phase 1 is complete and documented.

Add:

- A three-second countdown
- Record and Stop controls
- Webcam recording
- Temporary-file management
- Selected-duration auto-stop
- A clear recording-state indicator
- A simple initial export or temporary recording output

Keep the implementation small and reliable.

### Phase 3: FFmpeg Final Rendering

Add:

- FFmpeg as a Tauri sidecar
- Final 1080 × 1920 MP4 rendering
- Webcam crop and scaling
- Artwork placement
- Metadata rendering
- Output-directory selection
- Progress reporting
- Error handling
- Temporary-file cleanup after successful export

### Phase 4: Standard Windows Audio

Add:

- Rust audio-device enumeration
- CPAL WASAPI input capture
- Stereo WAV recording
- Input level meters
- Clipping warning
- Audio-device selection
- Synchronisation with the webcam recording

### Phase 5: ASIO Spike and Implementation

Before making changes, produce a short written technical note covering:

- Current CPAL ASIO setup
- Toolchain and SDK requirements
- Device enumeration
- Input-channel selection
- Stereo-pair handling
- XR18 considerations
- Licensing implications for a personal build and for any future distribution
- Risks and fallback options

Then add:

- ASIO mode
- ASIO device dropdown
- Stereo channel-pair dropdown
- XR18-compatible stereo capture
- Graceful fallback to WASAPI

### Phase 6: Optional Discogs Lookup

Keep this optional and separate from the recording core.

Potential features:

- Locally stored personal Discogs token
- Release search
- Release selection
- Artwork retrieval
- Track-list retrieval
- Recent releases
- Manual fallback when Discogs data is unavailable

Do not require Discogs in order to create a video.

---

## UI Direction

The app should feel like a small, purpose-built recording appliance rather than a generic media editor.

Use a practical desktop layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Vinyl Reel Recorder                                         │
├───────────────────────────────┬──────────────────────────────┤
│                               │ Camera                       │
│                               │ [ Select webcam          ▼ ] │
│       PORTRAIT PREVIEW        │                              │
│                               │ Artwork                      │
│                               │ [ Choose image...          ] │
│                               │                              │
│                               │ Metadata                     │
│                               │ [ Artist                   ] │
│                               │ [ Release                  ] │
│                               │ [ Track                    ] │
│                               │ [ Label              Year  ] │
│                               │                              │
│                               │ Duration                     │
│                               │ [15] [30] [60] [90] [Manual]│
│                               │                              │
│                               │ [ ● RECORD ]  [ ■ STOP ]    │
└───────────────────────────────┴──────────────────────────────┘
```

Use sensible spacing and readable controls.

Do not spend excessive time polishing the visual design before the preview workflow works.

---

## Code Quality Requirements

- Keep components small and focused.
- Use strict TypeScript.
- Avoid unnecessary dependencies.
- Do not add state-management libraries unless local React state becomes genuinely unmanageable.
- Keep Rust modules separated by responsibility.
- Return structured errors rather than panicking.
- Do not silently swallow errors.
- Add concise comments only where intent is not obvious.
- Add a README covering setup, development commands, current functionality and the roadmap.
- Add a `docs/decisions.md` file for architectural decisions and deferred questions.
- Add a `docs/asio-spike.md` placeholder containing the known ASIO questions for Phase 5.
- Keep a running checklist in `docs/roadmap.md`.

---

## Initial Agent Task

Start by scaffolding the application and implementing **Phase 1 only**.

Before coding:

1. Inspect the repository.
2. Confirm the required local prerequisites for a Tauri v2 Windows project.
3. Create the Tauri v2 React, TypeScript and Vite application.
4. Add Tailwind CSS using the appropriate current setup.
5. Briefly document the proposed file structure.

Then implement the Phase 1 vertical preview workflow.

At the end:

1. Run the relevant development checks.
2. Fix any TypeScript, Rust or linting issues introduced by the implementation.
3. Summarise the files created or changed.
4. Explain how to launch the app.
5. List any environment-specific limitations encountered.
6. Stop after Phase 1 and wait for review before proceeding.

---

## Definition of Success for Phase 1

Phase 1 is complete when:

- The Tauri desktop app launches successfully on Windows.
- A connected webcam can be selected.
- Webcam permissions are handled sensibly.
- A live camera feed appears inside the portrait preview.
- A local artwork image can be selected.
- Artist, release, track, label and year fields update the preview.
- Duration controls are visible.
- Record and Stop controls are present but intentionally inactive or clearly marked as placeholders.
- The README and planning documents exist.
- Relevant development checks pass.
