'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Clock, ShieldOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { fetchJson } from '@/lib/fetch-json';

interface SendRow {
  id: string;
  toEmail: string;
  subject: string;
  source: 'manual_single' | 'manual_broadcast' | 'transactional';
  status: 'queued' | 'sent' | 'failed' | 'suppressed';
  trigger: string | null;
  audienceId: string | null;
  audienceName: string | null;
  senderDisplayName: string | null;
  resendId: string | null;
  error: string | null;
  createdAt: string;
}

interface PaginatedEnvelope<T> {
  success: true;
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

type StatusFilter = '' | SendRow['status'];
type SourceFilter = '' | SendRow['source'];

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'queued', label: 'In-flight' },
];

const SOURCE_OPTIONS: ReadonlyArray<{ value: SourceFilter; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'manual_single', label: 'Single send' },
  { value: 'manual_broadcast', label: 'Broadcast' },
  { value: 'transactional', label: 'Transactional' },
];

function StatusBadge({ status }: { status: SendRow['status'] }) {
  if (status === 'sent') {
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Sent
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="secondary" className="bg-rose-100 text-rose-800 hover:bg-rose-100">
        <XCircle className="mr-1 h-3 w-3" />
        Failed
      </Badge>
    );
  }
  if (status === 'suppressed') {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
        <ShieldOff className="mr-1 h-3 w-3" />
        Suppressed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100">
      <Clock className="mr-1 h-3 w-3" />
      Queued
    </Badge>
  );
}

function SourceLabel({ row }: { row: SendRow }) {
  if (row.source === 'manual_broadcast') {
    return <span>Broadcast{row.audienceName ? ` · ${row.audienceName}` : ''}</span>;
  }
  if (row.source === 'manual_single') return <span>Single send</span>;
  return <span>Transactional{row.trigger ? ` · ${row.trigger}` : ''}</span>;
}

export function SendsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>('');
  const [source, setSource] = useState<SourceFilter>('');

  const search = new URLSearchParams();
  search.set('page', String(page));
  if (status) search.set('status', status);
  if (source) search.set('source', source);

  const query = useQuery<PaginatedEnvelope<SendRow>>({
    queryKey: ['email-sends', { page, status, source }],
    queryFn: () =>
      fetchJson<PaginatedEnvelope<SendRow>>(`/api/v1/emails/sends?${search.toString()}`),
  });

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'Failed to load send log'}
        onRetry={() => query.refetch()}
      />
    );
  }

  const rows = query.data?.data ?? [];
  const pagination = query.data?.pagination;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Recently sent</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Every email this club has tried to send. Use the filters to narrow by status or source.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select
          value={status || '__all__'}
          onValueChange={(v) => {
            setStatus(v === '__all__' ? '' : (v as StatusFilter));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || '__all__'} value={opt.value || '__all__'}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={source || '__all__'}
          onValueChange={(v) => {
            setSource(v === '__all__' ? '' : (v as SourceFilter));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || '__all__'} value={opt.value || '__all__'}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No sends yet"
          description="Once you send your first email, it'll show up here with delivery status."
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-border divide-y">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{row.subject}</span>
                        <StatusBadge status={row.status} />
                      </div>
                      <p className="text-muted-foreground mt-1 text-sm">
                        To {row.toEmail}
                        {row.senderDisplayName ? ` · sent by ${row.senderDisplayName}` : ''}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        <SourceLabel row={row} /> ·{' '}
                        {new Date(row.createdAt).toLocaleString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      {row.error ? (
                        <p className="text-destructive mt-1 text-xs">{row.error}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          {pagination && pagination.totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-sm">
                Page {page} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
