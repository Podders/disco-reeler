import type { RefObject } from "react";

import { DropdownListbox, type DropdownItem } from "../DropdownListbox";

export function AudioSettingsTab({
  onEnableAudioAccess,
  audioDeviceOptions,
  selectedAudioDeviceId,
  onAudioChange,
  audioStateLabel,
  activeAudioLabel,
  audioMessage,
  audioError,
  audioMeterLeftBarRef,
  audioMeterLeftGreenRef,
  audioMeterLeftRedRef,
  audioMeterRightBarRef,
  audioMeterRightGreenRef,
  audioMeterRightRedRef,
}: {
  onEnableAudioAccess: () => void;
  audioDeviceOptions: DropdownItem[];
  selectedAudioDeviceId: string;
  onAudioChange: (value: string) => void;
  audioStateLabel: string;
  activeAudioLabel: string;
  audioMessage: string;
  audioError: string | null;
  audioMeterLeftBarRef: RefObject<HTMLDivElement | null>;
  audioMeterLeftGreenRef: RefObject<HTMLDivElement | null>;
  audioMeterLeftRedRef: RefObject<HTMLDivElement | null>;
  audioMeterRightBarRef: RefObject<HTMLDivElement | null>;
  audioMeterRightGreenRef: RefObject<HTMLDivElement | null>;
  audioMeterRightRedRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Audio</p>
          <h3 className="mt-1 font-['Space_Grotesk'] text-lg font-semibold text-white">
            Microphone selection
          </h3>
        </div>
        <button
          type="button"
          onClick={onEnableAudioAccess}
          className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-400/15"
        >
          Enable access
        </button>
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-200">Connected microphone</span>
        <DropdownListbox
          items={audioDeviceOptions}
          value={selectedAudioDeviceId}
          onChange={onAudioChange}
          placeholder="Choose a microphone"
          className="w-full"
        />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Status</p>
          <p className="mt-2 text-sm text-slate-100">{audioStateLabel}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Active device</p>
          <p className="mt-2 truncate text-sm text-slate-100">{activeAudioLabel}</p>
        </div>
      </div>

      <div className="mt-4 rounded-[24px] border border-white/10 bg-black/35 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.32em] text-slate-500">VU meter</p>
        </div>

        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-[auto_1fr] items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">L</span>
            <div className="relative h-4 overflow-hidden rounded-full bg-slate-800">
              <div
                ref={audioMeterLeftBarRef}
                className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full"
              >
                <div ref={audioMeterLeftGreenRef} className="h-full shrink-0 rounded-full" />
                <div ref={audioMeterLeftRedRef} className="h-full shrink-0 rounded-full" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[auto_1fr] items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">R</span>
            <div className="relative h-4 overflow-hidden rounded-full bg-slate-800">
              <div
                ref={audioMeterRightBarRef}
                className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full"
              >
                <div ref={audioMeterRightGreenRef} className="h-full shrink-0 rounded-full" />
                <div ref={audioMeterRightRedRef} className="h-full shrink-0 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        <p className="mt-2 text-xs leading-5 text-slate-400">
          Play something or speak into the selected microphone to confirm the input.
        </p>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">{audioMessage}</p>
      {audioError ? <p className="mt-2 text-sm text-rose-300">{audioError}</p> : null}
    </section>
  );
}
