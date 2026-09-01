import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompositionTemplateError } from '../../domain/errors.js';
import { sha256 } from './composition-utils.js';

// Module-relative root (computed at load from import.meta.url).
// - Under tsx/dev (src/infrastructure/render/) → <repo>/templates/composition (exists).
// - Under dist/npm start (dist/src/infrastructure/render/) → dist/templates/composition
//   (does NOT exist: tsc does not copy template files). getDefaultTemplatesRoot() detects
//   this at call time and falls back to process.cwd()-based resolution.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODULE_RELATIVE_ROOT = resolve(__dirname, '../../../templates/composition');

/**
 * Resolve the default templates root with deterministic 3-level precedence:
 *   1. CLIPLAB_TEMPLATES_ROOT env var — if set AND the directory exists.
 *   2. Module-relative root — if the directory exists (covers tsx/dev and dist with copied templates).
 *   3. Fallback: resolve(process.cwd(), 'templates/composition') (covers dist without template copy;
 *      npm start runs from <repo>, so this resolves to <repo>/templates/composition).
 *
 * Evaluated lazily (at call time) so env changes and runtime conditions are respected.
 */
export function getDefaultTemplatesRoot(): string {
  const envRoot = process.env.CLIPLAB_TEMPLATES_ROOT;
  if (envRoot) {
    const resolved = resolve(envRoot);
    if (existsSync(resolved)) return resolved;
  }

  if (existsSync(MODULE_RELATIVE_ROOT)) {
    return MODULE_RELATIVE_ROOT;
  }

  return resolve(process.cwd(), 'templates/composition');
}

/**
 * Default templates root (snapshot at module load via getDefaultTemplatesRoot()).
 * Prefer getDefaultTemplatesRoot() for runtime-dynamic resolution (e.g., env overrides set after import).
 */
export const DEFAULT_TEMPLATES_ROOT: string = getDefaultTemplatesRoot();

export interface TemplateDescriptor {
  name: string;
  version: string;
  identity: string;
  language: string;
  layout: 'standard' | 'asymmetric';
  css: string;
  fragments: Record<string, string>;
  templatePath: string;
  sha256: string;
}

const NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REQUIRED_BLOCKS = ['meta-bar', 'badge', 'heading', 'io-row', 'node-sides', 'node-core', 'steps', 'letters', 'chaos'] as const;
const STANDARD_LAYOUT_BLOCKS = ['content-stack'] as const;
const CSS_PATTERN = /<style>([\s\S]*?)<\/style>/;
const BLOCK_PATTERN = /<!--\s*@block:([a-z-]+)\s*-->([\s\S]*?)<!--\s*@endblock:\1\s*-->/g;

export function resolveCompositionTemplate(name: string, root: string = getDefaultTemplatesRoot()): TemplateDescriptor {
  if (!NAME_REGEX.test(name)) {
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: NAME_INVALID`, {
      requestedName: name,
      reason: 'NAME_INVALID',
      action: 'Use a simple name without path separators (allowed characters: letters, digits, dot, dash, underscore)'
    });
  }

  const templateDir = join(root, name);
  if (!existsSync(templateDir) || !statSync(templateDir).isDirectory()) {
    // Escaneo diagnóstico: contar cuántos subdirectorios reclaman metadata.name === name.
    // Si 1+ → DUPLICATE; si ninguno → NAME_UNKNOWN con availableNames válidas.
    const allNames = scanAllMetadataNames(root);
    const claimants = allNames.filter(n => n === name).length;
    const availableNames = [...new Set(allNames)].sort();
    if (claimants > 0) {
      throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: DUPLICATE`, {
        requestedName: name,
        reason: 'DUPLICATE',
        action: `Resolve the duplicate registrations under templates/composition/${name}`,
        availableNames,
        templateDir
      });
    }
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: NAME_UNKNOWN`, {
      requestedName: name,
      reason: 'NAME_UNKNOWN',
      action: `Register '${name}' under templates/composition/ or choose one of: ${availableNames.length > 0 ? availableNames.join(', ') : '(none available)'}`,
      availableNames,
      templateDir
    });
  }

  let metadata: { name?: string; version?: string; identity?: string; language?: string; sha256?: string; layout?: string };
  try {
    metadata = JSON.parse(readFileSync(join(templateDir, 'metadata.json'), 'utf8'));
  } catch (error) {
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: UNREADABLE`, {
      requestedName: name,
      reason: 'UNREADABLE',
      action: `metadata.json at ${templateDir} is missing or invalid JSON (${error instanceof Error ? error.message : 'parse error'})`,
      templateDir
    });
  }

  if (metadata.name !== name) {
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: DUPLICATE`, {
      requestedName: name,
      reason: 'DUPLICATE',
      action: `metadata name conflicts with the directory name — rename one`,
      templateDir
    });
  }

  // MINOR-5: identity/language non-empty validation with deterministic fallback for meta.right.
  // identity falls back to template name; language falls back to 'und' (undetermined).
  const identity = typeof metadata.identity === 'string' && metadata.identity.trim() !== '' ? metadata.identity : name;
  const language = typeof metadata.language === 'string' && metadata.language.trim() !== '' ? metadata.language : 'und';
  const fallbackUsed = (identity !== metadata.identity) || (language !== metadata.language);

  if (typeof metadata.version !== 'string' || metadata.version.trim() === '') {
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: UNREADABLE`, {
      requestedName: name,
      reason: 'UNREADABLE',
      action: 'metadata.json must have a non-empty "version" string',
      templateDir
    });
  }

  let templateHtml: string;
  try {
    templateHtml = readFileSync(join(templateDir, 'template.html'), 'utf8');
  } catch (error) {
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: UNREADABLE`, {
      requestedName: name,
      reason: 'UNREADABLE',
      action: `template.html at ${templateDir} is not readable (${error instanceof Error ? error.message : 'read error'})`,
      templateDir
    });
  }

  const computedHash = sha256(templateHtml);
  if (computedHash !== metadata.sha256) {
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: HASH_MISMATCH`, {
      requestedName: name,
      reason: 'HASH_MISMATCH',
      action: 'Recompute sha256 and bump version in metadata.json',
      templateDir
    });
  }

  const cssMatch = CSS_PATTERN.exec(templateHtml);
  if (!cssMatch) {
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: UNREADABLE`, {
      requestedName: name,
      reason: 'UNREADABLE',
      action: 'template.html must contain a <style> block',
      templateDir
    });
  }

  const fragments: Record<string, string> = {};
  BLOCK_PATTERN.lastIndex = 0;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = BLOCK_PATTERN.exec(templateHtml)) !== null) {
    fragments[blockMatch[1]] = blockMatch[2];
  }

  const missingBlocks = REQUIRED_BLOCKS.filter(block => !(block in fragments));
  if (missingBlocks.length > 0) {
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: MISSING_BLOCK`, {
      requestedName: name,
      reason: 'MISSING_BLOCK',
      action: `Add the missing block(s): ${missingBlocks.join(', ')}`,
      templateDir
    });
  }

  // Layout contract: parse metadata.layout (optional, default 'standard').
  // Only 'standard' and 'asymmetric' are accepted; any other value falls back to 'standard'.
  const rawLayout = typeof metadata.layout === 'string' ? metadata.layout.trim() : '';
  const layout: 'standard' | 'asymmetric' = rawLayout === 'asymmetric' ? 'asymmetric' : 'standard';

  // When layout is 'standard' (or default), content-stack is a required block.
  // 'asymmetric' opts out: no content-stack required.
  if (layout === 'standard' && !('content-stack' in fragments)) {
    const missingStandard = STANDARD_LAYOUT_BLOCKS.filter(block => !(block in fragments));
    throw new CompositionTemplateError(`Composition template '${name}' cannot be resolved: MISSING_BLOCK`, {
      requestedName: name,
      reason: 'MISSING_BLOCK',
      action: `Add the missing block(s): ${missingStandard.join(', ')}`,
      templateDir
    });
  }

  return {
    name,
    version: metadata.version,
    identity,
    language,
    layout,
    css: cssMatch[1],
    fragments,
    templatePath: join(templateDir, 'template.html'),
    sha256: computedHash
  };
}

export function availableTemplateNames(root: string = getDefaultTemplatesRoot()): string[] {
  return [...new Set(scanAllMetadataNames(root))].sort();
}

function scanAllMetadataNames(root: string): string[] {
  // MINOR-4: non-existent/ENOENT root → [] (no crash).
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    try {
      const metaPath = join(root, entry, 'metadata.json');
      if (!existsSync(metaPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (typeof meta.name === 'string' && meta.name.length > 0) names.push(meta.name);
    } catch {
      // Skip unreadable entries.
    }
  }
  return names;
}
