import {
  Activity,
  Bluetooth,
  Cable,
  Cloud,
  Cpu,
  GitBranch,
  Globe,
  MonitorSmartphone,
  Radio,
  Server,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

import { HelixMark } from '@/components/logo';

/** Maps the string icon keys used in `src/lib/landing.ts` to components. */
export const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  activity: Activity,
  bluetooth: Bluetooth,
  cable: Cable,
  cloud: Cloud,
  cpu: Cpu,
  devices: MonitorSmartphone,
  dna: HelixMark,
  git: GitBranch,
  globe: Globe,
  radio: Radio,
  server: Server,
  shield: ShieldCheck,
  smartphone: Smartphone,
};
