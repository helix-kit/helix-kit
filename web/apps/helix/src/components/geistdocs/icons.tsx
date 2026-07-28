interface IconProps {
  size?: number;
  className?: string;
}

export const IconFileText = ({ size = 16, className }: IconProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height={size}
    role="img"
    viewBox="0 0 16 16"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9.18 0a1 1 0 0 1 .61.3l4.42 4.4a1 1 0 0 1 .29.71v8.09A2.5 2.5 0 0 1 12 16H4a2.5 2.5 0 0 1-2.5-2.5V0h7.69M3 13.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.62L8.88 1.5H3zm8.63-1.25H4.5V11h7.13zm0-3H4.5V8h7.13zm-5-3H4.5V5h2.13z"
      fill="currentColor"
    />
  </svg>
);

export const IconMenuAlt = ({ size = 16, className }: IconProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height={size}
    role="img"
    viewBox="0 0 16 16"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      clipRule="evenodd"
      d="M1 2h14v1.5H1zm0 10h14v1.5H1zm.75-5H1v1.5h14V7H1.75"
      fill="currentColor"
      fillRule="evenodd"
    />
  </svg>
);

export const IconCheckCircleFill = ({ size = 16, className }: IconProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height={size}
    role="img"
    viewBox="0 0 16 16"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      clipRule="evenodd"
      d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-4.47-1.47.53-.53L11 4.94l-.53.53L6.5 9.44l-.97-.97L5 7.94 3.94 9l.53.53 1.5 1.5c.3.3.77.3 1.06 0z"
      fill="currentColor"
      fillRule="evenodd"
    />
  </svg>
);

export const IconCrossCircleFill = ({ size = 16, className }: IconProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height={size}
    role="img"
    viewBox="0 0 16 16"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      clipRule="evenodd"
      d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-5.5 3.56-.53-.53L8 9.06l-1.97 1.97-.53.53-1.06-1.06.53-.53L6.94 8 4.97 6.03l-.53-.53L5.5 4.44l.53.53L8 6.94l1.97-1.97.53-.53 1.06 1.06-.53.53L9.06 8l1.97 1.97.53.53z"
      fill="currentColor"
      fillRule="evenodd"
    />
  </svg>
);

export const IconWarningFill = ({ size = 16, className }: IconProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height={size}
    role="img"
    viewBox="0 0 16 16"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M8.56.5c.57 0 1.1.33 1.35.85l5.9 12.22a1 1 0 0 1-.9 1.43H1.09a1 1 0 0 1-.9-1.43L6.1 1.35A1.5 1.5 0 0 1 7.44.5zM8 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2m-.75-1.25h1.5v-4h-1.5z"
      fill="currentColor"
    />
  </svg>
);

export const GithubIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);
