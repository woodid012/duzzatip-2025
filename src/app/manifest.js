export default function manifest() {
  return {
    name: 'DuzzaTip 2026',
    short_name: 'DuzzaTip',
    description: 'DuzzaTip 2026 — AFL Fantasy Tipping',
    start_url: '/pages/results',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f9fafb',
    theme_color: '#2563eb',
    icons: [
      {
        src: '/icon.png',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-icon.png',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
