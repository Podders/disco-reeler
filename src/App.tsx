import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

type DurationChoice = 15 | 30 | 60 | 90;
type CameraStatus = "idle" | "loading" | "ready" | "no-device" | "error";
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

function cameraLabel(device: MediaDeviceInfo, index: number) {
  return device.label.trim() || `Camera ${index + 1}`;
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

      const commaIndex = reader.result.indexOf(",");
      resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
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
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraMessage, setCameraMessage] = useState(
    "Pick a webcam and the portrait preview will update here.",
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraRefreshTick, setCameraRefreshTick] = useState(0);
  const [cameraZoom, setCameraZoom] = useState(1.15);
  const [cameraPan, setCameraPan] = useState({ x: 0, y: 0 });
  const [isCameraViewportHovered, setIsCameraViewportHovered] = useState(false);
  const [cameraFeedSummary, setCameraFeedSummary] = useState("Awaiting camera details.");

  const [duration, setDuration] = useState<DurationChoice | null>(30);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [recordingCountdown, setRecordingCountdown] = useState<number | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [recordingNotice, setRecordingNotice] = useState(
    "Recording is ready once a webcam is active.",
  );
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [recordingFormat, setRecordingFormat] = useState<"mp4" | "webm">("mp4");
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
  const [outputPresetId, setOutputPresetId] = useState<OutputPresetId>("vertical");
  const discogsCacheLoadedForUserRef = useRef<string | null>(null);

  const activeCameraLabel = useMemo(() => {
    const match = cameraDevices.find((device) => device.deviceId === selectedCameraId);
    if (!match) {
      return "No camera selected";
    }

    const index = cameraDevices.indexOf(match);
    return cameraLabel(match, index);
  }, [cameraDevices, selectedCameraId]);

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
      setCameraRefreshTick((value) => value + 1);
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
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
          (device): device is MediaDeviceInfo => device.kind === "videoinput",
        );

        if (!active) {
          return;
        }

        setCameraDevices(devices);

        if (devices.length === 0) {
          setCameraStatus("no-device");
          setCameraMessage(
            "No webcam was detected. Connect one or enable permission, then refresh the list.",
          );
          setCameraFeedSummary("Camera details unavailable.");
          setSelectedCameraId("");
          return;
        }

        setCameraError(null);
        setCameraStatus((current) => (current === "error" ? "idle" : current));
        setSelectedCameraId((current) => {
          if (current && devices.some((device) => device.deviceId === current)) {
            return current;
          }

          return devices[0]?.deviceId ?? "";
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
      setCameraRefreshTick((value) => value + 1);
    };

    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);

    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [cameraRefreshTick]);

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
    let savedPath: string;

    try {
      setRecordingNotice("Encoding with FFmpeg...");
      savedPath = await invoke<string>("encode_recording_with_ffmpeg", {
        fileName: `${makeRecordingFileName()}.mp4`,
        base64Data,
        artworkDataUrl: artworkUrl,
        durationSeconds,
        outputWidth,
        outputHeight,
      });
      setRecordingFormat("mp4");
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : error && typeof error === "object" && "message" in error
              ? String((error as { message?: unknown }).message ?? "FFmpeg export failed.")
              : "FFmpeg export failed.";

      setRecordingNotice(`${message} Saving the browser recording instead.`);
      savedPath = await invoke<string>("save_recording_file", {
        fileName: `${makeRecordingFileName()}.${recordingFormat}`,
        base64Data,
      });
    }

    try {
      const previewBase64 = await invoke<string>("read_file_base64", {
        filePath: savedPath,
      });
      const previewBlob = base64ToBlob(previewBase64, "video/mp4");
      const previewUrl = URL.createObjectURL(previewBlob);

      setRecordingPreviewUrl((current) => {
        if (current && current.startsWith("blob:")) {
          URL.revokeObjectURL(current);
        }

        return previewUrl;
      });
    } catch {
      setRecordingPreviewUrl(convertFileSrc(savedPath));
    }

    setRecordingPath(savedPath);
    setRecordingNotice("Recording saved successfully.");
    setRecordingStatus("saved");
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
      { mime: "video/mp4;codecs=avc1.42E01E", format: "mp4" },
      { mime: "video/mp4", format: "mp4" },
      { mime: "video/webm;codecs=vp9", format: "webm" },
      { mime: "video/webm;codecs=vp8", format: "webm" },
      { mime: "video/webm", format: "webm" },
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

    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(sourceStream, {
        mimeType: selectedMime.mime,
        videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
      });
    } catch (error) {
      setRecordingStatus("error");
      setRecordingNotice(
        error instanceof Error ? error.message : "This runtime could not create a recorder.",
      );
      return;
    }

    mediaRecorderRef.current = recorder;
    recordingCaptureStreamRef.current = sourceStream;
    setRecordingFormat(selectedMime.format);
    setRecordingPath(null);
    setRecordingStatus("recording");
    startRecordingElapsedTimer();
    setRecordingNotice(
      selectedMime.format === "mp4"
        ? "Recording as MP4..."
        : "MP4 is unavailable here, recording as WebM instead...",
    );

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      clearRecordingTimers();
      clearRecordingElapsed();
      recordingCaptureStreamRef.current = null;
      setRecordingStatus("error");
      setRecordingNotice("The recorder encountered an error.");
    };

    recorder.onstop = async () => {
      const recordedDurationSeconds = recordingStartedAtRef.current
        ? Math.max((performance.now() - recordingStartedAtRef.current) / 1000, 0.1)
        : Math.max(recordingElapsedSeconds, 0.1);

      clearRecordingTimers();
      recordingCaptureStreamRef.current = null;
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
        setRecordingNotice(
          error instanceof Error ? error.message : "Failed to save the recording.",
        );
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

      <button
        type="button"
        onClick={() => setIsSettingsOpen(true)}
        aria-label="Open settings"
        className="fixed right-3 top-3 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-950/70 text-slate-200 shadow-2xl shadow-black/30 backdrop-blur transition hover:border-amber-400/30 hover:bg-amber-400/10"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3.25" />
          <path d="M19.4 15a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 0 1 0 2.55l-.7.7a1.8 1.8 0 0 1-2.55 0l-.05-.05A1.5 1.5 0 0 0 15 19.4a1.5 1.5 0 0 0-1 .95V21a1.8 1.8 0 0 1-1.8 1.8h-1.4A1.8 1.8 0 0 1 9 21v-.65a1.5 1.5 0 0 0-1-.95 1.5 1.5 0 0 0-1.65.3l-.05.05a1.8 1.8 0 0 1-2.55 0l-.7-.7a1.8 1.8 0 0 1 0-2.55l.05-.05a1.5 1.5 0 0 0 .3-1.65A1.5 1.5 0 0 0 1.6 14H1a1.8 1.8 0 0 1-1.8-1.8v-1.4A1.8 1.8 0 0 1 1 9h.6a1.5 1.5 0 0 0 .95-1 1.5 1.5 0 0 0-.3-1.65l-.05-.05a1.8 1.8 0 0 1 0-2.55l.7-.7a1.8 1.8 0 0 1 2.55 0l.05.05A1.5 1.5 0 0 0 6.6 3.6 1.5 1.5 0 0 0 7.55 2.65V2A1.8 1.8 0 0 1 9.35.2h1.3A1.8 1.8 0 0 1 12.45 2v.65a1.5 1.5 0 0 0 .95.95 1.5 1.5 0 0 0 1.65-.3l.05-.05a1.8 1.8 0 0 1 2.55 0l.7.7a1.8 1.8 0 0 1 0 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65 1.5 1.5 0 0 0 .95 1H23a1.8 1.8 0 0 1 1.8 1.8v1.4A1.8 1.8 0 0 1 23 14h-.65a1.5 1.5 0 0 0-.95 1Z" />
        </svg>
      </button>

      <div className="relative mx-auto flex h-[calc(100dvh-1rem)] max-w-[1680px] flex-col gap-3 overflow-hidden">

        <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_400px]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/65 p-3 shadow-2xl shadow-black/30 backdrop-blur">
            <div className="mb-3 flex items-start justify-between gap-3 px-0.5">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                  Portrait Preview
                </p>
              </div>
              <label className="flex flex-col items-end gap-1">
                <select
                  value={outputPresetId}
                  onChange={(event) => setOutputPresetId(event.target.value as OutputPresetId)}
                  className="rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-200 outline-none transition focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
                >
                  {OUTPUT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
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

                <section className="mt-2 shrink-0 rounded-[28px] border border-white/10 bg-slate-950/85 px-4 py-4 shadow-2xl shadow-black/40 backdrop-blur">
                  <div className="flex flex-col items-center gap-3">
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
            <section className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/10 bg-slate-950/75 p-3 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Discogs</p>
                  <h3 className="mt-1 font-['Space_Grotesk'] text-lg font-semibold text-white">
                    Browse collection
                  </h3>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-slate-300">
                  {discogsStatusLabel}
                </div>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    void loadDiscogsCollection();
                  }}
                  disabled={discogsStatus === "loading"}
                  className="w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-50 transition hover:border-amber-300/50 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {discogsStatus === "loading"
                    ? "Loading Discogs collection..."
                    : "Connect and load"}
                </button>

                {discogsStatus === "loading" ? (
                  <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3">
                    <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.28em] text-slate-500">
                      <span>
                        {discogsProgress?.status === "starting" ? "Connecting" : "Loading pages"}
                      </span>
                      <span>
                        {discogsProgress?.page ?? 0}
                        {discogsProgress?.pages ? ` / ${discogsProgress.pages}` : " / ?"} pages
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-300 to-amber-200 transition-[width] duration-300"
                        style={{ width: `${discogsProgressPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                      <span>{discogsProgress?.loaded_releases ?? 0} releases loaded</span>
                      <span>
                        {discogsProgress?.total_releases
                          ? `${discogsProgress.total_releases} total`
                          : "Counting collection"}
                      </span>
                    </div>
                  </div>
                ) : null}

                <p className="text-sm leading-6 text-slate-300">{discogsNotice}</p>
                {discogsError ? <p className="text-sm text-rose-300">{discogsError}</p> : null}
              </div>

              <div className="mt-3 flex min-h-0 flex-1 flex-col space-y-2.5 rounded-2xl border border-white/10 bg-white/5 p-2.5">
                <label className="block space-y-2">
                  <span className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                    Search collection
                  </span>
                  <input
                    type="search"
                    value={discogsFilter}
                    onChange={(event) => setDiscogsFilter(event.target.value)}
                    placeholder="Filter by artist, title, year or label"
                    className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
                  />
                </label>

                <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.28em] text-slate-500">
                  <span>{filteredDiscogsReleases.length} visible</span>
                  <span>{discogsReleases.length} total</span>
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {filteredDiscogsReleases.length > 0 ? (
                    filteredDiscogsReleases.map((release) => {
                      const selected = release.instance_id === selectedDiscogsReleaseId;
                      const artwork = release.cover_image ?? release.thumb;

                      return (
                        <button
                          key={release.instance_id}
                          type="button"
                          onClick={() => {
                            void useDiscogsArtwork(release);
                          }}
                          className={[
                            "flex w-full items-center gap-3 rounded-2xl border p-2 text-left transition",
                            selected
                              ? "border-amber-400/45 bg-amber-400/12"
                              : "border-white/10 bg-slate-900/80 hover:border-amber-400/30 hover:bg-amber-400/10",
                          ].join(" ")}
                        >
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-800">
                            {artwork ? (
                              <img src={artwork} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-white">
                              {release.artist}
                            </div>
                            <div className="truncate text-sm text-slate-300">{release.title}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                              {release.year ? <span>{release.year}</span> : null}
                              {release.label ? <span>{release.label}</span> : null}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/70 px-4 py-6 text-sm text-slate-400">
                      {discogsStatus === "ready"
                        ? "No collection releases match this filter."
                        : "Load your Discogs collection to see releases here."}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </aside>
        </section>

        <canvas
          ref={recordingCanvasRef}
          className="hidden"
          width={outputWidth}
          height={outputHeight}
        />

        <footer className="rounded-[24px] border border-white/10 bg-slate-950/60 px-5 py-4 text-sm text-slate-400 shadow-2xl shadow-black/20 backdrop-blur">
          <p>Preview snapshot: camera preview, artwork and duration controls.</p>
        </footer>
      </div>

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close settings"
            className="absolute inset-0 cursor-default"
            onClick={() => setIsSettingsOpen(false)}
          />

          <div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Settings</p>
                <h2 className="mt-1 font-['Space_Grotesk'] text-xl font-semibold text-white">
                  Camera and Discogs
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-slate-200 transition hover:border-amber-400/30 hover:bg-amber-400/10"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 p-5 lg:grid-cols-2">
              <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Camera</p>
                    <h3 className="mt-1 font-['Space_Grotesk'] text-lg font-semibold text-white">
                      Webcam selection
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void requestCameraAccess();
                    }}
                    className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-400/15"
                  >
                    Enable access
                  </button>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">Connected webcam</span>
                  <select
                    value={selectedCameraId}
                    onChange={(event) => setSelectedCameraId(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
                  >
                    {cameraDevices.length > 0 ? (
                      cameraDevices.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {cameraLabel(device, index)}
                        </option>
                      ))
                    ) : (
                      <option value="">No cameras detected</option>
                    )}
                  </select>
                </label>

                <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                        Zoom
                      </p>
                      <p className="mt-1 text-sm text-slate-100">{cameraZoom.toFixed(2)}x</p>
                    </div>
                    <button
                      type="button"
                      onClick={resetCameraFraming}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-amber-400/30 hover:bg-amber-400/10"
                    >
                      Reset framing
                    </button>
                  </div>

                  <input
                    type="range"
                    min="1"
                    max="2.2"
                    step="0.01"
                    value={cameraZoom}
                    onChange={(event) => setCameraZoom(Number(event.target.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-amber-400"
                  />
                  <div className="flex items-center justify-between text-xs leading-5 text-slate-400">
                    <span>Zoom in/out before panning.</span>
                    <span>{cameraZoom.toFixed(2)}x</span>
                  </div>
                  <p className="text-xs leading-5 text-slate-400">
                    Drag the live camera preview to place the deck where you want it inside the
                    frame.
                  </p>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                      Status
                    </p>
                    <p className="mt-2 text-sm text-slate-100">{cameraStateLabel}</p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                      Active device
                    </p>
                    <p className="mt-2 truncate text-sm text-slate-100">{activeCameraLabel}</p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                      Negotiated feed
                    </p>
                    <p className="mt-2 text-sm text-slate-100">{cameraFeedSummary}</p>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-6 text-slate-300">{cameraMessage}</p>
                {cameraError ? <p className="mt-2 text-sm text-rose-300">{cameraError}</p> : null}
              </section>

              <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Discogs</p>
                    <h3 className="mt-1 font-['Space_Grotesk'] text-lg font-semibold text-white">
                      Username and token
                    </h3>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-slate-300">
                    {discogsStatusLabel}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-200">Discogs username</span>
                    <input
                      type="text"
                      value={discogsUsername}
                      onChange={(event) => setDiscogsUsername(event.target.value)}
                      placeholder="your-discogs-handle"
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-200">Personal access token</span>
                    <input
                      type="password"
                      value={discogsToken}
                      onChange={(event) => setDiscogsToken(event.target.value)}
                      placeholder="Discogs token"
                      className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
                    />
                  </label>

                  <p className="text-sm leading-6 text-slate-300">
                    Credentials are stored locally on this device. Use the sidebar to load and
                    browse your collection.
                  </p>
                </div>
              </section>
            </div>
          </div>
        </div>
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
                    className="block h-full w-full bg-black object-contain"
                    controls
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
