import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Pin the workspace root to this project so Next doesn't pick up the stray
  // package-lock.json in the parent directory (C:\Projects) and infer the wrong
  // root — that mis-detection caused the recurring "inferred workspace root"
  // warnings during dev/build.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
