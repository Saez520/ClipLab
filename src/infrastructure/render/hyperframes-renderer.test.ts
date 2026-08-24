import { describe, expect, it } from 'vitest';
import { HyperframesCliRenderer, type CliOutcome, type CliRunner } from './hyperframes-renderer.js';
import { RenderEnvironmentError, RenderSpecificationError, RenderUnclassifiedError } from '../../domain/errors.js';
import type { VoiceSynthesizer } from '../../domain/render.js';

const ok = (stdout = ''): CliOutcome => ({ exitCode: 0, stdout, stderr: '' });
const fail = (stderr: string, stdout = '', exitCode = 1): CliOutcome => ({ exitCode, stdout, stderr });

function runnerFor(outcomes: Record<string, CliOutcome>): { run: CliRunner; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    run: async (command, args) => {
      calls.push({ command, args });
      for (const [key, outcome] of Object.entries(outcomes)) {
        if (command === key || args.includes(key)) return outcome;
      }
      if (outcomes['*']) return outcomes['*'];
      return ok();
    }
  };
}

describe('HyperframesCliRenderer classification contract', () => {
  it('maps lint/check rejection to SPECIFICATION with raw validator findings', async () => {
    const { run } = runnerFor({ lint: fail('composition references missing asset narration/s9.wav', '3 findings') });
    const renderer = new HyperframesCliRenderer({ run, synthesizer: fakeSynthesizer() });
    let error: unknown;
    try { await renderer.lint('/renders/r-1/composition'); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RenderSpecificationError);
    expect((error as RenderSpecificationError).details?.validatorFindings).toContain('missing asset');
  });

  it('maps timeout and spawn errors to ENVIRONMENT', async () => {
    const timedOut: CliRunner = async (command, args) => (args[0] === 'render' ? { exitCode: null, stdout: '', stderr: '', timedOut: true } : ok());
    const rendererTimeout = new HyperframesCliRenderer({ run: timedOut, synthesizer: fakeSynthesizer() });
    await expect(rendererTimeout.render({ compositionDir: '/c', outputPath: '/o.mp4', fps: 30 })).rejects.toMatchObject({
      code: 'RENDER_ENVIRONMENT',
      details: { cause: 'TIMEOUT' }
    });

    const broken: CliRunner = async () => ({ exitCode: null, stdout: '', stderr: '', spawnError: 'spawn node_modules/.bin/hyperframes ENOENT' });
    const rendererBroken = new HyperframesCliRenderer({ run: broken, synthesizer: fakeSynthesizer() });
    await expect(rendererBroken.preflight()).rejects.toBeInstanceOf(RenderEnvironmentError);
  });

  it('maps closed environment patterns in output to ENVIRONMENT and everything else to UNCLASSIFIED with both paths', async () => {
    const enoent = new HyperframesCliRenderer({ run: async (_command, args) => (args[0] === 'render' ? fail('Error: ENOENT no such file chrome binary', '') : ok()), synthesizer: fakeSynthesizer() });
    await expect(enoent.render({ compositionDir: '/c', outputPath: '/o.mp4', fps: 30 })).rejects.toMatchObject({
      code: 'RENDER_ENVIRONMENT',
      details: { rawExcerpt: expect.stringContaining('ENOENT') }
    });

    const unknownCrash = new HyperframesCliRenderer({ run: async (_command, args) => (args[0] === 'render' ? fail('panic: index out of range at encoder.go:412', '') : ok()), synthesizer: fakeSynthesizer() });
    let error: unknown;
    try { await unknownCrash.render({ compositionDir: '/c', outputPath: '/o.mp4', fps: 30 }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RenderUnclassifiedError);
    const unclassified = error as RenderUnclassifiedError;
    expect(unclassified.details?.rawLog).toContain('index out of range');
    expect(unclassified.details?.suggestedActions).toHaveLength(2);
    expect(unclassified.details?.suggestedActions?.[0]).toContain('Retry');
    expect(unclassified.details?.suggestedActions?.[1]).toContain('storyboard');
  });

  it('returns measured duration on success using the verified flags', async () => {
    const { run, calls } = runnerFor({ ffprobe: ok(JSON.stringify({ format: { duration: '90.5' } })) });
    const renderer = new HyperframesCliRenderer({ run, synthesizer: fakeSynthesizer(), ffmpegCommand: 'ffmpeg', ffprobeCommand: 'ffprobe' });
    const result = await renderer.render({ compositionDir: '/renders/r-1/composition', outputPath: '/renders/r-1/output.mp4', fps: 30 });
    expect(result).toEqual({ outputPath: '/renders/r-1/output.mp4', durationSeconds: 90.5 });
    const renderCall = calls.find(call => call.args[0] === 'render');
    expect(renderCall?.args).toEqual(['render', '/renders/r-1/composition', '--output', '/renders/r-1/output.mp4', '--fps', '30', '--format', 'mp4']);
  });

  it('preflight verifies ffmpeg, delegates voice detection, and skips absent doctor gracefully', async () => {
    // doctor is not a subcommand in hyperframes 0.8.12 -> unknown command is skipped.
    const healthy = runnerFor({ doctor: fail('error: unknown command doctor'), '*': ok() });
    const renderer = new HyperframesCliRenderer({ run: healthy.run, synthesizer: fakeSynthesizer() });
    await expect(renderer.preflight()).resolves.toBeUndefined();
    expect(healthy.calls.some(call => call.command === 'ffmpeg')).toBe(true);

    // A failing doctor that IS recognized must block preflight as ENVIRONMENT.
    const sickDoctor = runnerFor({ doctor: fail('engine dependency libfoo missing'), '*': ok() });
    const sickRenderer = new HyperframesCliRenderer({ run: sickDoctor.run, synthesizer: fakeSynthesizer() });
    await expect(sickRenderer.preflight()).rejects.toMatchObject({ code: 'RENDER_ENVIRONMENT', details: { check: expect.stringContaining('doctor') } });

    // Missing ffmpeg blocks before anything else.
    const noFfmpeg = runnerFor({ ffmpeg: fail('command not found', '', 127), '*': ok() });
    const noFfmpegRenderer = new HyperframesCliRenderer({ run: noFfmpeg.run, synthesizer: fakeSynthesizer() });
    await expect(noFfmpegRenderer.preflight()).rejects.toMatchObject({ code: 'RENDER_ENVIRONMENT', details: { check: 'ffmpeg -version' } });

    // Delegated voice preflight failure propagates as ENVIRONMENT.
    const muteSynth: VoiceSynthesizer = {
      preflight: async () => { throw new RenderEnvironmentError('No Spanish TTS voice is installed'); },
      synthesize: async () => ({ filePath: '' })
    };
    const rendererWithMute = new HyperframesCliRenderer({ run: runnerFor({ '*': ok() }).run, synthesizer: muteSynth });
    await expect(rendererWithMute.preflight()).rejects.toMatchObject({ code: 'RENDER_ENVIRONMENT' });
  });
});

function fakeSynthesizer(): VoiceSynthesizer {
  return { preflight: async () => undefined, synthesize: async () => ({ filePath: '/fake.wav', durationSeconds: 1 }) };
}
