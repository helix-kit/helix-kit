const MB_PER_GB = 1024;
const MHZ_PER_GHZ = 1000;

/** Enum values are snake_case in the database; titles are what a reader wants to see. */
export const humanize = (value: string): string =>
  value
    .replaceAll('_', ' ')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(
      /\b(Cpu|Gpu|Npu|Dsp|Isp|Usb|Pcie|Hdmi|Mipi|Csi|Dsi|Spi|Uart|Adc|Dac|Fpga|Ecc|Poe|Sip|Ufs|Emmc|Nvme|Sata|Jtag|Swd|Pwm|Rtc|Iommu|Mpu|Trng|Fcc|Ce|Otp)\b/g,
      (match) => match.toUpperCase(),
    );

export const formatMb = (megabytes: number | null | undefined): string => {
  if (megabytes == null) {
    return '—';
  }
  return megabytes >= MB_PER_GB
    ? `${(megabytes / MB_PER_GB).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`
    : `${megabytes.toLocaleString()} MB`;
};

export const formatMhz = (mhz: number | null | undefined): string => {
  if (mhz == null) {
    return '—';
  }
  return mhz >= MHZ_PER_GHZ
    ? `${(mhz / MHZ_PER_GHZ).toFixed(2).replace(/\.?0+$/, '')} GHz`
    : `${mhz} MHz`;
};

/** Tri-state rendering: unknown is a real answer and must not read as "no". */
export const yesNo = (
  value: boolean | null | undefined,
  labels: readonly [string, string] = ['Yes', 'No'],
): string => {
  if (value == null) {
    return '—';
  }
  return value ? labels[0] : labels[1];
};

export const joinOrDash = (values: readonly string[]): string =>
  values.length === 0 ? '—' : values.join(', ');

export const orDash = (value: string | number | null | undefined): string => {
  if (value == null || value === '') {
    return '—';
  }
  return String(value);
};

/** "4× Cortex-A76 @ 2.4 GHz" — the one-line shape a listing needs. */
export const describeComputeUnit = (unit: {
  coreCount: number;
  label: string;
  maxClockMhz: number | null;
  coreDesign: { name: string } | null;
}): string => {
  const name = unit.coreDesign?.name ?? (unit.label === '' ? 'core' : unit.label);
  const count = unit.coreCount > 1 ? `${unit.coreCount}× ` : '';
  const clock = unit.maxClockMhz == null ? '' : ` @ ${formatMhz(unit.maxClockMhz)}`;
  return `${count}${name}${clock}`;
};

const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Money is stored in minor units; render it in the currency's own conventions. Falls back to a
 * plain suffix when the runtime has no data for an unusual currency code.
 */
export const formatMoney = (amountMinor: number, currencyCode: string): string => {
  const major = amountMinor / MINOR_UNITS_PER_MAJOR;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(
      major,
    );
  } catch {
    return `${major.toFixed(2)} ${currencyCode}`;
  }
};

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

export const countryName = (countryCode: string): string => {
  try {
    return REGION_NAMES.of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
};
