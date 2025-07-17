/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@neondatabase/serverless'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig