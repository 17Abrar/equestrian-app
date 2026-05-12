import { Ionicons } from '@expo/vector-icons';
import { type Booking } from '@/hooks/use-bookings';

interface StatusIconProps {
  status: Booking['status'];
  size?: number;
}

const STATUS_GLYPH: Record<
  Booking['status'],
  { name: React.ComponentProps<typeof Ionicons>['name']; color: string }
> = {
  confirmed: { name: 'checkmark-circle', color: '#10b981' },
  completed: { name: 'checkmark-circle', color: '#9ca3af' },
  pending: { name: 'time-outline', color: '#f59e0b' },
  cancelled: { name: 'close-circle', color: '#9ca3af' },
  no_show: { name: 'close-circle', color: '#9ca3af' },
};

export function StatusIcon({ status, size = 20 }: StatusIconProps) {
  const glyph = STATUS_GLYPH[status] ?? STATUS_GLYPH.pending;
  return <Ionicons name={glyph.name} size={size} color={glyph.color} />;
}
