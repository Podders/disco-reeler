# Architectural Decisions

## Confirmed Decisions

- Use Tauri v2, React, TypeScript, Vite and Tailwind CSS for the UI shell.
- Keep the first phase frontend-only so the preview workflow can be validated without backend recording complexity.
- Treat the frontend as the owner of webcam selection, preview rendering and metadata entry.
- Defer audio capture, FFmpeg rendering, Discogs integration and ASIO to later phases.
- Keep the initial UI simple and task-focused rather than designing a generic media editor.

## Deferred Questions

- Exact FFmpeg command generation strategy.
- Temporary file layout for webcam and audio capture.
- Whether audio capture should be split into a dedicated Rust module or a small recording service layer.
- How ASIO device and channel-pair selection should map onto CPAL on Windows.
- Whether Discogs lookup should live behind a separate settings screen or a lightweight metadata drawer.
