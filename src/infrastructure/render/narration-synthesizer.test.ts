import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MacosSayVoiceSynthesizer, tokenizeCommandLine } from './narration-synthesizer.js';
import { RenderEnvironmentError, RenderSpecificationError } from '../../domain/errors.js';

type Call = { command: string; args: string[] };

/** Media stub: maps file suffixes to measured durations, records say rates. */
function mediaRunner(durations: Record<string, number>, onSayRate?: (rate: number) => void) {
  return async (command: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    if (command === 'say') {
      // Voice listing is `say -v ?`; synthesis carries the -r rate flag.
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

function voiceListRunner() {
  const calls: Call[] = [];
  const run = async (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === 'say' && args[0] === '-v') return { stdout: 'Mónica            es_ES    # Hola, me llamo Mónica.\nAlbert             en_US    # Hello, my name is Albert.', stderr: '' };
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

  it('throws SPECIFICATION with slot data after 3 passes when narration always exceeds the approved slot', async () => {
    let callsToProbe = 0;
    const ratesUsed: number[] = [];
    const run = async (command: string, args: string[]) => {
      if (command === 'say') {
        if (args[0] === '-v' && args.length === 2) return { stdout: 'Mónica es_ES # Hola', stderr: '' };
        ratesUsed.push(Number(args[3]));
        return { stdout: '', stderr: '' };
      }
      if (command === 'ffprobe') { callsToProbe += 1; return { stdout: JSON.stringify({ format: { duration: String(callsToProbe % 2 === 1 ? 60 : 60) } }), stderr: '' }; }
      return { stdout: '', stderr: '' };
    };
    const synth = new MacosSayVoiceSynthesizer({ run });
    let error: unknown;
    try { await synth.synthesize('narration text', 30, join('/tmp', 'cliplab-test')); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RenderSpecificationError);
    const spec = error as RenderSpecificationError;
    expect(spec.details?.slotSeconds).toBe(30);
    expect(spec.details?.producedSeconds).toBe(60);
    expect(spec.message).toContain('approved slot');
    // Exactly MAX_RATE_ADAPTATION_PASSES synthesis attempts, monotonic rates.
    expect(ratesUsed).toHaveLength(3);
    expect(ratesUsed[0]).toBe(175);
    expect(ratesUsed[1]).toBe(Math.ceil(175 * (60 / 30)));
    expect(ratesUsed[2]).toBeGreaterThan(ratesUsed[1]);
  });

  it('succeeds when adaptation fits the slot and returns the normalized wav reference', async () => {
    let rate = 0;
    // Pass 1 produces 24s (>15 slot) so the rate adapts; pass 2 fits at 12s.
    const run = mediaRunner({ '-p1.aiff': 24, '-p2.aiff': 12, '.wav': 12 }, r => { rate = r; });
    const synth = new MacosSayVoiceSynthesizer({ run });
    const result = await synth.synthesize('narration text', 15, '/tmp/cliplab-test');
    expect(result.durationSeconds).toBe(12);
    expect(result.filePath.endsWith('.wav')).toBe(true);
    expect(rate).toBe(Math.ceil(175 * (24 / 15)));
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
    // One override invocation per adaptation pass (pass 1 exceeded, pass 2 fit).
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
