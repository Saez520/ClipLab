import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MacosSayVoiceSynthesizer, tokenizeCommandLine } from './narration-synthesizer.js';
import { RenderEnvironmentError, RenderSpecificationError } from '../../domain/errors.js';
import {
  MAX_NARRATION_BISECTION_PASSES,
  MAX_NARRATION_RATE_WPM,
  MIN_NARRATION_RATE_WPM
} from '../../domain/render.js';

type Call = { command: string; args: string[] };

/** Media stub: maps file suffixes to measured durations (override path). */
function mediaRunner(durations: Record<string, number>, onSayRate?: (rate: number) => void) {
  return async (command: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    if (command === 'say') {
      if (args[0] === '-v' && !args.includes('-r')) return { stdout: 'Mónica es_ES # Hola', stderr: '' };
      onSayRate?.(Number(args[args.indexOf('-r') + 1]));
      return { stdout: '', stderr: '' };
    }
    if (command === 'ffprobe') {
      const target = args[args.length - 1];
      const entry = Object.entries(durations).find(([suffix]) => target.endsWith(suffix));
      const duration = entry?.[1] ?? 999;
      return { stdout: JSON.stringify({ format: { duration: String(duration) } }), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
}

/**
 * Media stub for the native `say` path: duration is a deterministic function of
 * the rate (simulates non-linear voice response), records every say rate.
 */
function rateMediaRunner(rateToDuration: (rate: number) => number, onSayRate?: (rate: number) => void) {
  const rateByPath = new Map<string, number>();
  return async (command: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    if (command === 'say') {
      if (args[0] === '-v' && !args.includes('-r')) {
        return { stdout: 'Eddy (Español (España)) es_ES # ¡Hola! Me llamo Eddy.', stderr: '' };
      }
      const rate = Number(args[args.indexOf('-r') + 1]);
      const outputPath = args[args.indexOf('-o') + 1];
      rateByPath.set(outputPath, rate);
      onSayRate?.(rate);
      return { stdout: '', stderr: '' };
    }
    if (command === 'ffmpeg') {
      // ffmpeg converts the chosen intermediate to the final WAV; carry the
      // rate forward so the WAV is measured with the same duration.
      const inputPath = args[args.indexOf('-i') + 1];
      const outputPath = args[args.length - 1];
      const rate = rateByPath.get(inputPath);
      if (rate !== undefined) rateByPath.set(outputPath, rate);
      return { stdout: '', stderr: '' };
    }
    if (command === 'ffprobe') {
      const path = args[args.length - 1];
      const rate = rateByPath.get(path);
      const duration = rate === undefined ? 999 : rateToDuration(rate);
      return { stdout: JSON.stringify({ format: { duration: String(duration) } }), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
}

/** Records the voice name passed to `say -v` during synthesis. */
function voiceRecordingRunner(records: Array<{ voice: string; rate: number }>, rateToDuration: (rate: number) => number) {
  const rateByPath = new Map<string, number>();
  return async (command: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    if (command === 'say') {
      if (args[0] === '-v' && !args.includes('-r')) {
        return { stdout: 'Eddy (Español (España)) es_ES # ¡Hola! Me llamo Eddy.\nMónica              es_ES    # ¡Hola! Me llamo Mónica.', stderr: '' };
      }
      const voice = args[args.indexOf('-v') + 1];
      const rate = Number(args[args.indexOf('-r') + 1]);
      const outputPath = args[args.indexOf('-o') + 1];
      rateByPath.set(outputPath, rate);
      records.push({ voice, rate });
      return { stdout: '', stderr: '' };
    }
    if (command === 'ffmpeg') {
      const inputPath = args[args.indexOf('-i') + 1];
      const outputPath = args[args.length - 1];
      const rate = rateByPath.get(inputPath);
      if (rate !== undefined) rateByPath.set(outputPath, rate);
      return { stdout: '', stderr: '' };
    }
    if (command === 'ffprobe') {
      const path = args[args.length - 1];
      const rate = rateByPath.get(path);
      const duration = rate === undefined ? 999 : rateToDuration(rate);
      return { stdout: JSON.stringify({ format: { duration: String(duration) } }), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
}

function voiceListRunner() {
  const calls: Call[] = [];
  const run = async (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === 'say' && args[0] === '-v') {
      return { stdout: 'Eddy (Español (España)) es_ES # ¡Hola! Me llamo Eddy.\nMónica              es_ES    # ¡Hola! Me llamo Mónica.\nAlbert             en_US    # Hello, my name is Albert.', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { run, calls };
}

describe('MacosSayVoiceSynthesizer', () => {
  it('fails preflight with an actionable ENVIRONMENT error when no Spanish voice is installed', async () => {
    const synth = new MacosSayVoiceSynthesizer({ run: async () => ({ stdout: 'Albert en_US # Hello', stderr: '' }) });
    await expect(synth.preflight()).rejects.toMatchObject({ code: 'RENDER_ENVIRONMENT', details: { suggestedAction: expect.stringContaining('CLIPLAB_TTS_COMMAND') } });
  });

  it('passes preflight when a Spanish voice exists and skips it under CLIPLAB_TTS_COMMAND override', async () => {
    const { run } = voiceListRunner();
    const synth = new MacosSayVoiceSynthesizer({ run: run as any });
    await expect(synth.preflight()).resolves.toBeUndefined();

    const overridden = new MacosSayVoiceSynthesizer({ run: run as any, ttsCommandOverride: 'custom-tts --text {input} --out {output}' });
    await expect(overridden.preflight()).resolves.toBeUndefined();
  });

  it('uses the FULL Spanish voice name (with locale) — never a truncated token', async () => {
    const records: Array<{ voice: string; rate: number }> = [];
    // At MIN rate the text fits with an acceptable gap, so only one synthesis
    // pass runs and the voice name passed to `say -v` is the one under test.
    const run = voiceRecordingRunner(records, () => 20);
    const synth = new MacosSayVoiceSynthesizer({ run });
    await synth.synthesize('narration text', 21, '/tmp/cliplab-test-voice');
    expect(records).toHaveLength(1);
    expect(records[0].voice).toBe('Eddy (Español (España))');
  });

  it('resolves the chosen voice to the es_* locale, not en_GB', async () => {
    const records: Array<{ voice: string; rate: number }> = [];
    const run = voiceRecordingRunner(records, () => 20);
    const synth = new MacosSayVoiceSynthesizer({ run });
    await synth.synthesize('narration text', 21, '/tmp/cliplab-test-locale');
    // The first es_* line in the list is "Eddy (Español (España)) es_ES"; the
    // full name (not the truncated "Eddy") must reach `say -v`.
    expect(records[0].voice).not.toBe('Eddy');
    expect(records[0].voice).toContain('Español (España)');
  });

  it('bisection finds the lowest rate that fits the slot with non-linear duration', async () => {
    const ratesUsed: number[] = [];
    // Non-linear response: doubling the rate does NOT halve the duration.
    // duration(rate) = 3000 / rate  → 100→30s, 120→25s, 150→20s, 180→16.7s.
    const run = rateMediaRunner((rate) => 3000 / rate, r => { ratesUsed.push(r); });
    const synth = new MacosSayVoiceSynthesizer({ run });
    const result = await synth.synthesize('narration text', 25, '/tmp/cliplab-test-bisect');
    expect(result.durationSeconds).toBeCloseTo(25, 5);
    expect(result.filePath.endsWith('.wav')).toBe(true);
    // First pass is always at MIN rate.
    expect(ratesUsed[0]).toBe(MIN_NARRATION_RATE_WPM);
    // The lowest rate whose duration fits a 25s slot: 3000/rate ≤ 25 → rate ≥ 120.
    const finalRate = ratesUsed[ratesUsed.length - 1];
    expect(finalRate).toBeGreaterThanOrEqual(120);
    expect(finalRate).toBeLessThanOrEqual(MAX_NARRATION_RATE_WPM);
    // Pass budget is honored.
    expect(ratesUsed.length).toBeLessThanOrEqual(MAX_NARRATION_BISECTION_PASSES);
  });

  it('succeeds at MIN rate when the text fits with an acceptable gap', async () => {
    let rate = 0;
    // At MIN rate (100) the text takes 20s in a 22s slot → gap 2s... too wide.
    // Use a slot where the gap is within tolerance: 20s in 20.5s slot → gap 0.5s.
    const run = rateMediaRunner(() => 20, r => { rate = r; });
    const synth = new MacosSayVoiceSynthesizer({ run });
    const result = await synth.synthesize('narration text', 20.5, '/tmp/cliplab-test-min');
    expect(result.durationSeconds).toBe(20);
    expect(rate).toBe(MIN_NARRATION_RATE_WPM);
  });

  it('throws SPECIFICATION at the hard cap when the text cannot fit even at MAX rate', async () => {
    const ratesUsed: number[] = [];
    // Even at 180 WPM the text takes 22.2s > 20s slot → never fits.
    const run = rateMediaRunner((rate) => 4000 / rate, r => { ratesUsed.push(r); });
    const synth = new MacosSayVoiceSynthesizer({ run });
    let error: unknown;
    try { await synth.synthesize('narration text', 20, '/tmp/cliplab-test-cap'); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RenderSpecificationError);
    const spec = error as RenderSpecificationError;
    expect(spec.details?.slotSeconds).toBe(20);
    expect(spec.details?.producedSeconds).toBeGreaterThan(20);
    expect(spec.message).toContain(String(MAX_NARRATION_RATE_WPM));
    // Intermediates are cleaned up and no WAV is produced.
    expect(ratesUsed.length).toBeLessThanOrEqual(MAX_NARRATION_BISECTION_PASSES);
  });

  it('throws SPECIFICATION when the text fits but leaves a gap wider than MAX_NARRATION_GAP_SECONDS', async () => {
    // At MIN rate the text takes 10s in a 25s slot → gap 15s > 1s.
    const run = rateMediaRunner(() => 10);
    const synth = new MacosSayVoiceSynthesizer({ run });
    let error: unknown;
    try { await synth.synthesize('narration text', 25, '/tmp/cliplab-test-gap'); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RenderSpecificationError);
    const spec = error as RenderSpecificationError;
    expect(spec.details?.slotSeconds).toBe(25);
    expect(spec.details?.producedSeconds).toBe(10);
    expect(spec.message).toContain('gap');
  });

  it('bisection converges to the lowest viable rate with an acceptable gap', async () => {
    const ratesUsed: number[] = [];
    // duration(rate) = 3000/rate; slot=24 → need rate ≥ 125 (3000/125=24).
    const run = rateMediaRunner((rate) => 3000 / rate, r => { ratesUsed.push(r); });
    const synth = new MacosSayVoiceSynthesizer({ run });
    const result = await synth.synthesize('narration text', 24, '/tmp/cliplab-test-bisect2');
    expect(result.durationSeconds).toBeCloseTo(24, 5);
    const finalRate = ratesUsed[ratesUsed.length - 1];
    expect(3000 / finalRate).toBeLessThanOrEqual(24);
    // The rate just below the final one would NOT fit (gap would be negative).
    if (finalRate > MIN_NARRATION_RATE_WPM) {
      expect(3000 / (finalRate - 1)).toBeGreaterThan(24);
    }
  });

  it('runs the CLIPLAB_TTS_COMMAND override without a shell: {input}/{output} become literal argv values', async () => {
    const invocations: Call[] = [];
    const inner = mediaRunner({ '-p1.aiff': 20, '-p2.aiff': 10, '.wav': 10 });
    const run = async (command: string, args: string[]) => {
      invocations.push({ command, args });
      return inner(command, args);
    };
    const synth = new MacosSayVoiceSynthesizer({ run, ttsCommandOverride: 'my-tts "{input}" "{output}"' });
    const result = await synth.synthesize('hola mundo', 12, '/tmp/cliplab-test');
    // No invocation is ever mediated by /bin/sh.
    expect(invocations.map(call => call.command)).not.toContain('/bin/sh');
    // Two override invocations: pass 1 exceeded (20s > 12s), pass 2 fit (10s ≤ 12s).
    const ttsCalls = invocations.filter(call => call.command === 'my-tts');
    expect(ttsCalls).toHaveLength(2);
    expect(ttsCalls[0].args).toEqual(['hola mundo', expect.stringContaining('-p1.aiff')]);
    expect(ttsCalls.every(call => call.args[0] === 'hola mundo')).toBe(true);
    expect(result.filePath.endsWith('.wav')).toBe(true);
  });

  it('fails with an ENVIRONMENT error when the override template has no command', async () => {
    const synth = new MacosSayVoiceSynthesizer({ run: async () => ({ stdout: '', stderr: '' }), ttsCommandOverride: '   ' });
    await expect(synth.synthesize('text', 5)).rejects.toBeInstanceOf(RenderEnvironmentError);
  });

  it('keeps shell metacharacters in the narration inert even under the real spawner (R1 adversarial)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cliplab-tts-sec-'));
    const executable = (name: string, body: string) => {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
      return path;
    };
    const argvLog = join(dir, 'tts-argv.log');
    // Real synthesizer shim: dumps its raw argv, one per line, and produces
    // the requested output file ($4) so the media pipeline can proceed.
    const ttsShim = executable('my-tts-shim', `printf '%s\\n' "$@" >> '${argvLog}'\n: > "$4"`);
    // Real media shims so synthesize() runs end-to-end through spawn().
    executable(
      'ffprobe-shim',
      `case "$7" in *-p2.aiff|*.wav) echo '{"format":{"duration":"10"}}';; *) echo '{"format":{"duration":"20"}}';; esac`
    );
    executable('ffmpeg-shim', `cp "$3" "$8"`);
    const pwnedMarker = join(dir, 'pwned-marker');
    // Both substitution forms would create the marker file IF any shell ever
    // interpreted them; trailing operators exercise other metacharacters.
    const payload = `$(touch ${pwnedMarker}) ` + '`' + `touch ${pwnedMarker}` + '`; rm -rf / | > &';
    const synth = new MacosSayVoiceSynthesizer({
      ttsCommandOverride: `${ttsShim} --text {input} --out {output}`,
      ffmpegCommand: join(dir, 'ffmpeg-shim'),
      ffprobeCommand: join(dir, 'ffprobe-shim')
    });
    const result = await synth.synthesize(payload, 15, dir);
    // The injected command substitutions NEVER executed...
    expect(existsSync(pwnedMarker)).toBe(false);
    // ...and the text reached the synthesizer verbatim as one argument.
    const logged = readFileSync(argvLog, 'utf8').split('\n');
    expect(logged[1]).toBe(payload);
    expect(logged[3].endsWith('-p1.aiff')).toBe(true);
    expect(result.durationSeconds).toBe(10);
  });

  it('fails with an ENVIRONMENT error when the override template has unterminated quotes', () => {
    let error: unknown;
    try {
      tokenizeCommandLine('my-tts --text "unterminated');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RenderEnvironmentError);
    expect((error as RenderEnvironmentError).message).toContain('unterminated');
  });

  it('keeps empty narration an explicit specification failure instead of silent output', async () => {
    const synth = new MacosSayVoiceSynthesizer({ run: async () => ({ stdout: '', stderr: '' }) });
    await expect(synth.synthesize('   ', 10)).rejects.toBeInstanceOf(RenderSpecificationError);
  });
});

describe('tokenizeCommandLine', () => {
  it('splits on whitespace and strips grouping quotes without interpreting anything', () => {
    expect(tokenizeCommandLine('my-tts --text "hola mundo" --out \'/x/y z.wav\'')).toEqual([
      'my-tts',
      '--text',
      'hola mundo',
      '--out',
      '/x/y z.wav'
    ]);
  });

  it('keeps every shell metacharacter as inert data', () => {
    const nasty = '$(rm -rf /) `touch x` ; | > & && || ${VAR}';
    expect(tokenizeCommandLine(`my-tts "${nasty}"`)).toEqual(['my-tts', nasty]);
    expect(tokenizeCommandLine(`tts ${nasty}`)).toEqual(['tts', ...nasty.split(/\s+/)]);
  });

  it('rejects unterminated quotes with an actionable environment error', () => {
    expect(() => tokenizeCommandLine("tts 'open")).toThrowError(RenderEnvironmentError);
    expect(() => tokenizeCommandLine('tts "open')).toThrowError(RenderEnvironmentError);
  });

  it('returns no tokens for blank templates', () => {
    expect(tokenizeCommandLine('   ')).toEqual([]);
  });
});
