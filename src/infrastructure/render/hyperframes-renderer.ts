import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { RenderEnvironmentError, RenderSpecificationError, RenderUnclassifiedError } from '../../domain/errors.js';
import type { RenderCliRequest, RenderCliResult, VideoRenderer } from '../../domain/render.js';
import type { VoiceSynthesizer } from '../../domain/render.js';

/*
 * Flags verified against the pinned binary `hyperframes 0.8.12` (`--help`,
 * checked during construction, 2026-08-23):
 *   render [DIR] --output <path> --fps <integer> --format mp4
 *   lint [DIR]
 *   check [DIR]
 * There is no `doctor` subcommand in 0.8.12 (probed and skipped gracefully).
 * Stage dimensions travel inside the composition HTML (data-width/data-height),
 * so no dimension flags are needed here.
 */
export const HYPERFRAMES_PACKAGE_VERSION = '0.8.12';
export const RENDER_CLI_FLAGS = ['render <dir>', '--output <path>', '--fps <int>', '--format mp4'] as const;

const ENVIRONMENT_PATTERNS = /ENOENT|EACCES|ENOSPC|ECONN|chrome|puppeteer|memory/i;
const EXCERPT_LIMIT = 4000;

export interface CliOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal?: string;
  timedOut?: boolean;
  spawnError?: string;
}

export type CliRunner = (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<CliOutcome>;

function defaultCliRunner(command: string, args: string[], options?: { timeoutMs?: number }): Promise<CliOutcome> {
  return new Promise(resolvePromise => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { shell: false });
    } catch (error) {
      resolvePromise({ exitCode: null, stdout: '', stderr: '', spawnError: String(error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = options?.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : undefined;
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => { if (timer) clearTimeout(timer); resolvePromise({ exitCode: null, stdout, stderr, spawnError: String(error) }); });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ exitCode: code, stdout, stderr, ...(signal ? { signal } : {}), ...(timedOut ? { timedOut: true } : {}) });
    });
  });
}

export interface HyperframesCliRendererOptions {
  /** Injectable for deterministic tests; defaults to a real no-shell spawner. */
  run?: CliRunner;
  binaryPath?: string;
  ffmpegCommand?: string;
  ffprobeCommand?: string;
  timeoutMs?: number;
  /** Delegated preflight for TTS voice availability. */
  synthesizer?: VoiceSynthesizer;
}

/**
 * Adapter over the official Hyperframes CLI as a controlled subprocess.
 * Deterministic classification of every failure mode:
 * - SPECIFICATION: lint/check reject the composition as defined.
 * - ENVIRONMENT: missing engine dependencies, timeouts, signals, or closed
 *   environment patterns in the raw output.
 * - UNCLASSIFIED: anything else reaches the operator raw, both paths visible.
 */
export class HyperframesCliRenderer implements VideoRenderer {
  private readonly run: CliRunner;
  private readonly binaryPath: string;
  private readonly ffmpegCommand: string;
  private readonly ffprobeCommand: string;
  private readonly timeoutMs: number;
  private readonly synthesizer?: VoiceSynthesizer;

  constructor(options: HyperframesCliRendererOptions = {}) {
    this.run = options.run ?? defaultCliRunner;
    this.binaryPath = options.binaryPath ?? 'node_modules/.bin/hyperframes';
    this.ffmpegCommand = options.ffmpegCommand ?? 'ffmpeg';
    this.ffprobeCommand = options.ffprobeCommand ?? 'ffprobe';
    this.timeoutMs = options.timeoutMs ?? Number(process.env.CLIPLAB_RENDER_TIMEOUT_MS ?? 600000);
    this.synthesizer = options.synthesizer;
  }

  async version(): Promise<string> {
    const outcome = await this.run(this.binaryPath, ['--version']);
    return outcome.stdout.trim() || HYPERFRAMES_PACKAGE_VERSION;
  }

  async preflight(): Promise<void> {
    const ffmpeg = await this.run(this.ffmpegCommand, ['-version'], { timeoutMs: 30000 });
    if (ffmpeg.spawnError || ffmpeg.exitCode !== 0) {
      throw new RenderEnvironmentError('FFmpeg is required by the render engine but is not available', {
        check: 'ffmpeg -version',
        suggestedAction: 'Install FFmpeg and ensure it is on PATH',
        rawExcerpt: this.excerpt(ffmpeg)
      });
    }
    if (this.synthesizer) await this.synthesizer.preflight();
    await this.doctorIfAvailable();
  }

  /** `doctor` does not exist in some versions (e.g. 0.8.12): probed and skipped. */
  private async doctorIfAvailable(): Promise<void> {
    const outcome = await this.run(this.binaryPath, ['doctor'], { timeoutMs: 60000 });
    if (outcome.exitCode === 0) return;
    const unknownCommand = /unknown|unrecognized|not a (recognized )?command|invalid command/i.test(`${outcome.stderr}\n${outcome.stdout}`);
    if (!unknownCommand) {
      throw new RenderEnvironmentError('Render engine self-check (doctor) failed', {
        check: `${this.binaryPath} doctor`,
        suggestedAction: 'Inspect the engine diagnostics below; the environment is not ready',
        rawExcerpt: this.excerpt(outcome)
      });
    }
  }

  async lint(compositionDir: string): Promise<void> {
    await this.validateSubcommand('lint', compositionDir);
  }

  async check(compositionDir: string): Promise<void> {
    await this.validateSubcommand('check', compositionDir);
  }

  private async validateSubcommand(subcommand: 'lint' | 'check', compositionDir: string): Promise<void> {
    const outcome = await this.run(this.binaryPath, [subcommand, compositionDir], { timeoutMs: this.timeoutMs });
    if (outcome.timedOut) throw new RenderEnvironmentError(`Engine ${subcommand} timed out after ${this.timeoutMs}ms`, { cause: 'TIMEOUT' });
    if (outcome.spawnError) throw new RenderEnvironmentError(`Engine ${subcommand} could not start: ${outcome.spawnError}`, {});
    if (outcome.signal) throw new RenderEnvironmentError(`Engine ${subcommand} was killed by signal ${outcome.signal}`, {});
    if (outcome.exitCode === 0) return;
    throw new RenderSpecificationError(
      `The composition as defined fails engine validation (${subcommand}): it cannot be rendered as specified`,
      { validatorFindings: this.excerpt(outcome) }
    );
  }

  async render(request: RenderCliRequest): Promise<RenderCliResult> {
    const args = ['render', request.compositionDir, '--output', request.outputPath, '--fps', String(request.fps), '--format', 'mp4'];
    const outcome = await this.run(this.binaryPath, args, { timeoutMs: this.timeoutMs });
    if (outcome.timedOut) throw new RenderEnvironmentError(`Render timed out after ${this.timeoutMs}ms and was terminated`, { cause: 'TIMEOUT', suggestedAction: 'Verify machine resources or raise CLIPLAB_RENDER_TIMEOUT_MS, then retry from the operator endpoint' });
    if (outcome.spawnError) throw new RenderEnvironmentError(`The render engine could not be started: ${outcome.spawnError}`, { suggestedAction: 'Verify the pinned hyperframes dependency is installed' });
    if (outcome.signal) throw new RenderEnvironmentError(`The render process was killed by signal ${outcome.signal}`, { suggestedAction: 'Check machine resources, then retry from the operator endpoint' });
    if (outcome.exitCode !== 0) this.classifyFailure(outcome);
    const durationSeconds = await this.measureDuration(request.outputPath);
    return { outputPath: request.outputPath, durationSeconds };
  }

  /** Closed heuristic over raw output; everything else stays UNCLASSIFIED. */
  private classifyFailure(outcome: CliOutcome): never {
    const combined = `${outcome.stderr}\n${outcome.stdout}`;
    const matched = ENVIRONMENT_PATTERNS.exec(combined);
    if (matched) {
      throw new RenderEnvironmentError(`Render failed with an environment-related error (matched ${matched[0]})`, {
        suggestedAction: 'Fix the environment condition and retry from the operator endpoint',
        rawExcerpt: this.excerpt(outcome)
      });
    }
    throw new RenderUnclassifiedError(
      'The render failed for a reason the system could not classify: decide between retrying or returning to storyboard',
      {
        rawLog: this.excerpt(outcome),
        suggestedActions: [
          'Retry production once the environment has been verified (operator retry endpoint)',
          'Return to storyboard: correct the storyboard and request explicit reapproval before rendering again'
        ]
      }
    );
  }

  private async measureDuration(path: string): Promise<number> {
    const outcome = await this.run(this.ffprobeCommand, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path], { timeoutMs: 60000 });
    if (outcome.exitCode !== 0 || outcome.spawnError) throw new RenderEnvironmentError(`Rendered output duration could not be measured for ${path}`, { rawExcerpt: this.excerpt(outcome) });
    const parsed = JSON.parse(outcome.stdout) as { format?: { duration?: string } };
    const duration = Number(parsed.format?.duration);
    if (!Number.isFinite(duration)) throw new RenderEnvironmentError(`Measured render duration is not finite for ${path}`);
    return duration;
  }

  private excerpt(outcome: CliOutcome): string {
    return `${outcome.stderr}\n${outcome.stdout}`.trim().slice(0, EXCERPT_LIMIT);
  }
}
