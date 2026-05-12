import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

interface DayStripProps {
  /** YYYY-MM-DD strings, in render order. Built locally — see `toDateString` in book.tsx. */
  dates: string[];
  /** Currently selected date (YYYY-MM-DD), or null for no selection. */
  selected: string | null;
  onSelect: (date: string) => void;
  /** Optional: any date strictly before this is rendered disabled. */
  disabledBefore?: string;
  /** Optional badge below the day number — e.g. slot count. */
  counts?: Record<string, number>;
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

function getTodayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function weekdayLetter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const idx = (d.getDay() + 6) % 7;
  return WEEKDAY_LETTERS[idx]!;
}

function dayNumber(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getDate();
}

export function DayStrip({ dates, selected, onSelect, disabledBefore, counts }: DayStripProps) {
  const today = getTodayLocal();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 24, gap: 4 }}
      className="py-2"
    >
      {dates.map((dateStr) => {
        const isSelected = dateStr === selected;
        const isToday = dateStr === today;
        const isDisabled = !!disabledBefore && dateStr < disabledBefore;
        const count = counts?.[dateStr];

        return (
          <TouchableOpacity
            key={dateStr}
            onPress={() => onSelect(dateStr)}
            disabled={isDisabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected, disabled: isDisabled }}
            accessibilityLabel={new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
            className={`items-center justify-center px-2 py-1 ${isDisabled ? 'opacity-40' : ''}`}
            style={{ minWidth: 44 }}
          >
            <Text className="text-[10px] font-medium uppercase text-gray-400">
              {weekdayLetter(dateStr)}
            </Text>
            <View
              className={`mt-1 h-10 w-10 items-center justify-center rounded-full ${
                isSelected
                  ? 'bg-gray-900'
                  : isToday
                    ? 'border border-gray-900'
                    : ''
              }`}
            >
              <Text
                className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-900'}`}
              >
                {dayNumber(dateStr)}
              </Text>
            </View>
            <Text
              className={`mt-1 h-3 text-[10px] ${
                isSelected ? 'text-gray-900' : 'text-gray-400'
              }`}
            >
              {typeof count === 'number' && count > 0 ? count : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
