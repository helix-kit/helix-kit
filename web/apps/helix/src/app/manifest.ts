import type { MetadataRoute } from 'next';

const manifest = (): MetadataRoute.Manifest => ({
  name: 'Helix — the open IoT platform you compose yourself',
  short_name: 'Helix',
  description:
    'An open-source IoT platform assembled from reusable, independently adoptable components.',
  start_url: '/',
  display: 'standalone',
  background_color: '#09090b',
  theme_color: '#09090b',
  icons: [
    { src: '/icon', sizes: '32x32', type: 'image/png' },
    { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
  ],
});

export default manifest;
