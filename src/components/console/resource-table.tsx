"use client";

import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

import { Icon } from "@/components/delivery/icons";
import { Container } from "@/components/delivery/manager-home-view";
import { type MenuItem, Popover } from "./menu";
import { StateBlock } from "./states";
import "./resource-table.css";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Present = the column is sortable by this value. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "right";
  nowrap?: boolean;
};

export type TableFilter<T> = {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  test: (row: T, value: string) => boolean;
};

export type RowAction<T> = {
  id: string;
  label: string;
  href?: (row: T) => string;
  onSelect?: (row: T) => void;
  disabled?: (row: T) => boolean;
};

export type BulkAction<T> = {
  id: string;
  label: string;
  onRun: (rows: T[]) => void;
  disabled?: (rows: T[]) => boolean;
};

type SortState = { column: string; dir: "asc" | "desc" } | null;
type View = {
  q: string;
  sort: SortState;
  page: number;
  size: number;
  filters: Record<string, string>;
};

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const SIZES = [10, 25, 50];

/** Search, filters, sort and page live in the URL (and session) so a visit
 * to a record and back, or a reload, returns to the same view. */
function readView(
  tableId: string,
  filterIds: string[],
  fallback: SortState,
): View {
  const base: View = { q: "", sort: fallback, page: 1, size: 10, filters: {} };
  try {
    let params = new URLSearchParams(window.location.search);
    const keys = [
      "q",
      "sort",
      "dir",
      "page",
      "size",
      ...filterIds.map((f) => `f.${f}`),
    ];
    if (!keys.some((k) => params.has(k))) {
      params = new URLSearchParams(
        sessionStorage.getItem(`oern.table.${tableId}`) ?? "",
      );
    }
    base.q = params.get("q") ?? "";
    const sort = params.get("sort");
    if (sort)
      base.sort = {
        column: sort,
        dir: params.get("dir") === "desc" ? "desc" : "asc",
      };
    base.page = Math.max(1, Number(params.get("page")) || 1);
    const size = Number(params.get("size"));
    if (SIZES.includes(size)) base.size = size;
    for (const id of filterIds) {
      const value = params.get(`f.${id}`);
      if (value) base.filters[id] = value;
    }
  } catch {
    /* Storage can be blocked; defaults are fine. */
  }
  return base;
}

function writeView(tableId: string, view: View) {
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  if (view.sort) {
    params.set("sort", view.sort.column);
    params.set("dir", view.sort.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.size !== 10) params.set("size", String(view.size));
  for (const [id, value] of Object.entries(view.filters))
    if (value) params.set(`f.${id}`, value);
  const query = params.toString();
  try {
    sessionStorage.setItem(`oern.table.${tableId}`, query);
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* Not critical. */
  }
}

/** Sort direction as a small drawn marker: up, down, or both when unsorted. */
function SortMark({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg
      className="rt-sortmark"
      width="10"
      height="12"
      viewBox="0 0 10 12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 1 8.5 5h-7Z"
        fill="currentColor"
        opacity={dir === "desc" ? 0.25 : 1}
      />
      <path
        d="M5 11 1.5 7h7Z"
        fill="currentColor"
        opacity={dir === "asc" ? 0.25 : 1}
      />
    </svg>
  );
}

export function ResourceTable<T>({
  tableId,
  title,
  description,
  items,
  rowId,
  columns,
  searchText,
  searchLabel = "Search",
  filters = [],
  rowActions,
  bulkActions,
  headerActions,
  state = "ready",
  error,
  onRetry,
  empty,
  defaultSort = null,
}: {
  tableId: string;
  title: string;
  description?: string;
  items: T[];
  rowId: (row: T) => string;
  columns: Column<T>[];
  searchText: (row: T) => string;
  searchLabel?: string;
  filters?: TableFilter<T>[];
  rowActions?: RowAction<T>[];
  bulkActions?: BulkAction<T>[];
  headerActions?: ReactNode;
  state?: "ready" | "loading" | "error";
  error?: string;
  onRetry?: () => void;
  empty: { title: string; body: string; action?: ReactNode };
  defaultSort?: SortState;
}) {
  const uid = useId();
  const filterKey = filters.map((f) => f.id).join(",");
  const [view, setView] = useState<View>({
    q: "",
    sort: defaultSort,
    page: 1,
    size: 10,
    filters: {},
  });
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setView(
      readView(tableId, filterKey ? filterKey.split(",") : [], defaultSort),
    );
    setReady(true);
    // Restore once per table; the default sort is a constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, filterKey]);
  useEffect(() => {
    if (ready) writeView(tableId, view);
  }, [ready, tableId, view]);

  const update = (patch: Partial<View>) =>
    setView((v) => ({ ...v, page: 1, ...patch }));

  const visible = useMemo(() => {
    const q = view.q.trim().toLowerCase();
    let rows = items.filter((row) => {
      if (q && !searchText(row).toLowerCase().includes(q)) return false;
      return filters.every((f) => {
        const value = view.filters[f.id];
        return !value || f.test(row, value);
      });
    });
    const column = columns.find((c) => c.id === view.sort?.column);
    if (column?.sortValue && view.sort) {
      const get = column.sortValue;
      const sign = view.sort.dir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (
          (typeof x === "number" && typeof y === "number"
            ? x - y
            : collator.compare(String(x), String(y))) * sign
        );
      });
    }
    return rows;
  }, [items, view, columns, filters, searchText]);

  const pages = Math.max(1, Math.ceil(visible.length / view.size));
  const page = Math.min(view.page, pages);
  const start = (page - 1) * view.size;
  const rows = visible.slice(start, start + view.size);
  const selectedRows = items.filter((row) => selected.has(rowId(row)));
  const allOnPage =
    rows.length > 0 && rows.every((r) => selected.has(rowId(r)));
  const filtered = Boolean(view.q) || Object.values(view.filters).some(Boolean);
  const selectable = Boolean(bulkActions?.length);

  const toggleSort = (id: string) =>
    setView((v) => ({
      ...v,
      sort:
        v.sort?.column !== id
          ? { column: id, dir: "asc" }
          : v.sort.dir === "asc"
            ? { column: id, dir: "desc" }
            : null,
    }));
  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((s) => {
      const next = new Set(s);
      for (const r of rows) {
        if (allOnPage) next.delete(rowId(r));
        else next.add(rowId(r));
      }
      return next;
    });

  const count =
    state === "ready"
      ? filtered
        ? `${visible.length} of ${items.length}`
        : items.length
      : undefined;

  let body: ReactNode;
  if (state === "loading")
    body = (
      <StateBlock kind="loading" title={`Loading ${title.toLowerCase()}…`} />
    );
  else if (state === "error")
    body = (
      <StateBlock
        kind="error"
        title={`Could not load ${title.toLowerCase()}`}
        action={
          onRetry && (
            <button
              type="button"
              className="button button-outline"
              onClick={onRetry}
            >
              Retry
            </button>
          )
        }
      >
        {error ?? "Something went wrong. Try again."}
      </StateBlock>
    );
  else if (!items.length)
    body = (
      <StateBlock kind="empty" title={empty.title} action={empty.action}>
        {empty.body}
      </StateBlock>
    );
  else
    body = (
      <>
        <div className="rt-toolbar">
          <label className="rt-search">
            <span className="rt-sr">{searchLabel}</span>
            <input
              type="search"
              placeholder={searchLabel}
              value={view.q}
              onChange={(e) => update({ q: e.target.value })}
            />
          </label>
          {filters.map((f) => (
            <label key={f.id} className="rt-filter">
              <span>{f.label}</span>
              <select
                value={view.filters[f.id] ?? ""}
                onChange={(e) =>
                  update({
                    filters: { ...view.filters, [f.id]: e.target.value },
                  })
                }
              >
                <option value="">All</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {filtered && (
            <button
              type="button"
              className="rt-clear"
              onClick={() => update({ q: "", filters: {} })}
            >
              Clear filters
            </button>
          )}
          {selectedRows.length > 0 && bulkActions && (
            <div
              className="rt-bulk"
              role="group"
              aria-label="Actions for selected rows"
            >
              <span>{selectedRows.length} selected</span>
              {bulkActions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="button button-outline"
                  disabled={a.disabled?.(selectedRows)}
                  onClick={() => a.onRun(selectedRows)}
                >
                  {a.label}
                </button>
              ))}
              <button
                type="button"
                className="rt-clear"
                onClick={() => setSelected(new Set())}
              >
                Deselect
              </button>
            </div>
          )}
        </div>
        <span className="rt-sr" role="status" aria-live="polite">
          {visible.length} {visible.length === 1 ? "result" : "results"}
        </span>

        {visible.length === 0 ? (
          <StateBlock kind="empty" title="No matches">
            Nothing matches the current search and filters.
          </StateBlock>
        ) : (
          <div className="rt-wrap">
            <table className="rt-table">
              <caption className="rt-sr">{title}</caption>
              <thead>
                <tr>
                  {selectable && (
                    <th scope="col" className="rt-check">
                      <input
                        type="checkbox"
                        aria-label="Select all rows on this page"
                        checked={allOnPage}
                        onChange={togglePage}
                      />
                    </th>
                  )}
                  {columns.map((c) => {
                    const sorted =
                      view.sort?.column === c.id ? view.sort.dir : null;
                    return (
                      <th
                        key={c.id}
                        scope="col"
                        className={c.align === "right" ? "rt-num" : undefined}
                        aria-sort={
                          sorted
                            ? sorted === "asc"
                              ? "ascending"
                              : "descending"
                            : c.sortValue
                              ? "none"
                              : undefined
                        }
                      >
                        {c.sortValue ? (
                          <button
                            type="button"
                            className="rt-sort"
                            onClick={() => toggleSort(c.id)}
                          >
                            {c.header}
                            <SortMark dir={sorted} />
                          </button>
                        ) : (
                          c.header
                        )}
                      </th>
                    );
                  })}
                  {rowActions && (
                    <th scope="col" className="rt-actions">
                      <span className="rt-sr">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = rowId(row);
                  const menu: MenuItem[] | undefined = rowActions?.map((a) => ({
                    id: a.id,
                    label: a.label,
                    href: a.href?.(row),
                    onSelect: a.onSelect ? () => a.onSelect?.(row) : undefined,
                    disabled: a.disabled?.(row),
                  }));
                  return (
                    <tr
                      key={id}
                      aria-selected={selectable ? selected.has(id) : undefined}
                    >
                      {selectable && (
                        <td className="rt-check">
                          <input
                            type="checkbox"
                            aria-label={`Select ${id}`}
                            checked={selected.has(id)}
                            onChange={() => toggleRow(id)}
                          />
                        </td>
                      )}
                      {columns.map((c) => (
                        <td
                          key={c.id}
                          className={[
                            c.align === "right" ? "rt-num" : "",
                            c.nowrap ? "rt-nowrap" : "",
                          ].join(" ")}
                        >
                          {c.cell(row)}
                        </td>
                      ))}
                      {menu && (
                        <td className="rt-actions">
                          <Popover
                            label={`Actions for ${id}`}
                            trigger={<Icon name="more" size={16} />}
                            items={menu}
                            className="rt-row-menu"
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {visible.length > 0 && (
          <div className="rt-footer">
            <span>
              Showing {start + 1} to{" "}
              {Math.min(start + view.size, visible.length)} of {visible.length}
            </span>
            <label>
              <span>Rows per page</span>
              <select
                value={view.size}
                onChange={(e) => update({ size: Number(e.target.value) })}
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <nav aria-label={`${title} pages`} className="rt-pager">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setView((v) => ({ ...v, page: page - 1 }))}
              >
                Previous
              </button>
              <span aria-current="page">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= pages}
                onClick={() => setView((v) => ({ ...v, page: page + 1 }))}
              >
                Next
              </button>
            </nav>
          </div>
        )}
      </>
    );

  return (
    <Container
      id={`${uid}-title`}
      title={title}
      count={count}
      description={description}
      action={headerActions}
    >
      {body}
    </Container>
  );
}
