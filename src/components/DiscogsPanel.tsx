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

type DiscogsStatus = "idle" | "loading" | "ready" | "error";

export function DiscogsPanel({
  status,
  statusLabel,
  progress,
  progressPercent,
  notice,
  error,
  filter,
  onFilterChange,
  visibleCount,
  totalCount,
  releases,
  selectedReleaseId,
  onLoad,
  onSelectRelease,
}: {
  status: DiscogsStatus;
  statusLabel: string;
  progress: DiscogsCollectionProgress | null;
  progressPercent: number;
  notice: string;
  error: string | null;
  filter: string;
  onFilterChange: (value: string) => void;
  visibleCount: number;
  totalCount: number;
  releases: DiscogsCollectionRelease[];
  selectedReleaseId: number | null;
  onLoad: () => void;
  onSelectRelease: (release: DiscogsCollectionRelease) => void;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/10 bg-slate-950/75 p-3 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Discogs</p>
          <h3 className="mt-1 font-['Space_Grotesk'] text-lg font-semibold text-white">
            Browse collection
          </h3>
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-slate-300">
          {statusLabel}
        </div>
      </div>

      <div className="space-y-2.5">
        <button
          type="button"
          onClick={onLoad}
          disabled={status === "loading"}
          className="w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-50 transition hover:border-amber-300/50 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "loading" ? "Loading Discogs collection..." : "Connect and load"}
        </button>

        {status === "loading" ? (
          <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.28em] text-slate-500">
              <span>{progress?.status === "starting" ? "Connecting" : "Loading pages"}</span>
              <span>
                {progress?.page ?? 0}
                {progress?.pages ? ` / ${progress.pages}` : " / ?"} pages
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-300 to-amber-200 transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
              <span>{progress?.loaded_releases ?? 0} releases loaded</span>
              <span>
                {progress?.total_releases ? `${progress.total_releases} total` : "Counting collection"}
              </span>
            </div>
          </div>
        ) : null}

        <p className="text-sm leading-6 text-slate-300">{notice}</p>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col space-y-2.5 rounded-2xl border border-white/10 bg-white/5 p-2.5">
        <label className="block space-y-2">
          <span className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
            Search collection
          </span>
          <input
            type="search"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Filter by artist, title, year or label"
            className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
          />
        </label>

        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.28em] text-slate-500">
          <span>{visibleCount} visible</span>
          <span>{totalCount} total</span>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {releases.length > 0 ? (
            releases.map((release) => {
              const selected = release.instance_id === selectedReleaseId;
              const artwork = release.cover_image ?? release.thumb;

              return (
                <button
                  key={release.instance_id}
                  type="button"
                  onClick={() => onSelectRelease(release)}
                  className={[
                    "flex w-full items-center gap-3 rounded-2xl border p-2 text-left transition",
                    selected
                      ? "border-amber-400/45 bg-amber-400/12"
                      : "border-white/10 bg-slate-900/80 hover:border-amber-400/30 hover:bg-amber-400/10",
                  ].join(" ")}
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-800">
                    {artwork ? <img src={artwork} alt="" className="h-full w-full object-cover" /> : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{release.artist}</div>
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
              {status === "ready"
                ? "No collection releases match this filter."
                : "Load your Discogs collection to see releases here."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
