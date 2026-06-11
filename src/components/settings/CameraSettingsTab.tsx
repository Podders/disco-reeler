import type { RefObject } from "react";

import { DropdownListbox, type DropdownItem } from "../DropdownListbox";
import type { CameraStatus } from "../../appTypes";

export function CameraSettingsTab({
  onEnableCameraAccess,
  onResetCameraFraming,
  cameraDeviceOptions,
  selectedCameraId,
  onCameraChange,
  cameraZoom,
  onCameraZoomChange,
  cameraStatus,
  cameraMessage,
  cameraError,
  cameraStateLabel,
  activeCameraLabel,
  cameraFeedSummary,
  settingsCameraPreviewVideoRef,
}: {
  onEnableCameraAccess: () => void;
  onResetCameraFraming: () => void;
  cameraDeviceOptions: DropdownItem[];
  selectedCameraId: string;
  onCameraChange: (value: string) => void;
  cameraZoom: number;
  onCameraZoomChange: (value: number) => void;
  cameraStatus: CameraStatus;
  cameraMessage: string;
  cameraError: string | null;
  cameraStateLabel: string;
  activeCameraLabel: string;
  cameraFeedSummary: string;
  settingsCameraPreviewVideoRef: RefObject<HTMLVideoElement | null>;
}) {
  return (
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
          onClick={onEnableCameraAccess}
          className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-400/15"
        >
          Enable access
        </button>
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-200">Connected webcam</span>
        <DropdownListbox
          items={
            cameraDeviceOptions.length > 0
              ? cameraDeviceOptions
              : [{ value: "", label: "No cameras detected" }]
          }
          value={selectedCameraId}
          onChange={onCameraChange}
          placeholder="Choose a camera"
          className="w-full"
        />
      </label>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px]">
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Zoom</p>
              <p className="mt-1 text-sm text-slate-100">{cameraZoom.toFixed(2)}x</p>
            </div>
            <button
              type="button"
              onClick={onResetCameraFraming}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-amber-400/30 hover:bg-amber-400/10"
            >
              Reset
            </button>
          </div>

          <input
            type="range"
            min="1"
            max="2.2"
            step="0.01"
            value={cameraZoom}
            onChange={(event) => onCameraZoomChange(Number(event.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-amber-400"
          />
          <div className="flex items-center justify-between text-xs leading-5 text-slate-400">
            <span>Zoom in/out before panning.</span>
            <span>{cameraZoom.toFixed(2)}x</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-[16px] border border-white/10 bg-black shadow-lg shadow-black/25">
          <div className="relative aspect-[4/3] bg-slate-950">
            <video
              ref={settingsCameraPreviewVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            {cameraStatus === "ready" ? (
              <div className="absolute left-2 top-2 rounded-full border border-black/25 bg-black/40 px-2 py-0.5 text-[8px] uppercase tracking-[0.18em] text-white/90 backdrop-blur">
                Cam
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
                <div className="max-w-[9rem] space-y-1">
                  <p className="text-[11px] leading-4 text-slate-200">{cameraMessage}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 text-xs leading-5 text-slate-400">
        Drag the live camera preview to place the deck where you want it inside the frame.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Status</p>
          <p className="mt-2 text-sm text-slate-100">{cameraStateLabel}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Active device</p>
          <p className="mt-2 truncate text-sm text-slate-100">{activeCameraLabel}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Negotiated feed</p>
          <p className="mt-2 text-sm text-slate-100">{cameraFeedSummary}</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">{cameraMessage}</p>
      {cameraError ? <p className="mt-2 text-sm text-rose-300">{cameraError}</p> : null}
    </section>
  );
}
