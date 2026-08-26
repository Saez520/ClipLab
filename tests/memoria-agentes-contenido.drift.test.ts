import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const skillPath = resolve(root, '.opencode/skills/convenciones-memoria-agentes-contenido/SKILL.md');

const AGENTS = ['director', 'editor', 'guionista', 'sintesis', 'storyboard'];

const SKILL_HOOK = '// Memoria: cargá la skill `convenciones-memoria-agentes-contenido` antes del primer mem_search/mem_save — namespaces propios, un dueño por namespace, proponer antes de guardar, no modificar definiciones vigentes.';

const MINIMAL_RULES = [
  'namespaces propios',
  'un dueño por namespace',
  'proponer antes de guardar',
  'no modificar definiciones vigentes'
];

const AGENT_SECTIONS: Record<string, string[]> = {
  director: [
    '# 1. Identidad', '# 2. Alcance y límites', '# 3. Modelo de decisión',
    '# 4. Contrato conversacional', '# 5. Fuentes y API', '# 6. Delegación',
    '# 7. Flujo', '# 8. Estado y continuidad', '# 9. Fallos',
    '# 10. Contrato de salida', '# 11. Reality filter', '# 12. Restricciones y configurables'
  ],
  editor: [
    '# 1. Identidad', '# 2. Alcance y límites', '# 3. Modelo de decisión',
    '# 4. Contrato conversacional', '# 5. Fuentes y API', '# 6. Delegación',
    '# 7. Flujo', '# 8. Estado y continuidad', '# 9. Fallos',
    '# 10. Contrato de salida', '# 11. Reality filter', '# 12. Restricciones y configurables'
  ],
  guionista: [
    '# 1. Identidad', '# 2. Alcance y límites', '# 3. Recepción del encargo',
    '# 4. Procedimiento de trabajo', '# 5. Escritura y referencias',
    '# 6. Insuficiencia y honestidad', '# 7. Persistencia y API',
    '# 8. Estado y continuidad', '# 9. Fallos', '# 10. Contrato de salida',
    '# 11. Reality filter', '# 12. Restricciones y configurables'
  ],
  sintesis: [
    '# 1. Identidad', '# 2. Alcance y límites', '# 3. Recepción del encargo',
    '# 4. Procedimiento de trabajo', '# 5. Síntesis y formato de salida',
    '# 6. Insuficiencia y honestidad', '# 7. Persistencia y API',
    '# 8. Estado y continuidad', '# 9. Fallos', '# 10. Contrato de salida',
    '# 11. Reality filter', '# 12. Restricciones y configurables'
  ],
  storyboard: [
    '# 1. Identidad', '# 2. Alcance y límites', '# 3. Flujo dual-channel',
    '# 4. Segmentación', '# 5. Fuentes y trazabilidad',
    '# 6. Delegación y recepción por punteros', '# 7. Validación material por segmento',
    '# 8. Estados y FSM', '# 9. API y persistencia',
    '# 10. Aprobación y corrección dirigida', '# 11. Fallos',
    '# 12. AI-Slop Prevention — restricciones y configurables'
  ]
};

describe('convenciones-memoria-agentes-contenido skill', () => {
  it('exists as a portable SKILL.md with the approved frontmatter', () => {
    expect(existsSync(skillPath)).toBe(true);
    const skill = readFileSync(skillPath, 'utf8');
    expect(skill.startsWith('---')).toBe(true);
    expect(skill).toContain('name: convenciones-memoria-agentes-contenido');
    expect(skill).toContain('license: MIT');
    expect(skill).toContain('compatibility: opencode');
    expect(skill).toContain('category: memory');
  });

  it('keeps the four minimal rules from #4187 verbatim', () => {
    const skill = readFileSync(skillPath, 'utf8');
    for (const rule of MINIMAL_RULES) expect(skill).toContain(rule);
  });

  it('documents one owner per namespace for every content role', () => {
    const skill = readFileSync(skillPath, 'utf8');
    const roles = ['director', 'sintesis', 'guionista', 'storyboard', 'editor'];
    for (const role of roles) {
      expect(skill).toContain(`content-agents/${role}/*`);
      expect(skill).toContain(`cliplab-${role}`);
    }
    expect(skill).toContain('content-agents/convenciones/*');
    expect(skill).toContain('Runner');
  });

  it('keeps continuity as a complementary memory layer, not a replacement of the deterministic API', () => {
    const skill = readFileSync(skillPath, 'utf8');
    expect(skill).toContain('soporte determinístico');
    expect(skill).toContain('capa complementaria');
  });

  it('keeps the skill hook in every content agent prompt without altering the vigent definitions', () => {
    for (const agent of AGENTS) {
      const promptPath = resolve(root, `agents/${agent}.md`);
      expect(existsSync(promptPath)).toBe(true);
      const prompt = readFileSync(promptPath, 'utf8');
      expect(prompt).toContain(SKILL_HOOK);
      expect(prompt.startsWith('---')).toBe(false);
      for (const section of AGENT_SECTIONS[agent]) expect(prompt).toContain(section);
    }
  });
});