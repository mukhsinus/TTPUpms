import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

export interface SearchAutocompleteSuggestion {
  id: string;
  value: string;
  label: string;
  meta?: string | null;
  kind?: string;
}

interface SearchAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: SearchAutocompleteSuggestion) => void;
  fetchSuggestions: (query: string) => Promise<SearchAutocompleteSuggestion[]>;
  placeholder?: string;
  ariaLabel?: string;
  debounceMs?: number;
  className?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlighted(text: string, query: string): ReactElement {
  const q = query.trim();
  if (!q) {
    return <>{text}</>;
  }
  const regex = new RegExp(`(${escapeRegExp(q)})`, "ig");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={`${part}-${index}`} className="search-autocomplete-mark">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

export function SearchAutocomplete({
  value,
  onChange,
  onSelect,
  fetchSuggestions,
  placeholder,
  ariaLabel,
  debounceMs = 250,
  className,
}: SearchAutocompleteProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SearchAutocompleteSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const trimmed = value.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const run = async (): Promise<void> => {
        const runId = requestSeq.current + 1;
        requestSeq.current = runId;
        if (!trimmed) {
          setItems([]);
          setLoading(false);
          setOpen(false);
          setActiveIndex(-1);
          return;
        }
        setLoading(true);
        try {
          const next = await fetchSuggestions(trimmed);
          if (requestSeq.current !== runId) {
            return;
          }
          setItems(next);
          setOpen(true);
          setActiveIndex(next.length > 0 ? 0 : -1);
        } catch {
          if (requestSeq.current !== runId) {
            return;
          }
          setItems([]);
          setOpen(true);
          setActiveIndex(-1);
        } finally {
          if (requestSeq.current !== runId) {
            return;
          }
          setLoading(false);
        }
      };
      void run();
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [trimmed, debounceMs, fetchSuggestions]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent): void => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const emptyStateVisible = useMemo(
    () => open && !loading && trimmed.length > 0 && items.length === 0,
    [open, loading, trimmed.length, items.length],
  );

  const handleSelect = (item: SearchAutocompleteSuggestion): void => {
    onChange(item.value);
    onSelect(item);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!open) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => {
        if (items.length === 0) return -1;
        return Math.min(prev + 1, items.length - 1);
      });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault();
        handleSelect(items[activeIndex] as SearchAutocompleteSuggestion);
      }
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`search-autocomplete ${className ?? ""}`.trim()}>
      <input
        className="ui-input"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (trimmed.length > 0) {
            setOpen(true);
          }
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
      />

      <div className={`search-autocomplete-dropdown ${open ? "open" : ""}`} role="listbox">
        {loading ? <div className="search-autocomplete-empty">Loading...</div> : null}
        {emptyStateVisible ? <div className="search-autocomplete-empty">No matches found</div> : null}
        {!loading && items.length > 0
          ? items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`search-autocomplete-item ${index === activeIndex ? "active" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelect(item);
                }}
              >
                <span className="search-autocomplete-item-main">{renderHighlighted(item.label, trimmed)}</span>
                {item.meta ? (
                  <span className="search-autocomplete-item-meta">{renderHighlighted(item.meta, trimmed)}</span>
                ) : null}
              </button>
            ))
          : null}
      </div>
    </div>
  );
}
