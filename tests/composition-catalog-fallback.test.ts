import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

// Mock node:fs so we can control existsSync and simulate the dist scenario
// where the module-relative path does NOT exist (tsc doesn't copy templates).
const originalEnv = process.env.CLIPLAB_TEMPLATES_ROOT;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

// Import AFTER the mock is set up so the module under test uses the mocked existsSync.
import { existsSync } from 'node:fs';
import { getDefaultTemplatesRoot } from '../src/infrastructure/render/composition-catalog.js';

describe('getDefaultTemplatesRoot (R4-003 — test 3: cwd fallback)', () => {
  beforeEach(() => {
    delete process.env.CLIPLAB_TEMPLATES_ROOT;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLIPLAB_TEMPLATES_ROOT;
    } else {
      process.env.CLIPLAB_TEMPLATES_ROOT = originalEnv;
    }
    vi.clearAllMocks();
  });

  it('falls back to resolve(process.cwd(), "templates/composition") when module-relative does not exist', () => {
    // existsSync is mocked to return false for ALL paths (simulates dist:
    // neither env path nor module-relative path exist).
    const root = getDefaultTemplatesRoot();
    expect(root).toBe(resolve(process.cwd(), 'templates/composition'));
    // existsSync was called: once for env (skipped, env not set) — actually env not set,
    // so only module-relative check happens; since it returns false, we fall through.
    expect(existsSync).toHaveBeenCalled();
  });
});
