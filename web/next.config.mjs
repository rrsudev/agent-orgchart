/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Hide the Next.js dev-mode indicator entirely (the "N" dev-tools button that
  // expands to show Route, Bundler, etc.).
  devIndicators: false,
}

export default nextConfig
