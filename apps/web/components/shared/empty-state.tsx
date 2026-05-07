import Link from 'next/link';
import { Button } from '@/components/ui/button';

// Audit F-53 (2026-05-07 r4): widen `action` to support both link (href) and
// button (onClick) variants so EmptyStates can drive in-page Dialogs (e.g.
// AddRiderDialog) — not just route-level pages.
type EmptyStateAction =
  | { label: string; href: string }
  | { label: string; onClick: () => void };

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: EmptyStateAction;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {action && 'href' in action && (
        <Button asChild className="mt-4">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
      {action && 'onClick' in action && (
        <Button className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
