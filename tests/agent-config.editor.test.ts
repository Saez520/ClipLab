import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const configPath = resolve(root, 'opencode.json');
const promptPath = resolve(root, 'agents/editor.md');

type Route = { method: string; path: string };

function normalizePath(path: string): string {
  const withoutPrefix = path.replace(/^\/api\/v1/, '') || '/';
  return withoutPrefix.replace(/\?$/, '').replace(/\/$/, '') || '/';
}

function routeMatches(cited: Route, registered: Route): boolean {
  if (cited.method !== registered.method) return false;
  const citedSegments = normalizePath(cited.path).split('/').filter(Boolean);
  const registeredSegments = normalizePath(registered.path).split('/').filter(Boolean);
  if (citedSegments.length !== registeredSegments.length) return false;
  return citedSegments.every((segment, index) => {
    const registeredSegment = registeredSegments[index];
    return segment.startsWith(':') || registeredSegment.startsWith(':') || segment === registeredSegment;
  });
}

function extractCitedRoutes(markdown: string): Route[] {
  const regex = /(GET|POST)\s+(\/?(?:api\/v1)?\/[A-Za-z0-9\/:_\-.?]+)/g;
  return [...markdown.matchAll(regex)].map(match => ({ method: match[1].toLowerCase(), path: match[2] }));
}

function registeredRoutes(): Route[] {
  const routeDirectory = resolve(root, 'src/api/routes');
  const files = readdirSync(routeDirectory)
    .filter(file => file.endsWith('.ts'))
    .map(file => resolve(routeDirectory, file));
  files.push(resolve(root, 'src/api/app.ts'));

  return files.flatMap(file => {
    const source = readFileSync(file, 'utf8');
    const regex = /app\.(get|post)\(\s*['"]([^'"]+)['"]/g;
    return [...source.matchAll(regex)].map(match => ({ method: match[1], path: match[2] }));
  });
}

describe('cliplab-editor configuration', () => {
  it('registers the root agent config with the approved values', () => {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(Object.keys(config.agent)).toEqual(['cliplab-director', 'cliplab-sintesis', 'cliplab-guionista', 'cliplab-storyboard', 'cliplab-editor']);
    expect(config.agent['cliplab-editor']).toEqual({
      description: 'ClipLab editor subagent. Invoked only by cliplab-director to produce the final synchronized MP4 from AUTHORIZED_FOR_PRODUCTION via verified gate, deterministic composition and Hyperframes CLI with serial queue and failure classification.',
      mode: 'subagent',
      hidden: true,
      prompt: '{file:agents/editor.md}',
      permission: { edit: 'allow', bash: 'allow' }
    });
  });

  it('keeps the Editor prompt structurally complete and free of functional frontmatter', () => {
    expect(existsSync(promptPath)).toBe(true);
    const prompt = readFileSync(promptPath, 'utf8');
    expect(prompt.startsWith('---')).toBe(false);

    const sections = [
      '# 1. Identidad', '# 2. Alcance y límites', '# 3. Modelo de decisión',
      '# 4. Contrato conversacional', '# 5. Fuentes y API', '# 6. Delegación',
      '# 7. Flujo', '# 8. Estado y continuidad', '# 9. Fallos',
      '# 10. Contrato de salida', '# 11. Reality filter', '# 12. Restricciones y configurables'
    ];
    for (const section of sections) expect(prompt).toContain(section);

    const requiredStrings = [
      'cliplab-editor', 'AUTHORIZED_FOR_PRODUCTION', 'verifyAuthorizedHandoff',
      'ProductionGateError', 'ENVIRONMENT', 'SPECIFICATION', 'UNCLASSIFIED',
      'QUEUED', 'PREFLIGHT', 'transcribir/acoplar/adaptar', 'no inventar/crear desde cero',
      'fail-closed', 'BLOCKED', 'RETRY', 'RENDER→FINAL', 'STORYBOARD→RENDER',
      'render_attempts', 'Qué NUNCA hace', '1080×1920', 'fps', 'español',
      'solo SUCCEEDED expone outputPath', 'muse-spark-1.2-contributor', 'DETENTE'
    ];
    for (const text of requiredStrings) expect(prompt).toContain(text);

    expect(prompt).not.toMatch(/GET \/(?:api\/v1\/)?opportunities\s*(?:`|$)/m);
  });

  it('keeps every cited HTTP route attached to a literal backend route', () => {
    const cited = extractCitedRoutes(readFileSync(promptPath, 'utf8'));
    const registered = registeredRoutes();
    expect(cited.length).toBeGreaterThan(0);
    for (const route of cited) {
      expect(
        registered.some(candidate => routeMatches(route, candidate)),
        `${route.method.toUpperCase()} ${route.path} is not registered`
      ).toBe(true);
    }
  });

  it('rejects an invented route in the matcher', () => {
    const invented = { method: 'get', path: '/api/v1/opportunities/:id/invented' };
    expect(registeredRoutes().some(route => routeMatches(invented, route))).toBe(false);
  });
});