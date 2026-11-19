"use client";

import { useEffect, useState } from "react";
import apiClient from "@/app/lib/api/client";

type QueueItem = {
  id: string;
  moderationStatus: string;
  content: string;
  createdAt: string;
};

export default function SensitiveQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiClient
      .get<QueueItem[]>("/api/moderator/sensitive-queue")
      .then(({ data }) => {
        if (active) setItems(data);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load the sensitive moderation queue.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <p className="eyebrow">Moderation</p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--foreground)]">
          Sensitive queue
        </h1>
      </div>
      {loading && <p role="status">Loading queue...</p>}
      {error && (
        <p role="alert" className="rounded border border-red-300 p-3 text-red-700">
          Queue unavailable: {error}. An active moderator access grant is required.
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p>No items are awaiting review.</p>
      )}
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-medium">{item.moderationStatus}</span>
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap">{item.content}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
