import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCompositionTemplate, availableTemplateNames, DEFAULT_TEMPLATES_ROOT, getDefaultTemplatesRoot } from '../src/infrastructure/render/composition-catalog.js';
import { CompositionTemplateError } from '../src/domain/errors.js';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FIXTURES = resolve(__dirname, 'fixtures/composition-templates');

describe('composition-catalog: resolveCompositionTemplate', () => {
  it('resolves a valid template (happy path)', () => {
    const descriptor = resolveCompositionTemplate('pulso', FIXTURES);
    expect(descriptor.name).toBe('pulso');
    expect(descriptor.version).toBe('1.0.0');
    expect(descriptor.identity).toBe('@kevo_ia');
    expect(descriptor.language).toBe('es');
    expect(descriptor.css).toContain('--accent-cyan:#10c8f0');
    expect(descriptor.fragments['io-row']).toContain('io-row');
    expect(Object.keys(descriptor.fragments).sort()).toEqual(
      ['meta-bar', 'badge', 'heading', 'io-row', 'node-sides', 'node-core', 'steps', 'letters', 'chaos'].sort()
    );
    expect(descriptor.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('resolves a second template (aurora) with different identity/CSS', () => {
    const descriptor = resolveCompositionTemplate('aurora', FIXTURES);
    expect(descriptor.name).toBe('aurora');
    expect(descriptor.identity).toBe('@aurora_studio');
    expect(descriptor.css).toContain('#7088f8');
  });

  it('throws NAME_INVALID for path-traversal names', () => {
    expect(() => resolveCompositionTemplate('../etc/passwd', FIXTURES)).toThrow(CompositionTemplateError);
    try {
      resolveCompositionTemplate('../etc/passwd', FIXTURES);
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionTemplateError);
      expect((error as CompositionTemplateError).details?.reason).toBe('NAME_INVALID');
    }
    expect(() => resolveCompositionTemplate('has space', FIXTURES)).toThrow(/NAME_INVALID/);
    expect(() => resolveCompositionTemplate('a/b', FIXTURES)).toThrow(/NAME_INVALID/);
  });

  it('throws NAME_UNKNOWN with availableNames for a non-existent template', () => {
    try {
      resolveCompositionTemplate('no-existe', FIXTURES);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionTemplateError);
      const err = error as CompositionTemplateError;
      expect(err.details?.reason).toBe('NAME_UNKNOWN');
      expect(err.details?.availableNames).toContain('pulso');
      expect(err.details?.availableNames).toContain('aurora');
      expect(err.details?.action).toContain('no-existe');
    }
  });

  it('throws NAME_UNKNOWN with empty availableNames when root does not exist (MINOR-4)', () => {
    try {
      resolveCompositionTemplate('whatever', '/nonexistent/root/path');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionTemplateError);
      const err = error as CompositionTemplateError;
      expect(err.details?.reason).toBe('NAME_UNKNOWN');
      expect(err.details?.availableNames).toEqual([]);
    }
  });

  it('throws DUPLICATE when two directories claim the same metadata.name', () => {
    try {
      resolveCompositionTemplate('dupe', FIXTURES);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionTemplateError);
      const err = error as CompositionTemplateError;
      expect(err.details?.reason).toBe('DUPLICATE');
      expect(err.details?.action).toContain('dupe');
    }
  });

  it('throws UNREADABLE when metadata.json is missing or invalid', () => {
    // nomatch has no metadata.json at all → UNREADABLE (dir exists but metadata missing).
    try {
      resolveCompositionTemplate('nomatch', FIXTURES);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionTemplateError);
      const err = error as CompositionTemplateError;
      expect(err.details?.reason).toBe('UNREADABLE');
    }
  });

  it('throws HASH_MISMATCH when sha256 drifts', () => {
    try {
      resolveCompositionTemplate('sha-drift', FIXTURES);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionTemplateError);
      const err = error as CompositionTemplateError;
      expect(err.details?.reason).toBe('HASH_MISMATCH');
      expect(err.details?.action).toContain('Recompute');
    }
  });

  it('throws MISSING_BLOCK when a required block is absent', () => {
    try {
      resolveCompositionTemplate('missing-chaos', FIXTURES);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionTemplateError);
      const err = error as CompositionTemplateError;
      expect(err.details?.reason).toBe('MISSING_BLOCK');
      expect(err.details?.action).toContain('chaos');
    }
  });

  it('is deterministic across repeated resolutions', () => {
    const a = resolveCompositionTemplate('pulso', FIXTURES);
    const b = resolveCompositionTemplate('pulso', FIXTURES);
    expect(b).toEqual(a);
  });
});

describe('composition-catalog: availableTemplateNames', () => {
  it('returns sorted unique names from valid fixtures', () => {
    const names = availableTemplateNames(FIXTURES);
    expect(names).toContain('pulso');
    expect(names).toContain('aurora');
    expect(names).not.toContain('nomatch');
  });

  it('returns empty array for a non-existent root', () => {
    expect(availableTemplateNames('/nonexistent/root')).toEqual([]);
  });
});

describe('composition-catalog: DEFAULT_TEMPLATES_ROOT (R4-001)', () => {
  it('resolves to a directory that contains the pulso template', () => {
    // The default root must point to a valid directory with the pulso template,
    // regardless of process.cwd() (module-relative fallback).
    expect(existsSync(DEFAULT_TEMPLATES_ROOT)).toBe(true);
    expect(existsSync(join(DEFAULT_TEMPLATES_ROOT, 'pulso', 'template.html'))).toBe(true);
    expect(existsSync(join(DEFAULT_TEMPLATES_ROOT, 'pulso', 'metadata.json'))).toBe(true);
  });

  it('successfully resolves pulso from the default root without explicit override', () => {
    const descriptor = resolveCompositionTemplate('pulso');
    expect(descriptor.name).toBe('pulso');
    expect(descriptor.version).toBe('1.0.0');
  });
});

describe('composition-catalog: getDefaultTemplatesRoot (R4-003 — 3-level precedence)', () => {
  const originalEnv = process.env.CLIPLAB_TEMPLATES_ROOT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLIPLAB_TEMPLATES_ROOT;
    } else {
      process.env.CLIPLAB_TEMPLATES_ROOT = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('test 1: env override wins when set and exists', () => {
    process.env.CLIPLAB_TEMPLATES_ROOT = FIXTURES;
    const root = getDefaultTemplatesRoot();
    expect(root).toBe(resolve(FIXTURES));
  });

  it('test 2: module-relative root used when it exists and no env', () => {
    delete process.env.CLIPLAB_TEMPLATES_ROOT;
    const root = getDefaultTemplatesRoot();
    // In the test environment, module-relative resolves to <repo>/templates/composition which exists.
    expect(existsSync(root)).toBe(true);
    expect(root).toBe(resolve(__dirname, '../src/infrastructure/render/../../../templates/composition'));
  });

  // NOTE: test 3 (fallback when module-relative does not exist) lives in
  // composition-catalog-fallback.test.ts — vi.spyOn can't redefine ESM exports,
  // so that test uses vi.mock at module level to simulate the dist scenario.
});
