'use client'

import { PlatformAuthController } from 'platform-auth'
import { createPlatformAuthDependencies } from '@/lib/auth/adapters'

/**
 * Build the platform-auth controller for dForum.
 * One per app instance — the controller is stateless apart from its internal
 * restore/login lifecycle.
 */
export function createAuthController(): PlatformAuthController {
  const deps = createPlatformAuthDependencies()
  return new PlatformAuthController(deps)
}
