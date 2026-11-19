"use client";

import { useState } from "react";
import apiClient from "@/app/lib/api/client";
import { Button } from "@/app/components/ui/button";

type Thresholds = { highThreshold: number; mediumThreshold: number };
type Preview = {
  previewId: string;
  expiresAt: string;
  affectedCount: number;
  sampleLimit: number;
  representativeRecords: Array<{
    id: string;
    from: string;
    to: string;
    reason: string;
  }>;
};

export default function ModerationOperationsPanel() {
  const [highThreshold, setHighThreshold] = useState("0.8");
  const [mediumThreshold, setMediumThreshold] = useState("0.5");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [operationId, setOperationId] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [moderatorId, setModeratorId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const thresholds = (): Thresholds => ({
    highThreshold: Number(highThreshold),
    mediumThreshold: Number(mediumThreshold),
  });

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      const value = await action();
      setResult(
        typeof value === "object" && value !== null && "data" in value
          ? (value as { data: unknown }).data
          : value,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Moderation operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const createPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await apiClient.post<Preview>(
        "/api/admin/moderation/operations/policy-previews",
        thresholds(),
      );
      setPreview(response.data);
      setResult(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Policy preview failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow dark:border-gray-700 dark:bg-gray-800">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Moderation operations
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Previews and evaluations are bounded, aggregate-first, and never resolve reports automatically.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block">High threshold</span>
          <input
            type="number"
            min="0.01"
            max="1"
            step="0.01"
            value={highThreshold}
            onChange={(event) => setHighThreshold(event.target.value)}
            className="w-full rounded border px-3 py-2 text-gray-900"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block">Medium threshold</span>
          <input
            type="number"
            min="0.01"
            max="0.99"
            step="0.01"
            value={mediumThreshold}
            onChange={(event) => setMediumThreshold(event.target.value)}
            className="w-full rounded border px-3 py-2 text-gray-900"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={createPreview}>
          Preview policy change
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(() =>
              apiClient.post(
                "/api/admin/moderation/operations/shadow-evaluation",
                thresholds(),
              ),
            )
          }
        >
          Run shadow evaluation
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(() =>
              apiClient.post(
                "/api/admin/moderation/operations/report-clusters",
              ),
            )
          }
        >
          Find likely duplicate reports
        </Button>
      </div>

      {preview && (
        <div className="space-y-3 rounded border border-indigo-200 p-3 dark:border-indigo-800">
          <p>
            {preview.affectedCount} of up to {preview.sampleLimit} sampled
            records may change; this is not a total count. Preview expires{" "}
            {new Date(preview.expiresAt).toLocaleString()}.
          </p>
          <ul className="space-y-2 text-sm">
            {preview.representativeRecords.map((record) => (
              <li key={record.id}>
                <span className="font-mono">{record.id}</span>: {record.from} -&gt;{" "}
                {record.to}. {record.reason}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const response = await apiClient.post(
                  "/api/admin/moderation/operations/policy-apply",
                  { previewId: preview.previewId, approved: true },
                );
                const applied = response.data as { operationId: string };
                setOperationId(applied.operationId);
                setPreview(null);
                return response.data;
              })
            }
          >
            Approve and apply
          </Button>
        </div>
      )}

      <div className="grid gap-3 border-t border-gray-200 pt-4 dark:border-gray-700 sm:grid-cols-[1fr_auto]">
        <label className="text-sm">
          <span className="mb-1 block">Moderator user ID</span>
          <input
            inputMode="numeric"
            value={moderatorId}
            onChange={(event) => setModeratorId(event.target.value)}
            className="w-full rounded border px-3 py-2 text-gray-900"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block">Grant expiry</span>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="w-full rounded border px-3 py-2 text-gray-900"
          />
        </label>
        <Button
          type="button"
          disabled={busy || !moderatorId || !expiresAt}
          onClick={() =>
            run(() =>
              apiClient.post(
                "/api/admin/moderation/operations/access-grants",
                {
                  moderatorId: Number(moderatorId),
                  expiresAt: new Date(expiresAt).toISOString(),
                },
              ),
            )
          }
        >
          Grant sensitive-queue access
        </Button>
      </div>

      {operationId && (
        <div className="flex flex-wrap items-end gap-2">
          <p className="text-sm">Applied policy operation: {operationId}</p>
          <label className="text-sm">
            <span className="mb-1 block">Rollback reason</span>
            <input
              value={rollbackReason}
              onChange={(event) => setRollbackReason(event.target.value)}
              maxLength={500}
              className="rounded border px-3 py-2 text-gray-900"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !rollbackReason.trim()}
            onClick={() =>
              run(() =>
                apiClient.post(
                  "/api/admin/moderation/operations/policy-rollback",
                  { operationId, reason: rollbackReason },
                ),
              )
            }
          >
            Roll back policy
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {result !== null && (
        <pre className="max-h-64 overflow-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-900">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}
