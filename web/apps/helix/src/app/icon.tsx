import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

const Icon = () =>
  new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#09090b',
          borderRadius: 7,
        }}
      >
        <svg
          fill="none"
          height="24"
          stroke="#2dd4bf"
          strokeLinecap="round"
          strokeWidth={2.4}
          viewBox="0 0 24 24"
          width="24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5 3c0 6 14 6 14 12s-14 6-14 12" />
          <path d="M19 3c0 6-14 6-14 12s14 6 14 12" />
          <path d="M7 8h10M7 16h10" />
        </svg>
      </div>
    ),
    { ...size },
  );

export default Icon;
