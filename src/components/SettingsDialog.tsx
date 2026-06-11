import type { RefObject } from "react";

import type { CameraStatus } from "../appTypes";
import { CameraSettingsTab } from "./settings/CameraSettingsTab";
import { AudioSettingsTab } from "./settings/AudioSettingsTab";
import { DiscogsSettingsTab } from "./settings/DiscogsSettingsTab";
import type { DropdownItem } from "./DropdownListbox";

export function SettingsDialog({
  settingsTab,
  onClose,
  onChangeTab,
  onEnableCameraAccess,
  onEnableAudioAccess,
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
  audioDeviceOptions,
  selectedAudioDeviceId,
  onAudioChange,
  audioMessage,
  audioError,
  audioStateLabel,
  activeAudioLabel,
  audioMeterLeftBarRef,
  audioMeterLeftGreenRef,
  audioMeterLeftRedRef,
  audioMeterRightBarRef,
  audioMeterRightGreenRef,
  audioMeterRightRedRef,
  discogsStatusLabel,
  discogsUsername,
  onDiscogsUsernameChange,
  discogsToken,
  onDiscogsTokenChange,
}: {
  settingsTab: "camera" | "audio" | "discogs";
  onClose: () => void;
  onChangeTab: (tab: "camera" | "audio" | "discogs") => void;
  onEnableCameraAccess: () => void;
  onEnableAudioAccess: () => void;
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
  audioDeviceOptions: DropdownItem[];
  selectedAudioDeviceId: string;
  onAudioChange: (value: string) => void;
  audioMessage: string;
  audioError: string | null;
  audioStateLabel: string;
  activeAudioLabel: string;
  audioMeterLeftBarRef: RefObject<HTMLDivElement | null>;
  audioMeterLeftGreenRef: RefObject<HTMLDivElement | null>;
  audioMeterLeftRedRef: RefObject<HTMLDivElement | null>;
  audioMeterRightBarRef: RefObject<HTMLDivElement | null>;
  audioMeterRightGreenRef: RefObject<HTMLDivElement | null>;
  audioMeterRightRedRef: RefObject<HTMLDivElement | null>;
  discogsStatusLabel: string;
  discogsUsername: string;
  onDiscogsUsernameChange: (value: string) => void;
  discogsToken: string;
  onDiscogsTokenChange: (value: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close settings"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Settings</p>
            <h2 className="mt-1 font-['Space_Grotesk'] text-xl font-semibold text-white">
              Camera, audio and Discogs
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-slate-200 transition hover:border-amber-400/30 hover:bg-amber-400/10"
          >
            Close
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-white/10 px-5 pt-4">
          {(
            [
              ["camera", "Camera"],
              ["audio", "Audio"],
              ["discogs", "Discogs"],
            ] as const
          ).map(([tab, label]) => {
            const selected = settingsTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onChangeTab(tab)}
                className={[
                  "rounded-t-2xl border border-b-0 px-4 py-3 text-xs font-medium uppercase tracking-[0.22em] transition",
                  selected
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-50"
                    : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-200",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="p-5">
          {settingsTab === "camera" ? (
            <CameraSettingsTab
              onEnableCameraAccess={onEnableCameraAccess}
              onResetCameraFraming={onResetCameraFraming}
              cameraDeviceOptions={cameraDeviceOptions}
              selectedCameraId={selectedCameraId}
              onCameraChange={onCameraChange}
              cameraZoom={cameraZoom}
              onCameraZoomChange={onCameraZoomChange}
              cameraStatus={cameraStatus}
              cameraMessage={cameraMessage}
              cameraError={cameraError}
              cameraStateLabel={cameraStateLabel}
              activeCameraLabel={activeCameraLabel}
              cameraFeedSummary={cameraFeedSummary}
              settingsCameraPreviewVideoRef={settingsCameraPreviewVideoRef}
            />
          ) : null}

          {settingsTab === "audio" ? (
            <AudioSettingsTab
              onEnableAudioAccess={onEnableAudioAccess}
              audioDeviceOptions={audioDeviceOptions}
              selectedAudioDeviceId={selectedAudioDeviceId}
              onAudioChange={onAudioChange}
              audioStateLabel={audioStateLabel}
              activeAudioLabel={activeAudioLabel}
              audioMessage={audioMessage}
              audioError={audioError}
              audioMeterLeftBarRef={audioMeterLeftBarRef}
              audioMeterLeftGreenRef={audioMeterLeftGreenRef}
              audioMeterLeftRedRef={audioMeterLeftRedRef}
              audioMeterRightBarRef={audioMeterRightBarRef}
              audioMeterRightGreenRef={audioMeterRightGreenRef}
              audioMeterRightRedRef={audioMeterRightRedRef}
            />
          ) : null}

          {settingsTab === "discogs" ? (
            <DiscogsSettingsTab
              discogsStatusLabel={discogsStatusLabel}
              discogsUsername={discogsUsername}
              onDiscogsUsernameChange={onDiscogsUsernameChange}
              discogsToken={discogsToken}
              onDiscogsTokenChange={onDiscogsTokenChange}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
