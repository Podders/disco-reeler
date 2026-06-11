import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";

export type DropdownItem = {
  value: string;
  label: string;
  description?: string;
};

export function DropdownListbox({
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
