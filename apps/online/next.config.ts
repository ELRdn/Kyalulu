import type { NextConfig } from 'next';

const relay = process.env.VITE_RELAY_ORIGIN || '';
if (relay && (!URL.canParse(relay) || new URL(relay).protocol !== 'https:' || new URL(relay).origin !== relay)) {
  throw Error('VITE_RELAY_ORIGIN must be the exact HTTPS Relay origin');
}

const config: NextConfig = {
  transpilePackages: ['web'],
  env: { NEXT_PUBLIC_KYALULU_RELAY_ORIGIN: relay },
  webpack(configuration, { webpack, dev, isServer }) {
    configuration.plugins.push(new webpack.DefinePlugin({
      'import.meta.env.KYALULU_PACKAGED_WORKER': 'true',
      'import.meta.env.MODE': JSON.stringify('unified'),
      'import.meta.env.BASE_URL': JSON.stringify('/'),
      'import.meta.env.VITE_UNIFIED_APP': JSON.stringify('1'),
      'import.meta.env.VITE_RELAY_ORIGIN': JSON.stringify(relay),
      'import.meta.env.DEV': JSON.stringify(dev),
      'import.meta.env.PROD': JSON.stringify(!dev),
    }));
    configuration.module.rules.push({ test: /\.wasm$/, resourceQuery: /url/, type: 'asset/resource' });
    if (!isServer) configuration.resolve.fallback = { ...configuration.resolve.fallback, fs: false, path: false, crypto: false };
    return configuration;
  },
  images: {
    localPatterns: [{ pathname: '/_next/static/media/mocha-1.*.png', search: '' }],
    imageSizes: [384],
    deviceSizes: [640, 768],
    qualities: [75],
  },
};

export default config;
