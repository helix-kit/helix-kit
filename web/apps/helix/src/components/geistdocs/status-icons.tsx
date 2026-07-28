import { IconCheckCircleFill, IconCrossCircleFill, IconWarningFill } from './icons';

const wrapperClass = 'inline-block align-text-bottom shrink-0';

export const Check = () => (
  <IconCheckCircleFill className={`${wrapperClass} text-green-900`} size={16} />
);

export const Cross = () => (
  <IconCrossCircleFill className={`${wrapperClass} text-red-900`} size={16} />
);

export const Warn = () => (
  <IconWarningFill className={`${wrapperClass} text-amber-700`} size={16} />
);
