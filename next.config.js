const { execSync } = require('child_process')

const getGitInfo = () => {
  try {
    const commitHash = execSync('git rev-parse --short HEAD').toString().trim()
    const commitDate = execSync('git log -1 --format=%ci').toString().trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
    return { commitHash, commitDate, branch }
  } catch {
    return { commitHash: 'unknown', commitDate: '', branch: 'unknown' }
  }
}

const gitInfo = getGitInfo()
// The snapshot is bundled into build chunks — its content changes hourly,
// so the build id must change with it (or a stale build could serve stale
// snapshot data as if it were fresh).
const snapshotStamp = (() => {
  try {
    return require('fs').statSync('data/snapshot.json').mtimeMs.toString(36)
  } catch {
    return 'nosnapshot'
  }
})()

const basePath = process.env.BASE_PATH || ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  assetPrefix: basePath,
  trailingSlash: true,
  generateBuildId: async () => `${gitInfo.commitHash}-${snapshotStamp}`,
  env: {
    NEXT_PUBLIC_GIT_COMMIT_HASH: gitInfo.commitHash,
    NEXT_PUBLIC_GIT_COMMIT_DATE: gitInfo.commitDate,
    NEXT_PUBLIC_GIT_BRANCH: gitInfo.branch,
    NEXT_PUBLIC_STORAGE_SCOPE: basePath ? basePath.replace(/^\//, '') : '',
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            dashevo: {
              test: /[\\/]node_modules[\\/]@dashevo[\\/]/,
              name: 'evo-sdk',
              priority: 10,
              reuseExistingChunk: true,
            },
          },
        },
      }
    }
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    }
    return config
  },
  // Note: `headers()` does not apply to `output: 'export'` (and GitHub Pages
  // ignores response headers) — CSP is a meta tag written into the static
  // pages by scripts/csp.mjs after the build (hashed per-page). COOP/COEP are
  // deliberately NOT set here; a hostile same-origin page is the real exposure
  // and is mitigated by the moderation console's host gate and the CSP, not by
  // headers GH Pages cannot serve.
}

module.exports = nextConfig
