export const HORSE_STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-800',
  resting: 'bg-yellow-100 text-yellow-800',
  injured: 'bg-red-100 text-red-800',
  retired: 'bg-gray-100 text-gray-800',
  off_site: 'bg-blue-100 text-blue-800',
  sold: 'bg-purple-100 text-purple-800',
};

export const SKILL_LEVEL_COLORS: Record<string, string> = {
  beginner: 'bg-green-100 text-green-800',
  intermediate: 'bg-blue-100 text-blue-800',
  advanced: 'bg-purple-100 text-purple-800',
};

export const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  no_show: 'bg-gray-100 text-gray-800',
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  refunded: 'bg-purple-100 text-purple-800',
};

export const COMPETITION_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  published: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export const COMPETITION_ENTRY_STATUS_COLORS: Record<string, string> = {
  registered: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  withdrawn: 'bg-gray-100 text-gray-800',
  scratched: 'bg-red-100 text-red-800',
};

export const LESSON_TYPE_COLORS: Record<string, string> = {
  group: '#3b82f6',
  semi_private: '#8b5cf6',
  private: '#f59e0b',
  desert_ride: '#f97316',
  beach_ride: '#06b6d4',
  endurance: '#ef4444',
  camp: '#10b981',
  clinic: '#ec4899',
  custom: '#6366f1',
};
