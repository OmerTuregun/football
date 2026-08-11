export const CONNECTIONS_BOARD = 16;
export const CONNECTIONS_GROUP_SIZE = 4;
export const CONNECTIONS_GROUP_COUNT = 4;
export const CONNECTIONS_MISTAKES = 4;

export type ConnectionsColor = 'yellow' | 'green' | 'blue' | 'purple';

export const CONNECTIONS_COLORS: ConnectionsColor[] = [
  'yellow',
  'green',
  'blue',
  'purple',
];

export const CONNECTIONS_COLOR_LABELS: Record<ConnectionsColor, string> = {
  yellow: 'Kolay',
  green: 'Orta',
  blue: 'Zor',
  purple: 'Çok zor',
};
