'use client';

import { useEffect, useMemo, useState } from 'react';

type ViewerCollection = {
  name: string;
  type: string;
  total: number;
};

type ViewerRecordsPayload = {
  collection: string;
  fields: string[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  records: Array<Record<string, unknown>>;
};

export default function PocketBaseViewerPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [username, setUsername] = useState('hasnain');
  const [password, setPassword] = useState('hasnain123');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [collections, setCollections] = useState<ViewerCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [recordsPayload, setRecordsPayload] = useState<ViewerRecordsPayload | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const loadSession = async () => {
      const response = await fetch('/api/pocketbase-viewer/session', {
        cache: 'no-store',
      });
      const data = await response.json();
      setAuthenticated(Boolean(data.authenticated));
    };
    void loadSession();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const loadCollections = async () => {
      setCollectionsLoading(true);
      try {
        const response = await fetch('/api/pocketbase-viewer/collections', {
          cache: 'no-store',
        });
        const data = await response.json();
        if (response.ok) {
          const nextCollections = (data.collections || []) as ViewerCollection[];
          setCollections(nextCollections);
          if (!selectedCollection && nextCollections.length > 0) {
            setSelectedCollection(nextCollections[0].name);
          }
        }
      } finally {
        setCollectionsLoading(false);
      }
    };
    void loadCollections();
  }, [authenticated, selectedCollection]);

  useEffect(() => {
    if (!authenticated || !selectedCollection) return;
    const loadRecords = async () => {
      setRecordsLoading(true);
      try {
        const params = new URLSearchParams({
          collection: selectedCollection,
          page: String(page),
          perPage: '20',
        });
        const response = await fetch(
          `/api/pocketbase-viewer/records?${params.toString()}`,
          { cache: 'no-store' }
        );
        const data = await response.json();
        if (response.ok) {
          setRecordsPayload(data as ViewerRecordsPayload);
        }
      } finally {
        setRecordsLoading(false);
      }
    };
    void loadRecords();
  }, [authenticated, page, selectedCollection]);

  const selectedMeta = useMemo(
    () => collections.find((item) => item.name === selectedCollection) || null,
    [collections, selectedCollection]
  );

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const response = await fetch('/api/pocketbase-viewer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }
      setAuthenticated(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/pocketbase-viewer/logout', { method: 'POST' });
    setAuthenticated(false);
    setCollections([]);
    setRecordsPayload(null);
    setSelectedCollection('');
    setPage(1);
  };

  if (authenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        Loading PocketBase viewer...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#15325c_0%,#0f172a_45%,#020617_100%)] px-4 py-10 text-white">
        <div className="mx-auto max-w-md rounded-[32px] border border-white/10 bg-white/8 p-6 shadow-2xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
            PocketBase Viewer
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Read-only data panel</h1>
          <p className="mt-2 text-sm text-slate-300">
            This is a simplified viewer for business data. Sensitive secrets stay redacted.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="mb-1.5 block text-sm text-slate-200">Username</label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm outline-none transition focus:border-cyan-300"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-slate-200">Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm outline-none transition focus:border-cyan-300"
              />
            </div>
            {loginError ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {loginError}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={loggingIn}
              className="w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
            >
              {loggingIn ? 'Signing in...' : 'Open viewer'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="border-b border-slate-200 bg-slate-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
              PocketBase Viewer
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Read-only business data panel</h1>
          </div>
          <button
            onClick={() => void handleLogout()}
            className="rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Collections</h2>
            {collectionsLoading ? (
              <span className="text-xs text-slate-400">Loading...</span>
            ) : null}
          </div>
          <div className="mt-4 space-y-2">
            {collections.map((collection) => (
              <button
                key={collection.name}
                onClick={() => {
                  setSelectedCollection(collection.name);
                  setPage(1);
                }}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                  selectedCollection === collection.name
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-white'
                }`}
              >
                <p className="font-semibold">{collection.name}</p>
                <p
                  className={`mt-1 text-xs ${
                    selectedCollection === collection.name
                      ? 'text-slate-300'
                      : 'text-slate-500'
                  }`}
                >
                  {collection.total} records
                </p>
              </button>
            ))}
          </div>
        </aside>

        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Current collection
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                {selectedCollection || 'Select a collection'}
              </h2>
              {selectedMeta ? (
                <p className="mt-1 text-sm text-slate-500">
                  {selectedMeta.total} total records
                </p>
              ) : null}
            </div>
            {recordsPayload ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
                >
                  Prev
                </button>
                <span className="text-sm text-slate-500">
                  Page {recordsPayload.page} / {recordsPayload.totalPages || 1}
                </span>
                <button
                  onClick={() =>
                    setPage((current) =>
                      recordsPayload.totalPages
                        ? Math.min(recordsPayload.totalPages, current + 1)
                        : current + 1
                    )
                  }
                  disabled={recordsPayload.totalPages > 0 && page >= recordsPayload.totalPages}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-4 overflow-hidden rounded-[24px] border border-slate-200">
            {recordsLoading ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                Loading records...
              </div>
            ) : !recordsPayload ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                Select a collection to view records.
              </div>
            ) : recordsPayload.records.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                No records found in this collection.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {recordsPayload.fields.map((field) => (
                        <th
                          key={field}
                          className="border-b border-slate-200 px-3 py-3 font-semibold text-slate-700"
                        >
                          {field}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recordsPayload.records.map((record, index) => (
                      <tr key={`${record.id || index}`} className="align-top">
                        {recordsPayload.fields.map((field) => (
                          <td
                            key={field}
                            className="max-w-[20rem] border-b border-slate-100 px-3 py-3 text-slate-600"
                          >
                            <div className="whitespace-pre-wrap break-words">
                              {String(record[field] ?? '') || '-'}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
