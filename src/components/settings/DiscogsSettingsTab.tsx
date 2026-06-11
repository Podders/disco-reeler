export function DiscogsSettingsTab({
  discogsStatusLabel,
  discogsUsername,
  onDiscogsUsernameChange,
  discogsToken,
  onDiscogsTokenChange,
}: {
  discogsStatusLabel: string;
  discogsUsername: string;
  onDiscogsUsernameChange: (value: string) => void;
  discogsToken: string;
  onDiscogsTokenChange: (value: string) => void;
}) {
  return (
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
            onChange={(event) => onDiscogsUsernameChange(event.target.value)}
            placeholder="your-discogs-handle"
            className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-200">Personal access token</span>
          <input
            type="password"
            value={discogsToken}
            onChange={(event) => onDiscogsTokenChange(event.target.value)}
            placeholder="Discogs token"
            className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
          />
        </label>

        <p className="text-sm leading-6 text-slate-300">
          Credentials are stored locally on this device. Use the sidebar to load and browse your
          collection.
        </p>
      </div>
    </section>
  );
}
