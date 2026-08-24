import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RenderEnvironmentError, RenderSpecificationError } from '../../domain/errors.js';
import { MAX_RATE_ADAPTATION_PASSES, type VoiceSynthesis, type VoiceSynthesizer } from '../../domain/render.js';

export type CommandRunner = (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<{ stdout: string; stderr: string }>;

const BASE_RATE_WORDS_PER_MINUTE = 175;
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
  baseRateWordsPerMinute?: number;
  commandTimeoutMs?: number;
}

/**
 * Offline macOS narration synthesis via `say` with deterministic adaptive rate:
 * when the natural narration exceeds the approved slot the text is re-synthesized
 * at a proportionally higher rate (bounded passes). Audio is never trimmed and
 * approved slots are never altered. Output normalized to 48kHz stereo WAV.
 */
export class MacosSayVoiceSynthesizer implements VoiceSynthesizer {
  private readonly run: CommandRunner;
  private readonly sayCommand: string;
  private readonly ffmpegCommand: string;
  private readonly ffprobeCommand: string;
  private readonly ttsCommandOverride?: string;
  private readonly voiceLocalePrefix: string;
  private readonly baseRate: number;
  private readonly commandTimeoutMs: number;

  constructor(options: MacosSayVoiceSynthesizerOptions = {}) {
    this.run = options.run ?? defaultRun;
    this.sayCommand = options.sayCommand ?? 'say';
    this.ffmpegCommand = options.ffmpegCommand ?? 'ffmpeg';
    this.ffprobeCommand = options.ffprobeCommand ?? 'ffprobe';
    this.ttsCommandOverride = options.ttsCommandOverride ?? process.env.CLIPLAB_TTS_COMMAND;
    this.voiceLocalePrefix = options.voiceLocalePrefix ?? 'es';
    this.baseRate = options.baseRateWordsPerMinute ?? BASE_RATE_WORDS_PER_MINUTE;
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

    // Deterministic rate adaptation: bounded passes, proportional monotonic
    // speed-up, audio never trimmed, approved slots never altered.
    let rate = this.baseRate;
    let producedSeconds = 0;
    let lastIntermediate = '';
    const intermediates: string[] = [];
    for (let pass = 1; pass <= MAX_RATE_ADAPTATION_PASSES; pass += 1) {
      lastIntermediate = join(dir, `${stem}-p${pass}.aiff`);
      intermediates.push(lastIntermediate);
      await this.synthesizeOnce(text, rate, lastIntermediate);
      producedSeconds = await this.measureDuration(lastIntermediate);
      if (producedSeconds <= targetDurationSeconds) break;
      if (pass < MAX_RATE_ADAPTATION_PASSES) {
        // Deterministic proportional speed-up; strictly monotonic.
        rate = Math.ceil(rate * (producedSeconds / targetDurationSeconds));
      }
    }
    if (producedSeconds > targetDurationSeconds) {
      for (const intermediate of intermediates) rmSync(intermediate, { force: true });
      throw new RenderSpecificationError(
        `Narration exceeds the approved slot even after ${MAX_RATE_ADAPTATION_PASSES} deterministic adaptation passes: the approved slot does not admit its text`,
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
    // `say -v ?` lines look like: `Mónica            es_ES    # Hola...`
    const line = stdout.split(/\r?\n/).find(candidate => new RegExp(`\\b${this.voiceLocalePrefix}[-_][A-Za-z]{2}\\b`).test(candidate));
    const voiceName = line?.trim().split(/\s+/)[0];
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
