'use client';

import ReportList from '@/app/components/admin/ReportList';
import ModerationOperationsPanel from '@/app/components/admin/ModerationOperationsPanel';

export default function ReportsPage() {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <p className="eyebrow">Moderation</p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
          Reports
        </h1>
      </div>
      <ModerationOperationsPanel />
      <ReportList />
    </div>
  );
}
