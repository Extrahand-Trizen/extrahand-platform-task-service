import { config } from '../config/env';

/**
 * Dev-only gate (same env as api-gateway `complete-dev`).
 * When unset or not "true"/"1", all LOCAL_TEST-only code paths are disabled — production behavior unchanged.
 */
export function isTaskServiceLocalTestMode(): boolean {
  const raw = config.LOCAL_TEST ?? process.env.LOCAL_TEST;
  return raw === 'true' || raw === '1';
}
