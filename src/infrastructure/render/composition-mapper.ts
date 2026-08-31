import { escapeHtml } from './composition-utils.js';
import type { StoryboardSegment } from '../../domain/storyboard.js';

export type CompositionCriterion = 'transformation' | 'relation' | 'sequence' | 'hero' | 'chaos' | 'fallback';

const STOPWORDS = new Set([
  'este', 'esta', 'esto', 'esa', 'eso', 'para', 'pero', 'como', 'cuando', 'desde',
  'hasta', 'entre', 'todos', 'todas', 'también', 'porque', 'siendo', 'sobre', 'ante',
  'tras', 'durante', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'del', 'al', 'el', 'la',
  'que', 'con', 'por', 'sin', 'más', 'muy', 'ya', 'se', 'su', 'sus', 'le', 'les'
]);

// Truncate helpers (NIT: badge ≤3 words / ≤24 chars).
export function truncateWords(text: string, maxWords: number, maxChars: number, ellipsis = '…'): string {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length <= maxWords && text.length <= maxChars) return text.trim();
  let result = '';
  for (const word of words) {
    if (result.split(/\s+/).length >= maxWords) break;
    const candidate = result.length === 0 ? word : `${result} ${word}`;
    if (candidate.length > maxChars) break;
    result = candidate;
  }
  if (!result) result = text.slice(0, maxChars);
  return result.trimEnd() + ellipsis;
}

export function truncateChars(text: string, maxChars: number, ellipsis = '…'): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - ellipsis.length).trimEnd() + ellipsis;
}

export function accentWord(text: string): string | null {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  for (const raw of words) {
    const word = raw.replace(/^[^A-Za-zÁÉÍÓÚáéíóúÑñÜü]+|[^A-Za-zÁÉÍÓÚáéíóúÑñÜü]+$/g, '');
    if (word.length < 5) continue;
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    return word;
  }
  return null;
}

export interface SegmentSlots {
  criterion: CompositionCriterion;
  slots: Record<string, string>;
}

export function classifySegment(segment: StoryboardSegment): CompositionCriterion {
  return mapSegmentToSlots(segment).criterion;
}

export function mapSegmentToSlots(segment: StoryboardSegment): SegmentSlots {
  const { visualRepresentation, audiovisualMapping } = segment;
  const haystack = `${visualRepresentation} ${audiovisualMapping.correspondence} ${audiovisualMapping.narrativeMeaning}`.toLowerCase();
  // Badge: narrativeMeaning ≤3 palabras / ≤24 chars — uniform across all criteria.
  const badge = escapeHtml(truncateWords(audiovisualMapping.narrativeMeaning, 3, 24));

  // 1. transformation
  const transformMatch = extractTransformation(visualRepresentation);
  if (transformMatch) return { criterion: 'transformation', slots: { ...transformMatch, 'content.badge': badge } };

  // 2. relation
  const relationMatch = extractRelation(visualRepresentation, haystack);
  if (relationMatch) return { criterion: 'relation', slots: { ...relationMatch, 'content.badge': badge } };

  // 3. sequence
  const sequenceMatch = extractSequence(visualRepresentation, haystack);
  if (sequenceMatch) return { criterion: 'sequence', slots: { ...sequenceMatch, 'content.badge': badge } };

  // 4. hero
  const heroMatch = extractHero(visualRepresentation);
  if (heroMatch) return { criterion: 'hero', slots: { ...heroMatch, 'content.badge': badge } };

  // 5. chaos
  const chaosMatch = extractChaos(visualRepresentation);
  if (chaosMatch) return { criterion: 'chaos', slots: { ...chaosMatch, 'content.badge': badge } };

  // 6. fallback (exhaustivo)
  return { criterion: 'fallback', slots: buildFallback(visualRepresentation, audiovisualMapping.narrativeMeaning) };
}

function extractTransformation(text: string): Record<string, string> | null {
  // Marker: →/->/⇒ or "se convierte en" / "se transforma en"
  const arrowMatch = text.match(/^(.*?)\s*(?:→|->|⇒|se convierte en|se transforma en)\s*(.*)$/i);
  if (!arrowMatch) return null;
  const rawEntrada = arrowMatch[1].trim();
  const rawSalida = arrowMatch[2].trim();
  const entrada = truncateWords(rawEntrada, 5, 48);
  const salida = truncateChars(truncateWords(rawSalida, 7, 48), 48);
  if (!entrada || !salida) return null;
  return { 'content.entrada': escapeHtml(entrada), 'content.salida': escapeHtml(salida) };
}

function extractRelation(text: string, haystack: string): Record<string, string> | null {
  if (!/se relaciona (con|a)|se conecta (con|a)|vinculad[oa] (a|con)|relacionad[oa] (a|con)|nodo central/.test(haystack)) return null;
  const match = text.match(/^(.*?)\s+(?:se relaciona (?:con|a)|se conecta (?:con|a)|vinculad[oa] (?:a|con)|relacionad[oa] (?:a|con))\s+(.*)$/i);
  if (!match) return null;
  const centerTitle = truncateWords(match[1].trim(), 4, 48);
  const sidesRaw = match[2];
  // Split sides by connector words
  const items = sidesRaw.split(/\s+(?:con|a|y|,)\s+/).map(s => s.trim()).filter(s => s.length > 0);
  if (items.length < 2) return null; // AMBOS laterales obligatorios
  const sideLeft = truncateWords(items[0], 4, 48);
  const sideRight = truncateWords(items[1], 4, 48);
  return { 'content.centerTitle': escapeHtml(centerTitle), 'content.sideLeft': escapeHtml(sideLeft), 'content.sideRight': escapeHtml(sideRight) };
}

function extractSequence(text: string, haystack: string): Record<string, string> | null {
  // ≥2 markers: 1) 2. etc, or "paso N", or ordinal words
  const numberedSteps = text.match(/(?:\d{1,2}\s*[.)])\s*/g);
  const pasoSteps = text.match(/(?:paso\s+\d+)/gi);
  const ordinalSteps = text.match(/(?:primero|segundo|tercero|cuarto|quinto)/gi);

  let split: string[] = [];
  if (numberedSteps && numberedSteps.length >= 2) {
    const regex = /(\d{1,2}\s*[.)]\s*)/g;
    split = text.split(regex).filter(s => s.trim().length > 0 && !/^\d{1,2}\s*[.)]\s*$/.test(s));
  } else if (pasoSteps && pasoSteps.length >= 2) {
    const regex = /(paso\s+\d+)/gi;
    split = text.split(regex).filter(s => s.trim().length > 0 && !/^paso\s+\d+$/i.test(s.trim()));
  } else if (ordinalSteps && ordinalSteps.length >= 2) {
    const regex = /(primero|segundo|tercero|cuarto|quinto)/gi;
    split = text.split(regex).filter(s => s.trim().length > 0 && !/^(primero|segundo|tercero|cuarto|quinto)$/i.test(s.trim()));
  }

  if (split.length < 2) return null; // <2 pasos → fallback

  const steps = split.slice(0, 5).map(s => truncateChars(truncateWords(s.trim(), 6, 24), 24));
  const stepsHtml = steps.map((label, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `<div class="step"><div class="step__num">${num}</div><div class="step__label">${escapeHtml(label)}</div></div>`;
  }).join('');
  return { 'content.steps': stepsHtml };
}

function extractHero(text: string): Record<string, string> | null {
  // (a) Acrónimo único standalone [A-Z]{2,6}(-[A-Z]{2,4})? present ONCE
  const acronymMatches = text.match(/(?<![A-Za-z])[A-Z]{2,6}(?:-[A-Z]{2,4})?(?![A-Z])/g);
  const singleAcronym = acronymMatches && acronymMatches.length === 1 ? acronymMatches[0] : null;

  // (b) Hero data: single match of number+unit
  const dataMatch = text.match(/([+-]?\d{1,3}(?:[.,]\d{1,2})?)\s*(%|×|x|veces|años|días|meses|MF|M€|€|\$|K|M|W)\b/i);
  const allDataMatches = text.match(/([+-]?\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|×|x|veces|años|días|meses|MF|M€|€|\$|K|M|W)\b/gi);
  const singleData = dataMatch && allDataMatches && allDataMatches.length === 1 ? dataMatch : null;

  let char: string;
  let label: string;

  // (a) wins if both exist
  if (singleAcronym) {
    const expansionMatch = text.match(/\(([^()]{2,80})\)/);
    char = singleAcronym;
    label = expansionMatch ? truncateChars(expansionMatch[1].trim(), 60) : '';
  } else if (singleData) {
    char = `${singleData[1]}${singleData[2]}`;
    // 2 words before
    const beforeText = text.slice(0, singleData.index).trim();
    const beforeWords = beforeText.split(/\s+/).filter(w => w.length > 0).slice(-2);
    label = beforeWords.join(' ');
  } else {
    return null;
  }

  // Build content.letters: the letters block renders one .letter with char + optional label.
  // This is the slot consumed by {{content.letters}} in the template's letters block.
  const escapedChar = escapeHtml(char);
  const letterHtml = label
    ? `<div class="letter"><span class="letter__char">${escapedChar}</span><div class="letter__underline"></div><span class="letter__label">${escapeHtml(label)}</span></div>`
    : `<div class="letter"><span class="letter__char">${escapedChar}</span></div>`;
  return { 'content.letters': letterHtml };
}

function extractChaos(text: string): Record<string, string> | null {
  const problemTerms = /desorden|caos|problema|desorganizad|fragmentad|desarticulad|tensión/;
  const solutionTerms = /solución|resolución|resuelv|orden|organizad/;

  if (!problemTerms.test(text) || !solutionTerms.test(text)) return null;

  // Fragmento problema = texto antes del término de resolución
  const solutionMatch = text.match(solutionTerms);
  if (!solutionMatch || solutionMatch.index === undefined) return null;
  const problemText = text.slice(0, solutionMatch.index).trim();

  // Chips: hasta 3 ítems split por ;, y, \n
  const chips = problemText.split(/(?:;|,|\s+y\s+|\n)/).map(s => s.trim()).filter(s => s.length > 0).slice(0, 3);
  if (chips.length === 0) return null;

  const positions = [
    { top: '0px', left: '30px', rotate: '-6deg' },
    { top: '55px', left: '150px', rotate: '4deg' }
  ];
  const chipHtml = chips.map((chip, i) => {
    const truncated = truncateChars(chip, 14);
    const pos = positions[i] ?? { top: `${i * 40}px`, left: '60px', rotate: '2deg' };
    const style = `top:${pos.top}; left:${pos.left}; transform:rotate(${pos.rotate});`;
    return `<span class="chip" style="${style}">${escapeHtml(truncated)}</span>`;
  }).join('');

  const symbolHtml = `<span class="chaos-symbol" style="top:35px; left:110px;">&times;</span>`;
  return { 'content.chips': chipHtml + symbolHtml };
}

function buildFallback(visualRepresentation: string, narrativeMeaning: string): Record<string, string> {
  // Escape first, then inject the synthetic <span class="accent"> on the escaped text.
  const heading = escapeHtml(truncateChars(truncateWords(visualRepresentation, 9, 120), 120));
  const accent = accentWord(visualRepresentation);
  const headingHtml = accent
    ? heading.replace(escapeHtml(accent), `<span class="accent">${escapeHtml(accent)}</span>`)
    : heading;
  // Badge: narrativeMeaning ≤3 palabras / ≤24 chars
  const badge = truncateWords(narrativeMeaning, 3, 24);
  return { 'content.heading': headingHtml, 'content.badge': escapeHtml(badge) };
}
