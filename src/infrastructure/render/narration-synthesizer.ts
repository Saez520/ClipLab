import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RenderEnvironmentError, RenderSpecificationError } from '../../domain/errors.js';
import {
  MAX_NARRATION_BISECTION_PASSES,
  MAX_NARRATION_GAP_SECONDS,
  MAX_NARRATION_RATE_WPM,
  MIN_NARRATION_RATE_WPM,
  type VoiceSynthesis,
  type VoiceSynthesizer
} from '../../domain/render.js';

export type CommandRunner = (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<{ stdout: string; stderr: string }>;

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

function defaultRun(command: string, args: string[], options?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new RenderEnvironmentError(`Command ${command} timed out`, { command, args }));
    }, options?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => { clearTimeout(timer); rejectPromise(new RenderEnvironmentError(`Command ${command} could not be executed: ${String(error)}`, { command, args })); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new RenderEnvironmentError(`Command ${command} exited with code ${code}: ${stderr.slice(0, 400)}`, { command, args, exitCode: code }));
    });
  });
}

/**
 * Splits an override command line into argv-style tokens WITHOUT a shell:
 * quotes group characters into single tokens and are stripped; every other
 * character is literal. Shell operators and expansions ($(), backticks, ;, |,
 * >) are ordinary characters and are NEVER interpreted, so narration text can
 * not escape its argument position. Unterminated quotes are rejected.
 */
export function tokenizeCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(token);
        token = '';
        started = false;
      }
    } else {
      token += char;
      started = true;
    }
  }
  if (quote) throw new RenderEnvironmentError(`CLIPLAB_TTS_COMMAND contains an unterminated ${quote} quote`, { command: line });
  if (started) tokens.push(token);
  return tokens;
}

/** Placeholder substitution as literal argv values (never shell-interpolated). */
function substitutePlaceholders(token: string, text: string, outputPath: string): string {
  return token.replaceAll('{input}', text).replaceAll('{output}', outputPath);
}

export interface MacosSayVoiceSynthesizerOptions {
  /** Injectable for deterministic tests; defaults to a real no-shell spawner. */
  run?: CommandRunner;
  sayCommand?: string;
  ffmpegCommand?: string;
  ffprobeCommand?: string;
  /**
   * Full CLIPLAB_TTS_COMMAND override with {input}/{output} placeholders.
   * Split into command+args with tokenizeCommandLine and executed WITHOUT a
   * shell: {input}/{output} become literal argv values, so pipes, redirections
   * and command substitution are neither supported nor interpreted.
   */
  ttsCommandOverride?: string;
  voiceLocalePrefix?: string;
  commandTimeoutMs?: number;
}

/**
 * Offline macOS narration synthesis via `say` with bounded bisection rate search:
 * starts at MIN_NARRATION_RATE_WPM (most natural) and only speeds up via
 * deterministic bisection when the text exceeds the approved slot. A hard cap
 * (MAX_NARRATION_RATE_WPM) prevents the incomprehensible rates produced by the
 * old proportional over-compression; when the text cannot fit at or below the
 * cap it fails cleanly with RenderSpecificationError. Audio is never trimmed
 * and approved slots are never altered. Output normalized to 48kHz stereo WAV.
 */
export class MacosSayVoiceSynthesizer implements VoiceSynthesizer {
  private readonly run: CommandRunner;
  private readonly sayCommand: string;
  private readonly ffmpegCommand: string;
  private readonly ffprobeCommand: string;
  private readonly ttsCommandOverride?: string;
  private readonly voiceLocalePrefix: string;
  private readonly commandTimeoutMs: number;

  constructor(options: MacosSayVoiceSynthesizerOptions = {}) {
    this.run = options.run ?? defaultRun;
    this.sayCommand = options.sayCommand ?? 'say';
    this.ffmpegCommand = options.ffmpegCommand ?? 'ffmpeg';
    this.ffprobeCommand = options.ffprobeCommand ?? 'ffprobe';
    this.ttsCommandOverride = options.ttsCommandOverride ?? process.env.CLIPLAB_TTS_COMMAND;
    this.voiceLocalePrefix = options.voiceLocalePrefix ?? 'es';
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  }

  /** Detects an installed Spanish voice; absence is an actionable ENVIRONMENT failure. */
  async preflight(): Promise<void> {
    if (this.ttsCommandOverride) {
      // A custom TTS command replaces the whole pipeline; its availability is
      // verified by executing it during the first render attempt.
      return;
    }
    try {
      const { stdout } = await this.run(this.sayCommand, ['-v', '?'], { timeoutMs: this.commandTimeoutMs });
      const hasSpanishVoice = stdout.split(/\r?\n/).some(line => new RegExp(`\\b${this.voiceLocalePrefix}[-_][A-Za-z]{2}\\b`).test(line));
      if (!hasSpanishVoice) throw new Error('no spanish voice');
    } catch {
      throw new RenderEnvironmentError(
        'No Spanish TTS voice is installed for offline narration synthesis',
        {
          check: `${this.sayCommand} -v ? | grep es_`,
          suggestedAction: 'Install a Spanish voice (macOS Settings > Accessibility > Spoken Content > System Voice) or set CLIPLAB_TTS_COMMAND to an alternative synthesizer supporting {input} and {output} placeholders'
        }
      );
    }
  }

  async synthesize(text: string, targetDurationSeconds: number, outputDir?: string): Promise<VoiceSynthesis> {
    if (!(text?.trim())) throw new RenderSpecificationError('Narration text is empty', { segmentText: text, slotSeconds: targetDurationSeconds });
    if (!(targetDurationSeconds > 0)) throw new RenderSpecificationError(`Approved narration slot must be positive, got ${targetDurationSeconds}`, { segmentText: text, slotSeconds: targetDurationSeconds });

    const dir = outputDir ?? join(process.env.CLIPLAB_DATA_DIR ?? './data', 'narration-tmp');
    mkdirSync(dir, { recursive: true });
    const stem = `narration-${createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16)}`;

    // When a TTS command override is active it replaces the whole synthesis
    // pipeline — including rate adaptation, which the override does not support.
    // Synthesize once and check the result directly against the slot.
    if (this.ttsCommandOverride) {
      return this.synthesizeOnceWithOverride(text, targetDurationSeconds, dir, stem);
    }

    // Native `say` pipeline: bounded bisection rate search. Start at the slowest
    // rate (most natural narration); only speed up when the text exceeds the
    // approved slot. A hard cap (MAX_NARRATION_RATE_WPM) replaces the old
    // proportional over-compression that produced 345–438 WPM. When the text
    // cannot fit at or below the cap, or leaves a gap larger than
    // MAX_NARRATION_GAP_SECONDS, fail cleanly.
    const intermediates: string[] = [];
    let lastIntermediate = '';
    let producedSeconds = 0;

    // Pass 1: slowest rate — if it fits with an acceptable gap, we are done.
    let passIndex = 1;
    lastIntermediate = join(dir, `${stem}-p${passIndex}.aiff`);
    intermediates.push(lastIntermediate);
    await this.synthesizeOnce(text, MIN_NARRATION_RATE_WPM, lastIntermediate);
    producedSeconds = await this.measureDuration(lastIntermediate);

    if (producedSeconds > targetDurationSeconds) {
      // Text exceeds the slot even at the slowest rate: bisect upward to find
      // the lowest rate that fits, capped at MAX_NARRATION_RATE_WPM.
      let lo = MIN_NARRATION_RATE_WPM;
      let hi = MAX_NARRATION_RATE_WPM;
      let bestRate = MAX_NARRATION_RATE_WPM;
      let bestProduced = producedSeconds;
      let bestIntermediate = lastIntermediate;
      while (lo <= hi && passIndex < MAX_NARRATION_BISECTION_PASSES) {
        passIndex += 1;
        const mid = Math.floor((lo + hi) / 2);
        const candidate = join(dir, `${stem}-p${passIndex}.aiff`);
        intermediates.push(candidate);
        await this.synthesizeOnce(text, mid, candidate);
        const candidateSeconds = await this.measureDuration(candidate);
        if (candidateSeconds <= targetDurationSeconds) {
          // Fits: this rate is viable; remember it and try to go slower.
          bestRate = mid;
          bestProduced = candidateSeconds;
          bestIntermediate = candidate;
          hi = mid - 1;
        } else {
          // Still too long: need a faster rate.
          lo = mid + 1;
        }
      }
      if (bestProduced > targetDurationSeconds) {
        for (const intermediate of intermediates) rmSync(intermediate, { force: true });
        throw new RenderSpecificationError(
          `Narration exceeds the approved slot even at ${MAX_NARRATION_RATE_WPM} WPM: the approved slot does not admit its text`,
          { segmentText: text, slotSeconds: targetDurationSeconds, producedSeconds: bestProduced }
        );
      }
      // Verify the gap at the lowest viable rate is acceptable.
      const gap = targetDurationSeconds - bestProduced;
      if (gap > MAX_NARRATION_GAP_SECONDS) {
        for (const intermediate of intermediates) rmSync(intermediate, { force: true });
        throw new RenderSpecificationError(
          `Narration leaves an unacceptable silence gap (${gap.toFixed(2)}s > ${MAX_NARRATION_GAP_SECONDS}s) at the lowest viable rate (${bestRate} WPM)`,
          { segmentText: text, slotSeconds: targetDurationSeconds, producedSeconds: bestProduced }
        );
      }
      lastIntermediate = bestIntermediate;
      producedSeconds = bestProduced;
    } else {
      // Fits at the slowest rate: verify the gap is acceptable.
      const gap = targetDurationSeconds - producedSeconds;
      if (gap > MAX_NARRATION_GAP_SECONDS) {
        for (const intermediate of intermediates) rmSync(intermediate, { force: true });
        throw new RenderSpecificationError(
          `Narration leaves an unacceptable silence gap (${gap.toFixed(2)}s > ${MAX_NARRATION_GAP_SECONDS}s) even at the slowest rate (${MIN_NARRATION_RATE_WPM} WPM)`,
          { segmentText: text, slotSeconds: targetDurationSeconds, producedSeconds }
        );
      }
    }

    const wavPath = join(dir, `${stem}.wav`);
    await this.run(this.ffmpegCommand, ['-y', '-i', lastIntermediate, '-ar', '48000', '-ac', '2', wavPath], { timeoutMs: this.commandTimeoutMs });
    const wavSeconds = await this.measureDuration(wavPath);
    for (const intermediate of intermediates) rmSync(intermediate, { force: true });
    return { filePath: wavPath, durationSeconds: wavSeconds };
  }

  /**
   * Multi-pass synthesis path for the TTS command override. The override
   * replaces the whole pipeline — including rate adaptation, which it does not
   * support — so each pass synthesizes at a fixed rate and the loop simply
   * looks for a pass that fits the slot. The override's semantics (no shell,
   * {input}/{output} placeholders, multi-pass retry) are preserved unchanged.
   */
  private async synthesizeOnceWithOverride(text: string, targetDurationSeconds: number, dir: string, stem: string): Promise<VoiceSynthesis> {
    const intermediates: string[] = [];
    let lastIntermediate = '';
    let producedSeconds = 0;
    for (let pass = 1; pass <= MAX_NARRATION_BISECTION_PASSES; pass += 1) {
      lastIntermediate = join(dir, `${stem}-p${pass}.aiff`);
      intermediates.push(lastIntermediate);
      await this.synthesizeOnce(text, MIN_NARRATION_RATE_WPM, lastIntermediate);
      producedSeconds = await this.measureDuration(lastIntermediate);
      if (producedSeconds <= targetDurationSeconds) break;
    }
    if (producedSeconds > targetDurationSeconds) {
      for (const intermediate of intermediates) rmSync(intermediate, { force: true });
      throw new RenderSpecificationError(
        `Narration exceeds the approved slot: the approved slot does not admit its text`,
        { segmentText: text, slotSeconds: targetDurationSeconds, producedSeconds }
      );
    }
    const wavPath = join(dir, `${stem}.wav`);
    await this.run(this.ffmpegCommand, ['-y', '-i', lastIntermediate, '-ar', '48000', '-ac', '2', wavPath], { timeoutMs: this.commandTimeoutMs });
    const wavSeconds = await this.measureDuration(wavPath);
    for (const intermediate of intermediates) rmSync(intermediate, { force: true });
    return { filePath: wavPath, durationSeconds: wavSeconds };
  }

  private async synthesizeOnce(text: string, rate: number, outputPath: string): Promise<void> {
    if (this.ttsCommandOverride) {
      // No shell anywhere: the override template is split into argv tokens and
      // {input}/{output} are substituted as literal arguments. Metacharacters
      // in the narration text ($(), backticks, ;, |, >) therefore reach the
      // synthesizer as inert data instead of being interpreted by /bin/sh.
      const tokens = tokenizeCommandLine(this.ttsCommandOverride);
      const command = substitutePlaceholders(tokens[0] ?? '', text, outputPath);
      if (!command) {
        throw new RenderEnvironmentError('CLIPLAB_TTS_COMMAND override does not contain a command', { command: this.ttsCommandOverride });
      }
      const args = tokens.slice(1).map(token => substitutePlaceholders(token, text, outputPath));
      await this.run(command, args, { timeoutMs: this.commandTimeoutMs });
      return;
    }
    await this.run(this.sayCommand, ['-v', await this.spanishVoice(), '-r', String(rate), '-o', outputPath, text], { timeoutMs: this.commandTimeoutMs });
  }

  private async measureDuration(path: string): Promise<number> {
    const { stdout } = await this.run(this.ffprobeCommand, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path], { timeoutMs: this.commandTimeoutMs });
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    const duration = Number(parsed.format?.duration);
    if (!Number.isFinite(duration)) throw new RenderEnvironmentError(`Measured narration duration is not finite for ${path}`);
    return duration;
  }

  private cachedSpanishVoice?: string;

  private async spanishVoice(): Promise<string> {
    if (this.cachedSpanishVoice) return this.cachedSpanishVoice;
    const { stdout } = await this.run(this.sayCommand, ['-v', '?'], { timeoutMs: this.commandTimeoutMs });
    // `say -v ?` lines look like: `Eddy (Español (España)) es_ES    # Hola...`
    // or `Mónica              es_ES    # Hola...`. The voice name may contain
    // spaces and parenthesized display names, so a naive split(/\s+/)[0] would
    // truncate "Eddy (Español (España))" to "Eddy" and resolve to en_GB.
    // Capture the full name up to the locale marker and verify the locale.
    const line = stdout.split(/\r?\n/).find(candidate => new RegExp(`\\b${this.voiceLocalePrefix}[-_][A-Za-z]{2}\\b`).test(candidate));
    if (!line) {
      throw new RenderEnvironmentError(
        'No Spanish TTS voice is installed for offline narration synthesis',
        {
          check: `${this.sayCommand} -v ? | grep es_`,
          suggestedAction: 'Install a Spanish voice or set CLIPLAB_TTS_COMMAND with {input}/{output} placeholders'
        }
      );
    }
    const nameMatch = line.match(new RegExp(`^(.+?)\\s+${this.voiceLocalePrefix}[-_][A-Za-z]{2}\\b`));
    const voiceName = nameMatch?.[1]?.trim();
    if (!voiceName) {
      throw new RenderEnvironmentError(
        'No Spanish TTS voice is installed for offline narration synthesis',
        {
          check: `${this.sayCommand} -v ? | grep es_`,
          suggestedAction: 'Install a Spanish voice or set CLIPLAB_TTS_COMMAND with {input}/{output} placeholders'
        }
      );
    }
    this.cachedSpanishVoice = voiceName;
    return voiceName;
  }
}
