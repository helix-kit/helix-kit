import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const AppleIcon = () =>
  new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#09090b',
      }}
    >
      <svg
        fill="none"
        height="112"
        stroke="#2dd4bf"
        strokeLinecap="round"
        strokeWidth={2.2}
        viewBox="0 0 24 24"
        width="112"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M5 3c0 6 14 6 14 12s-14 6-14 12" />
        <path d="M19 3c0 6-14 6-14 12s14 6 14 12" />
        <path d="M7 8h10M7 16h10" />
      </svg>
    </div>,
    { ...size },
  );

export default AppleIcon;
