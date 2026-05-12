import { TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

interface FabProps {
  onPress: () => void;
  /** SR-only label describing the action. */
  accessibilityLabel: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}

export function Fab({ onPress, accessibilityLabel, icon = 'add' }: FabProps) {
  const insets = useSafeAreaInsets();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="absolute right-4 h-14 w-14 items-center justify-center rounded-full bg-gray-900"
      style={{
        bottom: insets.bottom + 16,
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <Ionicons name={icon} size={24} color="white" />
    </TouchableOpacity>
  );
}
