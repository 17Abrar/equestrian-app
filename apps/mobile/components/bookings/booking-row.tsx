import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Booking } from '@/hooks/use-bookings';
import { StatusIcon } from './status-icon';

interface BookingRowProps {
  booking: Booking;
  onPress?: () => void;
}

function formatTime(timeStr: string): string {
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function dateChip(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function metaSecondLine(booking: Booking): string | null {
  const parts = [booking.horseName, booking.arenaName].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function BookingRow({ booking, onPress }: BookingRowProps) {
  const isConfirmed = booking.status === 'confirmed';
  const isCancelled = booking.status === 'cancelled' || booking.status === 'no_show';
  const secondLine = metaSecondLine(booking);

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.7, accessibilityRole: 'button' as const }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={`flex-row items-center gap-3 rounded-2xl border p-4 ${
        isConfirmed ? 'border-transparent bg-gray-100/70' : 'border-gray-200 bg-white'
      } ${isCancelled ? 'opacity-60' : ''}`}
    >
      <StatusIcon status={booking.status} />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
          {booking.lessonTypeName}
        </Text>
        {booking.riderName && (
          <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
            {booking.riderName}
          </Text>
        )}
        {secondLine && (
          <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
            {secondLine}
          </Text>
        )}
      </View>
      <View className="items-end">
        <Text className="text-sm font-medium text-gray-900">{dateChip(booking.slotDate)}</Text>
        <Text className="mt-0.5 text-xs text-gray-500">{formatTime(booking.slotStartTime)}</Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color="#9ca3af" />}
    </Wrapper>
  );
}
