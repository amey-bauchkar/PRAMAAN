import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PRAMAAN',
    short_name: 'PRAMAAN',
    description: 'Verified skills, explainable campus placements.',
    start_url: '/',
    display: 'standalone',
    background_color: '#14162E',
    theme_color: '#5B3FE0',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
