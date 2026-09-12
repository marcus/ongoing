import type { IconName } from './icons';

export interface RailItem {
  label: string;
  href: string;
  icon?: IconName;
  count?: number | null;
  active?: boolean;
}

export interface RailSection {
  title: string;
  items: RailItem[];
}
