/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Move the Next.js dev-mode indicator (the "N" logo) out of the bottom-left,
  // where it overlapped the legend panel/button, into the bottom-right corner.
  devIndicators: {
    position: 'bottom-right',
  },
}

export default nextConfig
