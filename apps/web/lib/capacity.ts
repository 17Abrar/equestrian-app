export type CapacityColor = 'green' | 'yellow' | 'orange' | 'red';

interface CapacityInfo {
  spotsLeft: number;
  fillRate: number;
  isFull: boolean;
  color: CapacityColor;
  label: string;
}

/**
 * Returns capacity display info for a booking slot.
 * Used consistently across calendar views, booking lists, and slot selection.
 */
export function getCapacityInfo(currentRiders: number, maxRiders: number): CapacityInfo {
  const spotsLeft = maxRiders - currentRiders;
  const fillRate = maxRiders > 0 ? currentRiders / maxRiders : 0;
  const isFull = spotsLeft <= 0;

  let color: CapacityColor;
  if (isFull) {
    color = 'red';
  } else if (fillRate >= 0.8) {
    color = 'orange';
  } else if (fillRate >= 0.5) {
    color = 'yellow';
  } else {
    color = 'green';
  }

  let label: string;
  if (isFull) {
    label = 'FULLY BOOKED';
  } else if (spotsLeft === 1) {
    label = '1 spot left!';
  } else if (spotsLeft <= 3) {
    label = `${spotsLeft} spots left`;
  } else {
    label = `${spotsLeft} spots left`;
  }

  return { spotsLeft, fillRate, isFull, color, label };
}

/** Tailwind class map for capacity badge backgrounds */
export const CAPACITY_BADGE_CLASSES: Record<CapacityColor, string> = {
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  orange: 'bg-orange-100 text-orange-800',
  red: 'bg-red-100 text-red-800',
};

/** Tailwind class map for capacity dot indicators (month view) */
export const CAPACITY_DOT_CLASSES: Record<CapacityColor, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
};
