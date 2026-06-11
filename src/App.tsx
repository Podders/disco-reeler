import { useEffect, useMemo, useRef, useState } from "react";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import { DiscogsPanel } from "./components/DiscogsPanel";
import { SettingsDialog } from "./components/SettingsDialog";

type DurationChoice = 15 | 30 | 60 | 90;
type CameraStatus = "idle" | "loading" | "ready" | "no-device" | "error";
type AudioStatus = CameraStatus;
type RecordingStatus = "idle" | "countdown" | "recording" | "saving" | "error" | "saved";
type OutputPresetId = "vertical" | "square" | "landscape";

type OutputPreset = {
  id: OutputPresetId;
  label: string;
  description: string;
  width: number;
  height: number;
};

type DiscogsCollectionRelease = {
  instance_id: number;
  release_id: number;
  title: string;
  artist: string;
  year: number | null;
  label: string | null;
  cover_image: string | null;
  thumb: string | null;
  resource_url: string | null;
};

type DiscogsCollectionProgress = {
  page: number;
  pages: number | null;
  loaded_releases: number;
  total_releases: number | null;
  status: "starting" | "page-loaded" | "complete";
};

const RECORDING_VIDEO_BITS_PER_SECOND = 12_000_000;
const CAMERA_REQUEST_FRAME_RATE = 60;
const CAMERA_REQUEST_WIDTH = 1920;
const CAMERA_REQUEST_HEIGHT = 1080;
const OUTPUT_PRESETS: OutputPreset[] = [
  {
    id: "vertical",
    label: "Reels / TikTok / Shorts",
    description: "1080 × 1920",
    width: 1080,
    height: 1920,
  },
  {
    id: "square",
    label: "Square feed",
    description: "1080 × 1080",
    width: 1080,
    height: 1080,
  },
  {
    id: "landscape",
    label: "Landscape",
    description: "1920 × 1080",
    width: 1920,
    height: 1080,
  },
];

const durationOptions: Array<{ label: string; value: DurationChoice; note: string }> = [
  { label: "15s", value: 15, note: "Quick clip" },
  { label: "30s", value: 30, note: "Default" },
  { label: "60s", value: 60, note: "One side" },
  { label: "90s", value: 90, note: "Long take" },
];

type DropdownItem = {
  value: string;
  label: string;
  description?: string;
};

function DropdownListbox({
  items,
  value,
  onChange,
  placeholder,
  className,
}: {
  items: DropdownItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  const selectedItem = items.find((item) => item.value === value) ?? null;

  return (
    <Listbox value={value} onChange={onChange}>
      <div className={["relative", className ?? ""].join(" ").trim()}>
        <ListboxButton className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-left text-sm text-slate-100 outline-none transition hover:border-white/20 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20">
          <span className="min-w-0">
            <span className="block truncate">
              {selectedItem ? selectedItem.label : placeholder}
            </span>
            {selectedItem?.description ? (
              <span className="mt-0.5 block text-[11px] text-slate-400">
                {selectedItem.description}
              </span>
            ) : null}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4 shrink-0 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 8 4 4 4-4" />
          </svg>
        </ListboxButton>

        <ListboxOptions className="absolute z-50 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-1 shadow-2xl shadow-black/50 focus:outline-none">
          {items.length > 0 ? (
            items.map((item) => (
              <ListboxOption
                key={item.value}
                value={item.value}
                className={({ active, selected }) =>
                  [
                    "cursor-pointer rounded-xl px-3 py-2 text-left outline-none transition",
                    active ? "bg-white/10 text-white" : "text-slate-200",
                    selected ? "bg-amber-400/10" : "",
                  ].join(" ")
                }
              >
                <span className="block truncate text-sm font-medium">{item.label}</span>
                {item.description ? (
                  <span className="mt-0.5 block text-[11px] text-slate-400">{item.description}</span>
                ) : null}
              </ListboxOption>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-slate-500">{placeholder}</div>
          )}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isBlobUrl(url: string | null): url is string {
  return Boolean(url && url.startsWith("blob:"));
}

function loadStoredValue(key: string) {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(key) ?? "";
}

function loadStoredNumber(key: string, fallback: number) {
  const raw = loadStoredValue(key);
  const value = Number(raw);

  return Number.isFinite(value) ? value : fallback;
}

function cameraLabel(device: MediaDeviceInfo, index: number) {
  return device.label.trim() || `Camera ${index + 1}`;
}

function audioLabel(device: MediaDeviceInfo, index: number) {
  return device.label.trim() || `Microphone ${index + 1}`;
}

function friendlyCameraError(error: unknown) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return "Camera access was blocked. Enable permission and try again.";
      case "NotFoundError":
        return "No matching webcam was found.";
      case "NotReadableError":
        return "The webcam is in use by another application.";
      case "OverconstrainedError":
        return "The selected webcam cannot satisfy the requested capture settings.";
      default:
        return error.message || "Camera access failed.";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Camera access failed.";
}

function formatTimestamp(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatCameraMeasurement(value: number | undefined | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "auto";
  }

  return `${Math.round(value)}`;
}

function makeRecordingFileName() {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");

  return [
    "vinyl-reel-recording",
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
  ].join("_");
}

async function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read recording data."));
        return;
      }

      const base64Marker = ";base64,";
      const markerIndex = reader.result.indexOf(base64Marker);
      resolve(markerIndex >= 0 ? reader.result.slice(markerIndex + base64Marker.length) : reader.result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read recording data."));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64Data: string, mimeType: string) {
  const binaryString = window.atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingCaptureStreamRef = useRef<MediaStream | null>(null);
  const recordingFrameRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const recordingCountdownTimerRef = useRef<number | null>(null);
  const recordingElapsedTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const settingsCameraPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioMeterStreamRef = useRef<MediaStream | null>(null);
  const audioMeterAudioContextRef = useRef<AudioContext | null>(null);
  const audioMeterAnimationFrameRef = useRef<number | null>(null);
  const audioMeterLevelsRef = useRef({ left: 0, right: 0 });
  const audioMeterLeftBarRef = useRef<HTMLDivElement | null>(null);
  const audioMeterRightBarRef = useRef<HTMLDivElement | null>(null);
  const audioMeterLeftGreenRef = useRef<HTMLDivElement | null>(null);
  const audioMeterLeftRedRef = useRef<HTMLDivElement | null>(null);
  const audioMeterRightGreenRef = useRef<HTMLDivElement | null>(null);
  const audioMeterRightRedRef = useRef<HTMLDivElement | null>(null);
  const recordSpectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordControlAnchorRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState(() =>
    loadStoredValue("vinyl-reel-recorder.camera.device"),
  );
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraMessage, setCameraMessage] = useState(
    "Pick a webcam and the portrait preview will update here.",
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState(() =>
    loadStoredValue("vinyl-reel-recorder.audio.device"),
  );
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const [audioMessage, setAudioMessage] = useState(
    "Pick a microphone and the recorder will capture it with the clip.",
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [deviceRefreshTick, setDeviceRefreshTick] = useState(0);
  const [cameraZoom, setCameraZoom] = useState(() =>
    loadStoredNumber("vinyl-reel-recorder.camera.zoom", 1.15),
  );
  const [cameraPan, setCameraPan] = useState(() => ({
    x: loadStoredNumber("vinyl-reel-recorder.camera.pan.x", 0),
    y: loadStoredNumber("vinyl-reel-recorder.camera.pan.y", 0),
  }));
  const [isCameraViewportHovered, setIsCameraViewportHovered] = useState(false);
  const [cameraFeedSummary, setCameraFeedSummary] = useState("Awaiting camera details.");

  const [duration, setDuration] = useState<DurationChoice | null>(() => {
    const stored = Number(loadStoredValue("vinyl-reel-recorder.duration"));
    return [15, 30, 60, 90].includes(stored) ? (stored as DurationChoice) : 30;
  });
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [recordingCountdown, setRecordingCountdown] = useState<number | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [recordingNotice, setRecordingNotice] = useState(
    "Recording is ready once a webcam is active.",
  );
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState<string | null>(null);
  const [isRecordingPreviewOpen, setIsRecordingPreviewOpen] = useState(false);
  const [recordingPreviewTime, setRecordingPreviewTime] = useState(0);
  const [recordingPreviewDuration, setRecordingPreviewDuration] = useState(0);
  const recordingPreviewFileName = recordingPath
    ? recordingPath.split(/[\\/]/).pop() ?? recordingPath
    : "";

  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [artworkName, setArtworkName] = useState("No artwork selected");

  const [discogsUsername, setDiscogsUsername] = useState(() =>
    loadStoredValue("vinyl-reel-recorder.discogs.username"),
  );
  const [discogsToken, setDiscogsToken] = useState(() =>
    loadStoredValue("vinyl-reel-recorder.discogs.token"),
  );
  const [discogsStatus, setDiscogsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [discogsError, setDiscogsError] = useState<string | null>(null);
  const [discogsReleases, setDiscogsReleases] = useState<DiscogsCollectionRelease[]>([]);
  const [discogsFilter, setDiscogsFilter] = useState("");
  const [selectedDiscogsReleaseId, setSelectedDiscogsReleaseId] = useState<number | null>(null);
  const [discogsProgress, setDiscogsProgress] = useState<DiscogsCollectionProgress | null>(null);
  const [discogsNotice, setDiscogsNotice] = useState(
    "Connect your Discogs token to browse releases from your collection.",
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"camera" | "audio" | "discogs">("camera");
  const [outputPresetId, setOutputPresetId] = useState<OutputPresetId>(() => {
    const stored = loadStoredValue("vinyl-reel-recorder.output.preset");
    return stored === "square" || stored === "landscape" || stored === "vertical"
      ? stored
      : "vertical";
  });
  const discogsCacheLoadedForUserRef = useRef<string | null>(null);

  const activeCameraLabel = useMemo(() => {
    const match = cameraDevices.find((device) => device.deviceId === selectedCameraId);
    if (!match) {
      return "No camera selected";
    }

    const index = cameraDevices.indexOf(match);
    return cameraLabel(match, index);
  }, [cameraDevices, selectedCameraId]);

  const activeAudioLabel = useMemo(() => {
    if (!selectedAudioDeviceId) {
      return "Default microphone";
    }

    const match = audioDevices.find((device) => device.deviceId === selectedAudioDeviceId);
    if (!match) {
      return "Default microphone";
    }

    const index = audioDevices.indexOf(match);
    return audioLabel(match, index);
  }, [audioDevices, selectedAudioDeviceId]);

  const resetCameraFraming = () => {
    setCameraZoom(1.15);
    setCameraPan({ x: 0, y: 0 });
  };

  const setArtworkFromUrl = (url: string, name: string) => {
    setArtworkUrl((current) => {
      if (isBlobUrl(current)) {
        URL.revokeObjectURL(current);
      }

      return url;
    });
    setArtworkName(name);
  };

  const clearRecordingTimers = () => {
    if (recordingFrameRef.current !== null) {
      window.clearTimeout(recordingFrameRef.current);
      recordingFrameRef.current = null;
    }

    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }

    if (recordingCountdownTimerRef.current !== null) {
      window.clearInterval(recordingCountdownTimerRef.current);
      recordingCountdownTimerRef.current = null;
    }

    if (recordingElapsedTimerRef.current !== null) {
      window.clearInterval(recordingElapsedTimerRef.current);
      recordingElapsedTimerRef.current = null;
    }
  };

  const closeRecordingPreview = () => {
    const video = recordingPreviewVideoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }

    setIsRecordingPreviewOpen(false);
  };

  const startRecordingElapsedTimer = () => {
    clearRecordingElapsed();
    recordingStartedAtRef.current = performance.now();
    setRecordingElapsedSeconds(0);

    recordingElapsedTimerRef.current = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current;
      if (startedAt === null) {
        return;
      }

      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      setRecordingElapsedSeconds(elapsedSeconds);
    }, 250);
  };

  const resetRecordingCountdown = (nextNotice?: string) => {
    if (recordingCountdownTimerRef.current !== null) {
      window.clearInterval(recordingCountdownTimerRef.current);
      recordingCountdownTimerRef.current = null;
    }

    setRecordingCountdown(null);

    if (nextNotice) {
      setRecordingNotice(nextNotice);
    }
  };

  const clearRecordingElapsed = () => {
    if (recordingElapsedTimerRef.current !== null) {
      window.clearInterval(recordingElapsedTimerRef.current);
      recordingElapsedTimerRef.current = null;
    }

    recordingStartedAtRef.current = null;
    setRecordingElapsedSeconds(0);
  };

  const stopRecordingCaptureStream = () => {
    recordingCaptureStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingCaptureStreamRef.current = null;
  };

  const stopAudioMeter = () => {
    if (audioMeterAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(audioMeterAnimationFrameRef.current);
      audioMeterAnimationFrameRef.current = null;
    }

    audioMeterStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioMeterStreamRef.current = null;

    if (audioMeterAudioContextRef.current) {
      void audioMeterAudioContextRef.current.close();
      audioMeterAudioContextRef.current = null;
    }

    audioMeterLevelsRef.current = { left: 0, right: 0 };
    applyMeterBar(
      audioMeterLeftBarRef.current,
      audioMeterLeftGreenRef.current,
      audioMeterLeftRedRef.current,
      0,
      false,
    );
    applyMeterBar(
      audioMeterRightBarRef.current,
      audioMeterRightGreenRef.current,
      audioMeterRightRedRef.current,
      0,
      false,
    );

    const spectrumCanvas = recordSpectrumCanvasRef.current;
    const spectrumContext = spectrumCanvas?.getContext("2d");
    if (spectrumCanvas && spectrumContext) {
      spectrumContext.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    }
  };

  const replaceStream = async (stream: MediaStream) => {
    stopStream(streamRef.current);
    streamRef.current = stream;

    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = stream;
    video.muted = true;

    try {
      await video.play();
    } catch {
      // The preview still renders once the webview finishes attaching the stream.
    }
  };

  const requestCameraAccess = async () => {
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("error");
      setCameraMessage("This runtime does not expose browser camera APIs.");
      setCameraError("navigator.mediaDevices.getUserMedia is unavailable.");
      return;
    }

    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      stopStream(probe);
      setDeviceRefreshTick((value) => value + 1);
      setCameraMessage("Camera permission granted. Loading the selected webcam.");
    } catch (error) {
      const message = friendlyCameraError(error);
      setCameraStatus("error");
      setCameraMessage(message);
      setCameraError(message);
      setCameraFeedSummary("Camera details unavailable.");
      stopStream(streamRef.current);
      streamRef.current = null;
      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
      }
    }
  };

  const requestAudioAccess = async () => {
    setAudioError(null);
    setAudioStatus("loading");
    setAudioMessage("Requesting microphone access...");

    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioStatus("error");
      setAudioMessage("This runtime does not expose browser audio APIs.");
      setAudioError("navigator.mediaDevices.getUserMedia is unavailable.");
      return;
    }

    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      stopStream(probe);
      setDeviceRefreshTick((value) => value + 1);
      setAudioMessage("Microphone permission granted. Loading the selected input.");
      } catch (error) {
      const message = friendlyCameraError(error);
      setAudioStatus("error");
      setAudioMessage(message);
      setAudioError(message);
    }
  };

  useEffect(() => {
    let active = true;

    const refreshDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setCameraStatus("error");
        setCameraMessage("This runtime does not expose browser device enumeration.");
        setCameraError("navigator.mediaDevices.enumerateDevices is unavailable.");
        return;
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(
          (device): device is MediaDeviceInfo => device.kind === "videoinput",
        );
        const audioInputs = devices.filter(
          (device): device is MediaDeviceInfo => device.kind === "audioinput",
        );

        if (!active) {
          return;
        }

        setCameraDevices(videoDevices);
        setAudioDevices(audioInputs);

        if (videoDevices.length === 0) {
          setCameraStatus("no-device");
          setCameraMessage(
            "No webcam was detected. Connect one or enable permission, then refresh the list.",
          );
          setCameraFeedSummary("Camera details unavailable.");
          setSelectedCameraId("");
          return;
        }

        if (audioInputs.length === 0) {
          setAudioStatus("no-device");
          setAudioMessage(
            "No microphone was detected. Connect one or enable permission, then refresh the list.",
          );
          setSelectedAudioDeviceId("");
        } else {
          setAudioError(null);
          setAudioStatus((current) => (current === "error" ? "idle" : "ready"));
          setSelectedAudioDeviceId((current) => {
            if (current && audioInputs.some((device) => device.deviceId === current)) {
              return current;
            }

            return "";
          });
        }

        setCameraError(null);
        setCameraStatus((current) => (current === "error" ? "idle" : current));
        setSelectedCameraId((current) => {
          if (current && videoDevices.some((device) => device.deviceId === current)) {
            return current;
          }

          return videoDevices[0]?.deviceId ?? "";
        });
      } catch (error) {
        if (!active) {
          return;
        }

        const message = friendlyCameraError(error);
        setCameraStatus("error");
        setCameraMessage(message);
        setCameraError(message);
      }
    };

    void refreshDevices();

    const handleDeviceChange = () => {
      setDeviceRefreshTick((value: number) => value + 1);
    };

    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);

    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [deviceRefreshTick]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedCameraId) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setCameraFeedSummary("Camera details unavailable.");

      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
      }

      if (cameraDevices.length === 0) {
        setCameraStatus("no-device");
        setCameraMessage(
          "No webcam is ready yet. Connect a device, then grant permission if prompted.",
        );
      }

      return undefined;
    }

    const startStream = async () => {
      setCameraStatus("loading");
      setCameraMessage("Opening live camera feed...");
      setCameraError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedCameraId },
            width: { ideal: CAMERA_REQUEST_WIDTH, max: CAMERA_REQUEST_WIDTH },
            height: { ideal: CAMERA_REQUEST_HEIGHT, max: CAMERA_REQUEST_HEIGHT },
            frameRate: { ideal: CAMERA_REQUEST_FRAME_RATE, max: CAMERA_REQUEST_FRAME_RATE },
          },
          audio: false,
        });

        if (cancelled) {
          stopStream(stream);
          return;
        }

        await replaceStream(stream);

        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings();
        const width = formatCameraMeasurement(settings?.width);
        const height = formatCameraMeasurement(settings?.height);
        const frameRate = formatCameraMeasurement(settings?.frameRate);
        setCameraFeedSummary(`${width} × ${height} @ ${frameRate} fps`);

        if (!cancelled) {
          setCameraStatus("ready");
          setCameraMessage("Live preview ready.");
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = friendlyCameraError(error);
        setCameraStatus("error");
        setCameraMessage(message);
        setCameraError(message);
        setCameraFeedSummary("Camera details unavailable.");
        stopStream(streamRef.current);
        streamRef.current = null;

        const video = videoRef.current;
        if (video) {
          video.srcObject = null;
        }
      }
    };

    void startStream();

    return () => {
      cancelled = true;
    };
  }, [cameraDevices.length, selectedCameraId]);

  useEffect(() => {
    if (!isSettingsOpen || settingsTab !== "camera") {
      const video = settingsCameraPreviewVideoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }

      return undefined;
    }

    const video = settingsCameraPreviewVideoRef.current;
    if (!video) {
      return undefined;
    }

    video.srcObject = streamRef.current;
    video.muted = true;

    if (streamRef.current) {
      void video.play().catch(() => {
        // The preview updates once the stream is attached.
      });
    }

    return () => {
      if (video.srcObject === streamRef.current) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [isSettingsOpen, settingsTab, selectedCameraId, cameraStatus]);

  useEffect(() => {
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;

      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
      }
    };
  }, []);

  useEffect(() => {
    if (audioStatus !== "ready") {
      stopAudioMeter();
      return undefined;
    }

    let cancelled = false;

    const startMeter = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return;
      }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: selectedAudioDeviceId
          ? {
              deviceId: { exact: selectedAudioDeviceId },
              channelCount: { ideal: 2 },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : {
              channelCount: { ideal: 2 },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
      });

        if (cancelled) {
          stopStream(stream);
          return;
        }

        audioMeterStreamRef.current = stream;
        const audioContext = new AudioContext();
        audioMeterAudioContextRef.current = audioContext;

        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }

        const source = audioContext.createMediaStreamSource(stream);
        const inputTrack = stream.getAudioTracks()[0];
        const inputChannels = inputTrack?.getSettings().channelCount ?? 1;
        const spectrumAnalyser = audioContext.createAnalyser();
        spectrumAnalyser.fftSize = 256;
        spectrumAnalyser.smoothingTimeConstant = 0.22;

        const toLevel = (node: AnalyserNode, buffer: Uint8Array) => {
          node.getByteTimeDomainData(buffer);
          let peak = 0;
          let clipped = false;

          for (const sample of buffer) {
            const normalized = Math.abs(sample - 128) / 128;
            if (normalized > peak) {
              peak = normalized;
            }
            if (normalized >= 0.996) {
              clipped = true;
            }
          }

          return {
            level: clamp(peak * 2.6, 0, 1),
            clipped,
          };
        };

        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;

        const leftBuffer = new Uint8Array(128);
        const rightBuffer = new Uint8Array(128);
        const spectrumBuffer = new Uint8Array(spectrumAnalyser.frequencyBinCount);

        let leftAnalyser: AnalyserNode;
        let rightAnalyser: AnalyserNode | null = null;

        source.connect(spectrumAnalyser);

        if (inputChannels > 1) {
          const splitter = audioContext.createChannelSplitter(2);
          leftAnalyser = audioContext.createAnalyser();
          rightAnalyser = audioContext.createAnalyser();
          leftAnalyser.fftSize = 128;
          rightAnalyser.fftSize = 128;
          leftAnalyser.smoothingTimeConstant = 0.02;
          rightAnalyser.smoothingTimeConstant = 0.02;
          source.connect(splitter);
          splitter.connect(leftAnalyser, 0);
          splitter.connect(rightAnalyser, 1);
          leftAnalyser.connect(silentGain);
          rightAnalyser.connect(silentGain);
        } else {
          leftAnalyser = audioContext.createAnalyser();
          leftAnalyser.fftSize = 128;
          leftAnalyser.smoothingTimeConstant = 0.02;
          source.connect(leftAnalyser);
          leftAnalyser.connect(silentGain);
        }

        silentGain.connect(audioContext.destination);

        const tick = () => {
          if (cancelled) {
            return;
          }

          const rawLeft = toLevel(leftAnalyser, leftBuffer);
          const rawRight = rightAnalyser ? toLevel(rightAnalyser, rightBuffer) : rawLeft;
          const prevLevels = audioMeterLevelsRef.current;
          const smooth = (previous: number, target: number) => {
            const rise = 0.42;
            const fall = 0.18;
            const blend = target >= previous ? rise : fall;
            return previous + (target - previous) * blend;
          };

          const leftLevel = smooth(prevLevels.left, rawLeft.level);
          const rightLevel = smooth(prevLevels.right, rawRight.level);

          audioMeterLevelsRef.current = {
            left: leftLevel,
            right: rightLevel,
          };
          applyMeterBar(
            audioMeterLeftBarRef.current,
            audioMeterLeftGreenRef.current,
            audioMeterLeftRedRef.current,
            leftLevel,
            rawLeft.clipped,
          );
          applyMeterBar(
            audioMeterRightBarRef.current,
            audioMeterRightGreenRef.current,
            audioMeterRightRedRef.current,
            rightLevel,
            rawRight.clipped,
          );
          spectrumAnalyser.getByteFrequencyData(spectrumBuffer);
          drawRecordSpectrum(
            recordSpectrumCanvasRef.current,
            recordControlAnchorRef.current,
            spectrumBuffer,
            audioContext.sampleRate,
          );
          audioMeterAnimationFrameRef.current = window.requestAnimationFrame(tick);
        };

        tick();
      } catch {
        if (!cancelled) {
          audioMeterLevelsRef.current = { left: 0, right: 0 };
          applyMeterBar(
            audioMeterLeftBarRef.current,
            audioMeterLeftGreenRef.current,
            audioMeterLeftRedRef.current,
            0,
            false,
          );
          applyMeterBar(
            audioMeterRightBarRef.current,
            audioMeterRightGreenRef.current,
            audioMeterRightRedRef.current,
            0,
            false,
          );
        }
      }
    };

    void startMeter();

    return () => {
      cancelled = true;
      stopAudioMeter();
    };
  }, [audioStatus, isSettingsOpen, recordingStatus, selectedAudioDeviceId, settingsTab]);

  useEffect(() => {
    return () => {
      if (isBlobUrl(artworkUrl)) {
        URL.revokeObjectURL(artworkUrl);
      }
    };
  }, [artworkUrl]);

  useEffect(() => {
    return () => {
      if (isBlobUrl(recordingPreviewUrl)) {
        URL.revokeObjectURL(recordingPreviewUrl);
      }
    };
  }, [recordingPreviewUrl]);

  useEffect(() => {
    if (!recordingPath) {
      setIsRecordingPreviewOpen(false);
      return;
    }

    setIsRecordingPreviewOpen(true);
    setRecordingPreviewTime(0);
    setRecordingPreviewDuration(0);
  }, [recordingPath]);

  useEffect(() => {
    if (!isRecordingPreviewOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRecordingPreview();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecordingPreviewOpen]);

  useEffect(() => {
    if (!isRecordingPreviewOpen) {
      return;
    }

    const video = recordingPreviewVideoRef.current;
    if (video) {
      video.load();
    }
  }, [isRecordingPreviewOpen, recordingPreviewUrl, recordingPath]);

  useEffect(() => {
    return () => {
      clearRecordingTimers();
      clearRecordingElapsed();
      recordingCaptureStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingCaptureStreamRef.current = null;

      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.discogs.username", discogsUsername);
  }, [discogsUsername]);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.discogs.token", discogsToken);
  }, [discogsToken]);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.audio.device", selectedAudioDeviceId);
  }, [selectedAudioDeviceId]);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.camera.device", selectedCameraId);
  }, [selectedCameraId]);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.camera.zoom", String(cameraZoom));
  }, [cameraZoom]);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.camera.pan.x", String(cameraPan.x));
  }, [cameraPan.x]);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.camera.pan.y", String(cameraPan.y));
  }, [cameraPan.y]);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.duration", String(duration ?? ""));
  }, [duration]);

  useEffect(() => {
    window.localStorage.setItem("vinyl-reel-recorder.output.preset", outputPresetId);
  }, [outputPresetId]);

  useEffect(() => {
    const username = discogsUsername.trim();

    if (!username) {
      discogsCacheLoadedForUserRef.current = null;
      return;
    }

    if (discogsCacheLoadedForUserRef.current === username) {
      return;
    }

    let cancelled = false;

    void invoke<DiscogsCollectionRelease[] | null>("load_discogs_collection_cache", {
      username,
    })
      .then((cachedReleases) => {
        if (cancelled) {
          return;
        }

        discogsCacheLoadedForUserRef.current = username;

        if (!cachedReleases || cachedReleases.length === 0) {
          return;
        }

        setDiscogsReleases(cachedReleases);
        setDiscogsStatus("ready");
        setDiscogsNotice(`Loaded ${cachedReleases.length} cached collection releases.`);
        setSelectedDiscogsReleaseId(cachedReleases[0]?.instance_id ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          discogsCacheLoadedForUserRef.current = username;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [discogsUsername]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSettingsOpen]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void listen<DiscogsCollectionProgress>("discogs-collection-progress", ({ payload }) => {
      if (cancelled) {
        return;
      }

      setDiscogsProgress(payload);

      if (payload.status === "complete") {
        setDiscogsStatus("ready");
      }
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }

        unlisten = cleanup;
      })
      .catch(() => {
        // If the event bridge is unavailable, the load still works and will complete normally.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const loadDiscogsCollection = async () => {
    const username = discogsUsername.trim();
    const token = discogsToken.trim();

    if (!username || !token) {
      setDiscogsStatus("error");
      setDiscogsError("Enter both your Discogs username and token.");
      setDiscogsNotice("Discogs needs a username and token to load your collection.");
      return;
    }

    setDiscogsStatus("loading");
    setDiscogsError(null);
    setDiscogsNotice("Loading your Discogs collection...");
    setDiscogsProgress(null);
    setDiscogsReleases([]);
    setSelectedDiscogsReleaseId(null);

    try {
      const releases = await invoke<DiscogsCollectionRelease[]>("discogs_collection_releases", {
        username,
        token,
        folderId: 0,
      });

      setDiscogsReleases(releases);
      discogsCacheLoadedForUserRef.current = username;
      void invoke("save_discogs_collection_cache", { username, releases }).catch(() => {
        // The live collection load still succeeded even if the cache write did not.
      });
      setDiscogsStatus("ready");
      setDiscogsNotice(`Loaded ${releases.length} collection releases from Discogs and cached them locally.`);
      setSelectedDiscogsReleaseId(releases[0]?.instance_id ?? null);
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : error && typeof error === "object" && "message" in error
              ? String((error as { message?: unknown }).message ?? "Failed to load Discogs.")
              : "Failed to load Discogs.";
      setDiscogsStatus("error");
      setDiscogsError(message);
      setDiscogsNotice(message);
      setDiscogsProgress(null);
    }
  };

  const filteredDiscogsReleases = useMemo(() => {
    const filter = discogsFilter.trim().toLowerCase();

    if (!filter) {
      return discogsReleases;
    }

    return discogsReleases.filter((release) => {
      const haystack = [
        release.artist,
        release.title,
        release.year?.toString() ?? "",
        release.label ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(filter);
    });
  }, [discogsFilter, discogsReleases]);

  const useDiscogsArtwork = async (release: DiscogsCollectionRelease) => {
    const artwork = release.cover_image ?? release.thumb;
    setSelectedDiscogsReleaseId(release.instance_id);

    if (!artwork) {
      setArtworkUrl(null);
      setArtworkName("No artwork selected");
      setDiscogsNotice("This Discogs release does not include cover art.");
      return;
    }

    setDiscogsNotice("Loading selected cover art...");
    setDiscogsError(null);

    try {
      const dataUrl = await invoke<string>("fetch_remote_image_data_url", {
        url: artwork,
      });
      setArtworkFromUrl(dataUrl, `${release.artist} - ${release.title}`);
      setDiscogsNotice("Artwork loaded from Discogs.");
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : error && typeof error === "object" && "message" in error
              ? String((error as { message?: unknown }).message ?? "Failed to load cover art.")
              : "Failed to load cover art.";
      setDiscogsError(message);
      setDiscogsNotice(message);
    }
  };

  const saveRecordingBlob = async (blob: Blob, durationSeconds: number) => {
    const base64Data = await blobToBase64(blob);

    try {
      setRecordingNotice("Encoding with FFmpeg...");
      const savedPath = await invoke<string>("encode_recording_with_ffmpeg", {
        fileName: `${makeRecordingFileName()}.mp4`,
        base64Data,
        artworkDataUrl: artworkUrl,
        durationSeconds,
        outputWidth,
        outputHeight,
        cameraZoom,
        cameraPanX: cameraPan.x,
        cameraPanY: cameraPan.y,
      });
      const previewBase64 = await invoke<string>("read_file_base64", {
        filePath: savedPath,
      });
      const previewMime = savedPath.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4";
      const previewBlob = base64ToBlob(previewBase64, previewMime);
      const previewUrl = URL.createObjectURL(previewBlob);

      setRecordingPreviewUrl((current) => {
        if (current && current.startsWith("blob:")) {
          URL.revokeObjectURL(current);
        }

        return previewUrl;
      });
      setRecordingPath(savedPath);
      setRecordingNotice("Recording saved successfully.");
      setRecordingStatus("saved");
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : error && typeof error === "object" && "message" in error
              ? String((error as { message?: unknown }).message ?? "FFmpeg export failed.")
              : "FFmpeg export failed.";

      setRecordingStatus("error");
      setRecordingNotice(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      return;
    }

    setRecordingStatus("saving");
    setRecordingNotice("Stopping and saving the clip...");
    recorder.stop();
  };

  const beginRecordingCapture = async () => {
    if (!previewCameraReady) {
      setRecordingStatus("error");
      setRecordingNotice("Connect a webcam before recording.");
      return;
    }

    if (recordingStatus === "recording" || recordingStatus === "saving") {
      return;
    }

    const codecCandidates: Array<{ mime: string; format: "mp4" | "webm" }> = [
      { mime: "video/webm;codecs=vp9,opus", format: "webm" },
      { mime: "video/webm;codecs=vp8,opus", format: "webm" },
      { mime: "video/webm;codecs=opus", format: "webm" },
      { mime: "video/webm;codecs=vp9", format: "webm" },
      { mime: "video/webm;codecs=vp8", format: "webm" },
      { mime: "video/webm", format: "webm" },
      { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", format: "mp4" },
      { mime: "video/mp4;codecs=avc1.42E01E", format: "mp4" },
      { mime: "video/mp4", format: "mp4" },
    ];
    const selectedMime = codecCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate.mime));

    if (!selectedMime) {
      setRecordingStatus("error");
      setRecordingNotice("This runtime cannot record video in a supported format.");
      return;
    }

    clearRecordingTimers();
    recordingChunksRef.current = [];
    const sourceStream = streamRef.current;

    if (!sourceStream) {
      setRecordingStatus("error");
      setRecordingNotice("Connect a webcam before recording.");
      return;
    }

    let audioStream: MediaStream | null = null;
    let useAudio = true;

    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: selectedAudioDeviceId
          ? {
              deviceId: { exact: selectedAudioDeviceId },
              channelCount: { ideal: 2 },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              sampleRate: { ideal: 48000 },
            }
          : {
              channelCount: { ideal: 2 },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              sampleRate: { ideal: 48000 },
            },
      });
    } catch (error) {
      if (audioStatus === "no-device") {
        useAudio = false;
        setRecordingNotice("No microphone detected. Recording video only.");
      } else {
        const message = friendlyCameraError(error);
        setRecordingStatus("error");
        setRecordingNotice(message);
        return;
      }
    }

    const captureTracks = [...sourceStream.getVideoTracks().map((track) => track.clone())];
    if (useAudio && audioStream) {
      const audioTrack = audioStream.getAudioTracks()[0];
      if (audioTrack) {
        captureTracks.push(audioTrack);
      }
    }

    const captureStream = new MediaStream(captureTracks);

    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(captureStream, {
        mimeType: selectedMime.mime,
        videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: 256_000,
      });
    } catch (error) {
      audioStream?.getTracks().forEach((track) => track.stop());
      setRecordingStatus("error");
      setRecordingNotice(
        error instanceof Error ? error.message : "This runtime could not create a recorder.",
      );
      return;
    }

    mediaRecorderRef.current = recorder;
    recordingCaptureStreamRef.current = captureStream;
    setRecordingPath(null);
    setRecordingStatus("recording");
    startRecordingElapsedTimer();
    setRecordingNotice(
      selectedMime.format === "mp4"
        ? useAudio
          ? "Recording as MP4 with audio..."
          : "Recording as MP4 without audio..."
        : useAudio
          ? "MP4 is unavailable here, recording as WebM with audio..."
          : "MP4 is unavailable here, recording as WebM without audio...",
    );

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      clearRecordingTimers();
      clearRecordingElapsed();
      stopRecordingCaptureStream();
      audioStream?.getTracks().forEach((track) => track.stop());
      setRecordingStatus("error");
      setRecordingNotice("The recorder encountered an error.");
    };

    recorder.onstop = async () => {
      const recordedDurationSeconds = recordingStartedAtRef.current
        ? Math.max((performance.now() - recordingStartedAtRef.current) / 1000, 0.1)
        : Math.max(recordingElapsedSeconds, 0.1);

      clearRecordingTimers();
      stopRecordingCaptureStream();
      audioStream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;

      const recordedBlob = new Blob(recordingChunksRef.current, { type: recorder.mimeType });
      recordingChunksRef.current = [];

      if (recordedBlob.size === 0) {
        setRecordingStatus("error");
        setRecordingNotice("The recording finished without any data.");
        return;
      }

      try {
        await saveRecordingBlob(recordedBlob, recordedDurationSeconds);
      } catch (error) {
        setRecordingStatus("error");
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Failed to save the recording.";
        setRecordingNotice(message);
      }
    };

    recorder.start();

    if (duration !== null) {
      recordingTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, duration * 1000);
    }
  };

  const startRecording = async () => {
    if (recordingStatus === "countdown") {
      resetRecordingCountdown("Recording countdown cancelled.");
      setRecordingStatus("idle");
      return;
    }

    if (recordingStatus === "recording" || recordingStatus === "saving") {
      return;
    }

    setRecordingStatus("countdown");
    setRecordingNotice("Recording starts in 3...");
    setRecordingCountdown(3);

    clearRecordingTimers();
    let step = 3;
    recordingCountdownTimerRef.current = window.setInterval(() => {
      step -= 1;

      if (step <= 0) {
        resetRecordingCountdown();
        setRecordingStatus("idle");
        window.setTimeout(() => {
          void beginRecordingCapture();
        }, 0);
        return;
      }

      setRecordingCountdown(step);
      setRecordingNotice(`Recording starts in ${step}...`);
    }, 1000);
  };

  const previewCameraReady = cameraStatus === "ready";
  const previewHasArtwork = Boolean(artworkUrl);
  const outputPresetOptions = useMemo(
    () =>
      OUTPUT_PRESETS.map((preset) => ({
        value: preset.id,
        label: preset.label,
      })),
    [],
  );
  const cameraDeviceOptions = useMemo(
    () =>
      cameraDevices.map((device, index) => ({
        value: device.deviceId,
        label: cameraLabel(device, index),
      })),
    [cameraDevices],
  );
  const audioDeviceOptions = useMemo(
    () => [
      { value: "", label: "Default microphone", description: "Use the system default input" },
      ...audioDevices.map((device, index) => ({
        value: device.deviceId,
        label: audioLabel(device, index),
      })),
    ],
    [audioDevices],
  );
  const recordingActionLabel =
    recordingStatus === "countdown"
      ? "Cancel"
      : recordingStatus === "recording"
        ? "Stop"
        : recordingStatus === "saving"
          ? "Saving..."
          : "Record";
  const recordingPreviewSrc = recordingPreviewUrl ?? "";
  const cameraStateLabel =
    cameraStatus === "ready"
      ? "Camera ready"
      : cameraStatus === "loading"
        ? "Opening preview"
        : cameraStatus === "no-device"
        ? "No webcam found"
        : cameraStatus === "error"
        ? "Camera needs attention"
        : "Awaiting camera";

  const audioStateLabel =
    audioStatus === "ready"
      ? "Microphone ready"
      : audioStatus === "loading"
        ? "Checking audio"
        : audioStatus === "no-device"
          ? "No microphone found"
          : audioStatus === "error"
            ? "Audio needs attention"
            : "Awaiting audio";

  const applyMeterBar = (
    barElement: HTMLDivElement | null,
    greenElement: HTMLDivElement | null,
    redElement: HTMLDivElement | null,
    level: number,
    clipped: boolean,
  ) => {
    if (!barElement || !greenElement || !redElement) {
      return;
    }

    const safeLevel = clamp(level, 0, 1);
    const greenThreshold = 0.8;
    const displayLevel = clipped ? 1 : safeLevel;
    const filledWidth = Math.max(0, Math.min(100, displayLevel * 100));
    const greenWidth =
      clipped || displayLevel <= greenThreshold
        ? Math.max(0, Math.min(100, displayLevel * 100))
        : 80;
    const redWidth = clipped ? 20 : Math.max(0, Math.min(100, filledWidth - greenWidth));

    barElement.style.width = `${filledWidth}%`;
    barElement.style.display = filledWidth > 0 ? "block" : "none";
    greenElement.style.width = `${greenWidth}%`;
    redElement.style.width = `${redWidth}%`;
    greenElement.style.backgroundColor = "#22c55e";
    redElement.style.backgroundColor = "#ef4444";
    greenElement.style.display = greenWidth > 0 ? "block" : "none";
    redElement.style.display = redWidth > 0 ? "block" : "none";
  };

  const drawRecordSpectrum = (
    canvas: HTMLCanvasElement | null,
    anchor: HTMLDivElement | null,
    spectrum: Uint8Array,
    sampleRate: number,
  ) => {
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(2, 6, 23, 0.10)";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const ringCount = 5;
    const segmentCount = 24;
    const noiseFloor = 0.04;
    const minFrequency = 40;
    const maxFrequency = 16_000;
    const logMin = Math.log10(minFrequency);
    const logMax = Math.log10(maxFrequency);

    const readBand = (position: number) => {
      const normalizedPosition = clamp(position, 0, 1);
      const frequency = 10 ** (logMin + (logMax - logMin) * normalizedPosition);
      const rawIndex = Math.round((frequency / (sampleRate / 2)) * (spectrum.length - 1));
      const centerIndex = clamp(rawIndex, 0, spectrum.length - 1);
      const windowRadius = Math.max(1, Math.round(spectrum.length * 0.012));
      let sum = 0;
      let count = 0;
      let localPeak = 0;

      for (
        let bin = Math.max(0, centerIndex - windowRadius);
        bin <= Math.min(spectrum.length - 1, centerIndex + windowRadius);
        bin += 1
      ) {
        const value = spectrum[bin] ?? 0;
        sum += value;
        count += 1;
        localPeak = Math.max(localPeak, value);
      }

      const average = sum / Math.max(1, count);
      const combined = average * 0.35 + localPeak * 0.65;
      const baseLevel = clamp(combined / 255, 0, 1);
      return clamp(Math.pow(Math.max(0, baseLevel - noiseFloor) / (1 - noiseFloor), 0.88), 0, 1);
    };

    const anchorRect = anchor?.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const centerX = anchorRect
      ? (anchorRect.left + anchorRect.width / 2 - canvasRect.left) * dpr
      : canvas.width / 2;
    const centerY = anchorRect
      ? (anchorRect.top + anchorRect.height / 2 - canvasRect.top) * dpr
      : canvas.height / 2;
    const maxRadius = Math.min(canvas.width, canvas.height) * 0.42;
    const minRadius = Math.max(18, maxRadius * 0.28);
    const ringThickness = (maxRadius - minRadius) / ringCount;
    const segmentGap = Math.PI / 180 * 1.8;
    const startAngle = -Math.PI / 2;

    context.save();
    context.translate(centerX, centerY);

    const inactiveColor = "rgba(103, 100, 109, 0.78)";
    const innerLitColor = "rgba(245, 245, 244, 0.98)";
    const midLitColor = "rgba(252, 211, 77, 0.98)";
    const outerLitColor = "rgba(248, 113, 113, 0.98)";

    for (let ring = 0; ring < ringCount; ring += 1) {
      const ringOuter = maxRadius - ring * ringThickness;
      const ringInner = ringOuter - ringThickness * 0.9;
      const ringWidth = ringOuter - ringInner;

      for (let segment = 0; segment < segmentCount; segment += 1) {
        const normalized = readBand(segment / Math.max(1, segmentCount - 1));
        const lit = normalized * ringCount > ringCount - ring - 1;
        const start = startAngle + (segment / segmentCount) * Math.PI * 2 + segmentGap * 0.5;
        const end = startAngle + ((segment + 1) / segmentCount) * Math.PI * 2 - segmentGap * 0.5;

        context.beginPath();
        context.arc(0, 0, ringOuter, start, end);
        context.arc(0, 0, ringInner, end, start, true);
        context.closePath();
        if (lit) {
          if (ring >= 3) {
            context.fillStyle = outerLitColor;
          } else if (ring === 2) {
            context.fillStyle = midLitColor;
          } else {
            context.fillStyle = innerLitColor;
          }
        } else {
          context.fillStyle = inactiveColor;
        }
        context.shadowColor = "transparent";
        context.fill();

        context.beginPath();
        context.strokeStyle = "rgba(0, 0, 0, 0.35)";
        context.lineWidth = Math.max(1, ringWidth * 0.12);
        context.arc(0, 0, ringOuter, start, end);
        context.stroke();
      }
    }

    context.restore();
  };

  const discogsStatusLabel =
    discogsStatus === "loading"
      ? "Loading collection"
      : discogsStatus === "ready"
        ? "Collection loaded"
        : discogsStatus === "error"
          ? "Connection issue"
          : "Not connected";

  const discogsProgressPercent =
    discogsProgress?.pages && discogsProgress.pages > 0
      ? clamp((discogsProgress.page / discogsProgress.pages) * 100, 0, 100)
      : discogsStatus === "loading"
        ? 12
        : 0;
  const selectedOutputPreset =
    OUTPUT_PRESETS.find((preset) => preset.id === outputPresetId) ?? OUTPUT_PRESETS[0];
  const isLandscapePreset = outputPresetId === "landscape";
  const artworkObjectPosition =
    outputPresetId === "square"
      ? "center top"
      : outputPresetId === "landscape"
        ? "left center"
        : "center center";
  const outputWidth = selectedOutputPreset.width;
  const outputHeight = selectedOutputPreset.height;
  const previewLayoutAspectRatio = `${outputWidth} / ${outputHeight}`;
  const cameraPreviewSectionHeight = (outputHeight * 120) / 271;
  const artworkPreviewSectionHeight = outputHeight - cameraPreviewSectionHeight;

  useEffect(() => {
    if (!previewCameraReady || !isCameraViewportHovered) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 1 : 1.5;

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          setCameraPan((current) => ({ x: clamp(current.x - step, -28, 28), y: current.y }));
          break;
        case "ArrowRight":
          event.preventDefault();
          setCameraPan((current) => ({ x: clamp(current.x + step, -28, 28), y: current.y }));
          break;
        case "ArrowUp":
          event.preventDefault();
          setCameraPan((current) => ({ x: current.x, y: clamp(current.y - step, -28, 28) }));
          break;
        case "ArrowDown":
          event.preventDefault();
          setCameraPan((current) => ({ x: current.x, y: clamp(current.y + step, -28, 28) }));
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCameraViewportHovered, previewCameraReady]);

  return (
    <main className="relative min-h-screen overflow-hidden px-3 py-2 text-slate-100 sm:px-4 lg:px-6">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-12%] top-[-10%] h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute right-[-8%] top-[20%] h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-[-18%] left-[18%] h-80 w-80 rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex h-[calc(100dvh-1rem)] max-w-[1680px] flex-col gap-3 overflow-hidden">

        <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_400px]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/65 p-3 shadow-2xl shadow-black/30 backdrop-blur">
            <div className="mb-3 flex items-start justify-between gap-3 px-0.5">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                  Portrait Preview
                </p>
              </div>
              <div className="w-[210px]">
                <DropdownListbox
                  items={outputPresetOptions}
                  value={outputPresetId}
                  onChange={(value) => setOutputPresetId(value as OutputPresetId)}
                  placeholder="Select output"
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div
                className="flex w-full max-w-full flex-col"
                style={{
                  width: isLandscapePreset
                    ? `min(100%, 530px, calc((100dvh - 19rem) * ${outputWidth} / ${outputHeight}))`
                    : `min(100%, 530px, calc((100dvh - 24rem) * ${outputWidth} / ${outputHeight}))`,
                }}
              >
                <div
                  className="min-h-0 overflow-hidden rounded-[34px] border border-white/10 bg-[#050913] shadow-[0_30px_90px_rgba(0,0,0,0.55)]"
                  style={{ aspectRatio: previewLayoutAspectRatio }}
                >
                  {isLandscapePreset ? (
                    <div className="grid h-full grid-cols-2">
                      <section className="relative overflow-hidden border-r border-white/10 bg-slate-900">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.16),transparent_44%),linear-gradient(180deg,rgba(15,23,42,0.15),rgba(2,6,23,0.78))]" />
                        <div
                          ref={viewportRef}
                          className={[
                            "absolute inset-0 overflow-hidden",
                            previewCameraReady
                              ? "cursor-grab active:cursor-grabbing"
                              : "cursor-default",
                          ].join(" ")}
                          onPointerEnter={() => setIsCameraViewportHovered(true)}
                          onPointerLeave={() => setIsCameraViewportHovered(false)}
                          onPointerDown={(event) => {
                            if (!previewCameraReady) {
                              return;
                            }

                            dragStateRef.current = {
                              pointerId: event.pointerId,
                              startX: event.clientX,
                              startY: event.clientY,
                              startPanX: cameraPan.x,
                              startPanY: cameraPan.y,
                            };

                            event.currentTarget.setPointerCapture(event.pointerId);
                          }}
                          onPointerMove={(event) => {
                            const dragState = dragStateRef.current;
                            if (!dragState || dragState.pointerId !== event.pointerId) {
                              return;
                            }

                            const rect = viewportRef.current?.getBoundingClientRect();
                            if (!rect) {
                              return;
                            }

                            const deltaX = ((event.clientX - dragState.startX) / rect.width) * 100;
                            const deltaY = ((event.clientY - dragState.startY) / rect.height) * 100;

                            setCameraPan({
                              x: clamp(dragState.startPanX + deltaX, -28, 28),
                              y: clamp(dragState.startPanY + deltaY, -28, 28),
                            });
                          }}
                          onPointerUp={(event) => {
                            if (dragStateRef.current?.pointerId === event.pointerId) {
                              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                event.currentTarget.releasePointerCapture(event.pointerId);
                              }
                              dragStateRef.current = null;
                            }
                          }}
                          onPointerCancel={(event) => {
                            if (dragStateRef.current?.pointerId === event.pointerId) {
                              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                event.currentTarget.releasePointerCapture(event.pointerId);
                              }
                              dragStateRef.current = null;
                            }
                          }}
                          onWheel={(event) => {
                            if (!previewCameraReady) {
                              return;
                            }

                            event.preventDefault();

                            const zoomStep = event.deltaY < 0 ? 0.045 : -0.045;
                            setCameraZoom((current) => clamp(current + zoomStep, 1, 2.2));
                          }}
                          title={
                            previewCameraReady
                              ? "Drag to reposition the camera feed within the frame"
                              : undefined
                          }
                        >
                          <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            className={[
                              "absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-300",
                              previewCameraReady ? "opacity-100" : "opacity-0",
                            ].join(" ")}
                            style={{
                              transform: `translate3d(${cameraPan.x}%, ${cameraPan.y}%, 0) scale(${cameraZoom})`,
                              transformOrigin: "center center",
                            }}
                          />

                          {!previewCameraReady ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
                              <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[11px] uppercase tracking-[0.42em] text-slate-300 backdrop-blur">
                                Live deck cam
                              </div>
                              <p className="max-w-xs text-sm leading-6 text-slate-300">
                                {cameraMessage}
                              </p>
                              <p className="text-xs uppercase tracking-[0.32em] text-slate-500">
                                Preview appears here once a webcam is active.
                              </p>
                            </div>
                          ) : (
                            <div className="absolute bottom-4 left-4 rounded-full border border-black/30 bg-black/35 px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-white/90 backdrop-blur">
                              Drag to reposition
                            </div>
                          )}
                        </div>

                        {recordingStatus === "countdown" && recordingCountdown !== null ? (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
                            <div className="flex h-28 w-28 items-center justify-center rounded-full border border-white/15 bg-black/50 text-6xl font-semibold text-white shadow-2xl shadow-black/50">
                              {recordingCountdown}
                            </div>
                          </div>
                        ) : null}
                      </section>

                      <section className="relative overflow-hidden bg-slate-950">
                        {previewHasArtwork ? (
                          <img
                            src={artworkUrl ?? undefined}
                            alt={artworkName}
                            className="absolute inset-0 h-full w-full object-cover"
                            style={{ objectPosition: artworkObjectPosition }}
                          />
                        ) : (
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,#05070d_0%,#0b1220_100%)]" />
                        )}
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,7,13,0.12)_0%,rgba(11,18,32,0.42)_48%,rgba(5,7,13,0.86)_100%)]" />
                      </section>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col">
                      <section
                        className="relative flex-none overflow-hidden border-b border-white/10 bg-slate-900"
                        style={{ height: `${(cameraPreviewSectionHeight / outputHeight) * 100}%` }}
                      >
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.16),transparent_44%),linear-gradient(180deg,rgba(15,23,42,0.15),rgba(2,6,23,0.78))]" />
                        <div
                          ref={viewportRef}
                          className={[
                            "absolute inset-0 overflow-hidden",
                            previewCameraReady
                              ? "cursor-grab active:cursor-grabbing"
                              : "cursor-default",
                          ].join(" ")}
                          onPointerEnter={() => setIsCameraViewportHovered(true)}
                          onPointerLeave={() => setIsCameraViewportHovered(false)}
                          onPointerDown={(event) => {
                            if (!previewCameraReady) {
                              return;
                            }

                            dragStateRef.current = {
                              pointerId: event.pointerId,
                              startX: event.clientX,
                              startY: event.clientY,
                              startPanX: cameraPan.x,
                              startPanY: cameraPan.y,
                            };

                            event.currentTarget.setPointerCapture(event.pointerId);
                          }}
                          onPointerMove={(event) => {
                            const dragState = dragStateRef.current;
                            if (!dragState || dragState.pointerId !== event.pointerId) {
                              return;
                            }

                            const rect = viewportRef.current?.getBoundingClientRect();
                            if (!rect) {
                              return;
                            }

                            const deltaX = ((event.clientX - dragState.startX) / rect.width) * 100;
                            const deltaY = ((event.clientY - dragState.startY) / rect.height) * 100;

                            setCameraPan({
                              x: clamp(dragState.startPanX + deltaX, -28, 28),
                              y: clamp(dragState.startPanY + deltaY, -28, 28),
                            });
                          }}
                          onPointerUp={(event) => {
                            if (dragStateRef.current?.pointerId === event.pointerId) {
                              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                event.currentTarget.releasePointerCapture(event.pointerId);
                              }
                              dragStateRef.current = null;
                            }
                          }}
                          onPointerCancel={(event) => {
                            if (dragStateRef.current?.pointerId === event.pointerId) {
                              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                event.currentTarget.releasePointerCapture(event.pointerId);
                              }
                              dragStateRef.current = null;
                            }
                          }}
                          onWheel={(event) => {
                            if (!previewCameraReady) {
                              return;
                            }

                            event.preventDefault();

                            const zoomStep = event.deltaY < 0 ? 0.045 : -0.045;
                            setCameraZoom((current) => clamp(current + zoomStep, 1, 2.2));
                          }}
                          title={
                            previewCameraReady
                              ? "Drag to reposition the camera feed within the frame"
                              : undefined
                          }
                        >
                          <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            className={[
                              "absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-300",
                              previewCameraReady ? "opacity-100" : "opacity-0",
                            ].join(" ")}
                            style={{
                              transform: `translate3d(${cameraPan.x}%, ${cameraPan.y}%, 0) scale(${cameraZoom})`,
                              transformOrigin: "center center",
                            }}
                          />

                          {!previewCameraReady ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
                              <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[11px] uppercase tracking-[0.42em] text-slate-300 backdrop-blur">
                                Live deck cam
                              </div>
                              <p className="max-w-xs text-sm leading-6 text-slate-300">
                                {cameraMessage}
                              </p>
                              <p className="text-xs uppercase tracking-[0.32em] text-slate-500">
                                Preview appears here once a webcam is active.
                              </p>
                            </div>
                          ) : (
                            <div className="absolute bottom-4 left-4 rounded-full border border-black/30 bg-black/35 px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-white/90 backdrop-blur">
                              Drag to reposition
                            </div>
                          )}
                        </div>

                        {recordingStatus === "countdown" && recordingCountdown !== null ? (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
                            <div className="flex h-28 w-28 items-center justify-center rounded-full border border-white/15 bg-black/50 text-6xl font-semibold text-white shadow-2xl shadow-black/50">
                              {recordingCountdown}
                            </div>
                          </div>
                        ) : null}
                      </section>

                      <section
                        className="relative flex-none overflow-hidden bg-slate-950"
                        style={{ height: `${(artworkPreviewSectionHeight / outputHeight) * 100}%` }}
                      >
                        {previewHasArtwork ? (
                          <img
                            src={artworkUrl ?? undefined}
                            alt={artworkName}
                            className="absolute inset-0 h-full w-full object-cover"
                            style={{ objectPosition: artworkObjectPosition }}
                          />
                        ) : (
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,#05070d_0%,#0b1220_100%)]" />
                        )}
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,7,13,0.12)_0%,rgba(11,18,32,0.42)_48%,rgba(5,7,13,0.86)_100%)]" />
                      </section>
                    </div>
                  )}
                </div>

                <section className="relative mt-2 shrink-0 overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/85 px-4 py-4 shadow-2xl shadow-black/40 backdrop-blur">
                  <div className="pointer-events-none absolute inset-0 opacity-80">
                    <canvas
                      ref={recordSpectrumCanvasRef}
                      className="h-full w-full"
                    />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.16),transparent_52%),linear-gradient(180deg,rgba(15,23,42,0.04),rgba(2,6,23,0.72))]" />
                  </div>

                  <div className="relative z-10 flex flex-col items-center gap-3">
                    <div ref={recordControlAnchorRef} className="relative">
                      <button
                        type="button"
                        disabled={recordingStatus === "saving"}
                        onClick={() => {
                          if (recordingStatus === "recording") {
                            stopRecording();
                            return;
                          }

                          void startRecording();
                        }}
                        className={[
                          "flex h-20 w-20 items-center justify-center rounded-full border text-white shadow-[0_0_0_8px_rgba(225,29,72,0.12)] transition",
                          recordingStatus === "recording"
                            ? "border-rose-200/40 bg-gradient-to-br from-rose-400 to-red-500 shadow-[0_0_0_10px_rgba(248,113,113,0.16)] animate-pulse"
                            : "border-rose-300/25 bg-gradient-to-br from-rose-500 to-red-600",
                          recordingStatus === "saving" ? "cursor-wait opacity-70" : "hover:scale-105",
                        ].join(" ")}
                        aria-label="Record"
                      >
                        <span className="sr-only">{recordingActionLabel}</span>
                        {recordingStatus === "recording" ? (
                          <span className="h-6 w-6 rounded-md bg-white/95 shadow-inner" />
                        ) : (
                          <span className="h-8 w-8 rounded-full bg-white/95 shadow-inner" />
                        )}
                      </button>
                    </div>

                    <div className="text-center">
                      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-slate-400">
                        {recordingActionLabel}
                      </p>
                      <p className="mt-1 text-xs text-slate-300">
                        {recordingNotice}
                        {(recordingStatus === "recording" || recordingStatus === "saving") &&
                        recordingElapsedSeconds > 0
                          ? ` · ${formatTimestamp(recordingElapsedSeconds)}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex w-full flex-wrap justify-center gap-2">
                      {durationOptions.map((option) => {
                        const selected = duration === option.value;

                        return (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => setDuration((current) => (current === option.value ? null : option.value))}
                            className={[
                              "inline-flex min-w-[3.4rem] items-center justify-center rounded-full border px-2.5 py-1.5 text-[9px] font-medium leading-none transition",
                              selected
                                ? "border-amber-300/50 bg-amber-400/20 text-amber-50 shadow-lg shadow-amber-950/20"
                                : "border-white/10 bg-white/5 text-slate-100 hover:border-amber-400/30 hover:bg-amber-400/10",
                            ].join(" ")}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>

                  </div>
                </section>
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col gap-3">
            <DiscogsPanel
              status={discogsStatus}
              statusLabel={discogsStatusLabel}
              progress={discogsProgress}
              progressPercent={discogsProgressPercent}
              notice={discogsNotice}
              error={discogsError}
              filter={discogsFilter}
              onFilterChange={setDiscogsFilter}
              visibleCount={filteredDiscogsReleases.length}
              totalCount={discogsReleases.length}
              releases={filteredDiscogsReleases}
              selectedReleaseId={selectedDiscogsReleaseId}
              onLoad={() => {
                void loadDiscogsCollection();
              }}
              onSelectRelease={(release) => {
                void useDiscogsArtwork(release);
              }}
            />
          </aside>
        </section>

        <canvas
          ref={recordingCanvasRef}
          className="hidden"
          width={outputWidth}
          height={outputHeight}
        />

        <footer className="flex items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-slate-950/60 px-5 py-4 text-sm text-slate-400 shadow-2xl shadow-black/20 backdrop-blur">
          <p>Preview snapshot: camera preview, artwork and duration controls.</p>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open settings"
            className="shrink-0 rounded-full border border-transparent bg-transparent px-0 py-0 text-sm font-medium text-slate-200 underline decoration-white/25 underline-offset-4 transition hover:text-amber-100 hover:decoration-amber-300/70"
          >
            Settings
          </button>
        </footer>
      </div>

      {isSettingsOpen ? (
        <SettingsDialog
          settingsTab={settingsTab}
          onClose={() => setIsSettingsOpen(false)}
          onChangeTab={setSettingsTab}
          onEnableCameraAccess={() => {
            void requestCameraAccess();
          }}
          onEnableAudioAccess={() => {
            void requestAudioAccess();
          }}
          onResetCameraFraming={resetCameraFraming}
          cameraDeviceOptions={cameraDeviceOptions}
          selectedCameraId={selectedCameraId}
          onCameraChange={setSelectedCameraId}
          cameraZoom={cameraZoom}
          onCameraZoomChange={setCameraZoom}
          cameraStatus={cameraStatus}
          cameraMessage={cameraMessage}
          cameraError={cameraError}
          cameraStateLabel={cameraStateLabel}
          activeCameraLabel={activeCameraLabel}
          cameraFeedSummary={cameraFeedSummary}
          settingsCameraPreviewVideoRef={settingsCameraPreviewVideoRef}
          audioDeviceOptions={audioDeviceOptions}
          selectedAudioDeviceId={selectedAudioDeviceId}
          onAudioChange={setSelectedAudioDeviceId}
          audioMessage={audioMessage}
          audioError={audioError}
          audioStateLabel={audioStateLabel}
          activeAudioLabel={activeAudioLabel}
          audioMeterLeftBarRef={audioMeterLeftBarRef}
          audioMeterLeftGreenRef={audioMeterLeftGreenRef}
          audioMeterLeftRedRef={audioMeterLeftRedRef}
          audioMeterRightBarRef={audioMeterRightBarRef}
          audioMeterRightGreenRef={audioMeterRightGreenRef}
          audioMeterRightRedRef={audioMeterRightRedRef}
          discogsStatusLabel={discogsStatusLabel}
          discogsUsername={discogsUsername}
          onDiscogsUsernameChange={setDiscogsUsername}
          discogsToken={discogsToken}
          onDiscogsTokenChange={setDiscogsToken}
        />
      ) : null}

      {isRecordingPreviewOpen && recordingPath ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 px-4 py-6 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close recording preview"
            className="absolute inset-0 cursor-default"
            onClick={closeRecordingPreview}
          />

          <div className="relative z-10 flex w-full max-w-5xl flex-col overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 shadow-2xl shadow-black/70">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Preview</p>
                <h2 className="mt-1 truncate font-['Space_Grotesk'] text-xl font-semibold text-white">
                  Recorded clip
                </h2>
              </div>

              <button
                type="button"
                onClick={closeRecordingPreview}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-slate-200 transition hover:border-amber-400/30 hover:bg-amber-400/10"
              >
                Close
              </button>
            </div>

            <div className="grid gap-0 lg:grid-cols-[minmax(0,auto)_340px]">
              <div className="flex items-center justify-center bg-black p-4">
                <div className="aspect-[9/16] h-[78vh] max-h-[78vh] w-auto overflow-hidden rounded-[24px] bg-black shadow-2xl shadow-black/50">
                  <video
                    ref={recordingPreviewVideoRef}
                    src={recordingPreviewSrc}
                    className="no-native-video-ui block h-full w-full bg-black object-contain"
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      setRecordingPreviewDuration(video.duration || 0);
                      setRecordingPreviewTime(video.currentTime || 0);
                    }}
                    onTimeUpdate={(event) => {
                      const video = event.currentTarget;
                      setRecordingPreviewTime(video.currentTime || 0);
                    }}
                  />
                </div>
              </div>

              <div className="border-t border-white/10 bg-slate-900/70 p-5 lg:border-l lg:border-t-0">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                      Saved clip
                    </p>
                    <p className="mt-2 truncate text-sm text-slate-100">{recordingPreviewFileName}</p>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 text-left">
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                          Playback
                        </p>
                        <p className="mt-1 text-sm text-slate-100">
                          {formatTimestamp(recordingPreviewTime)} / {formatTimestamp(recordingPreviewDuration)}
                        </p>
                      </div>

                      <div className="rounded-full border border-rose-300/25 bg-rose-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-rose-100">
                        Native controls enabled
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void invoke("open_containing_folder", { filePath: recordingPath });
                      }}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-slate-200 transition hover:border-amber-400/30 hover:bg-amber-400/10"
                    >
                      Open folder
                    </button>
                  </div>

                  <p className="text-sm leading-6 text-slate-300">{recordingNotice}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
