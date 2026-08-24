import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { renderToFinalSchema, type StoryboardToRenderHandoff } from '../domain/handoffs.js';
import { ProductionGateError, RenderEnvironmentError, RenderSpecificationError, RenderStateError, RenderUnclassifiedError, ValidationError } from '../domain/errors.js';
import { assertOutputDuration, renderFailureSchema, renderQueueEntrySchema, renderResultSchema, resolveTechnicalOutput, type RenderFailure, type RenderQueueEntry, type RenderResult, type VideoRenderer, type VoiceSynthesizer, RENDER_STAGES } from '../domain/render.js';
import { PipelineRepository } from '../infrastructure/repositories/pipeline-repository.js';
import { RenderRepository } from '../infrastructure/repositories/render-repository.js';
import { buildComposition, type CompositionEngineMetadata } from '../infrastructure/render/composition-builder.js';
import { HYPERFRAMES_PACKAGE_VERSION, RENDER_CLI_FLAGS } from '../infrastructure/render/hyperframes-renderer.js';
import type { StoryboardService } from './storyboard-service.js';

const actorInputSchema = z.object({ actor: z.string().min(1) }).strict();

export interface RenderServiceOptions {
  dataDir?: string;
  profileEnv?: string;
}

/**
 * Serial production orchestrator. Zero automatic retries anywhere; every
 * attempt is explicit and recorded. The approved duration is honored exactly.
 */
export class RenderService {
  private readonly dataDir: string;
  private readonly profileEnv?: string;
  /** In-process FIFO worker: a single promise chain guarantees one RUNNING render at a time. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private renders: RenderRepository,
    private pipeline: PipelineRepository,
    private storyboard: StoryboardService,
    private renderer: VideoRenderer,
    private synthesizer: VoiceSynthesizer,
    options: RenderServiceOptions = {}
  ) {
    this.dataDir = options.dataDir ?? process.env.CLIPLAB_DATA_DIR ?? './data';
    this.profileEnv = options.profileEnv ?? process.env.CLIPLAB_RENDER_PROFILE;
    // Startup reconciliation: this process is now the single owner of the
    // queue, so renders still marked RUNNING belong to a dead previous process
    // (crash, OOM, redeploy) and any QUEUED backlog persisted before the
    // restart must be drained. Zero automatic retries is preserved: the sweep
    // only makes orphans visible and recoverable via the operator retry path.
    this.reconcileStartup();
  }

  /** Transitions orphaned RUNNING rows to recoverable failures and drains any persisted QUEUED backlog. */
  private reconcileStartup(): void {
    let recoveredWork = false;
    for (const row of this.renders.listQueue()) {
      if (row.state === 'RUNNING') {
        this.renders.markInterrupted(row.renderId);
        recoveredWork = true;
      } else if (row.state === 'QUEUED') {
        recoveredWork = true;
      }
    }
    // Kick the serial worker only when the sweep found something to do: a
    // fresh database must not schedule pointless background drains.
    if (recoveredWork) this.kickWorker();
  }

  startProduction(opportunityId: string, input: unknown): RenderQueueEntry {
    const { actor } = actorInputSchema.parse(input);
    const opportunity = this.pipeline.get(opportunityId);
    if (opportunity.state !== 'RENDER') {
      throw new ProductionGateError(`Production requires the opportunity to be in RENDER state`, { reason: 'NOT_IN_RENDER_STATE', observedState: opportunity.state, expectedState: 'RENDER' });
    }
    const handoff = this.storyboard.verifyAuthorizedHandoff(opportunityId);
    const sequence = this.renders.listByOpportunity(opportunityId).length + 1;
    const entry = renderQueueEntrySchema.parse({
      renderId: `${opportunityId}-render-${sequence}`,
      opportunityId,
      storyboardId: handoff.storyboardId,
      storyboardRevisionId: handoff.storyboardRevisionId,
      userApprovalId: handoff.userApprovalId,
      productionAuthorizationId: handoff.productionAuthorization,
      state: 'QUEUED',
      stage: 'PREFLIGHT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.renders.enqueue(entry, handoff, actor);
    this.kickWorker();
    return entry;
  }

  retry(renderId: string, input: unknown): RenderQueueEntry {
    const { actor } = actorInputSchema.parse(input);
    const row = this.renders.get(renderId);
    if (row.state !== 'FAILED') throw new RenderStateError(`Only FAILED renders can be retried (render is ${row.state})`);
    if (row.failureClass === 'SPECIFICATION') {
      throw new RenderSpecificationError(
        'Retrying cannot fix a specification failure: correct the storyboard and request an explicit user reapproval before producing again',
        { segmentId: row.failureSegmentId }
      );
    }
    this.renders.requeueForRetry(renderId, actor);
    this.kickWorker();
    return this.renders.get(renderId);
  }

  getDetail(renderId: string) {
    const row = this.renders.get(renderId);
    return {
      ...row,
      // CA-6: an incomplete or failed render is never presented as final output.
      output: row.state === 'SUCCEEDED' ? { outputPath: row.outputPath, sha256: row.outputSha256, durationSeconds: row.outputDurationSeconds } : null
    };
  }

  listQueue() {
    return this.renders.listQueue();
  }

  listByOpportunity(opportunityId: string) {
    return this.renders.listByOpportunity(opportunityId);
  }

  attempts(renderId: string) {
    this.renders.get(renderId);
    return this.renders.attempts(renderId);
  }

  /**
   * RENDER→FINAL draft: only constructible from a SUCCEEDED render of the
   * opportunity's latest production. Enforces the reinforced schema.
   */
  buildFinalHandoffDraft(opportunityId: string): ReturnType<typeof renderToFinalSchema.parse> {
    const succeeded = this.renders.listByOpportunity(opportunityId).filter(row => row.state === 'SUCCEEDED');
    if (!succeeded.length) throw new RenderStateError(`No SUCCEEDED render exists for opportunity ${opportunityId}: FINAL cannot be drafted`);
    const row = succeeded[succeeded.length - 1];
    const handoff = row.handoffPayload as StoryboardToRenderHandoff;
    const technical = resolveTechnicalOutput(this.profileEnv, handoff.profile.aspectRatio);
    return renderToFinalSchema.parse({
      opportunityId,
      scriptOriginReference: handoff.scriptId,
      storyboardOriginReference: row.storyboardRevisionId,
      productionAuthorizationReference: row.productionAuthorizationId,
      renderId: row.renderId,
      productionResult: { artifactPath: row.outputPath!, sha256: row.outputSha256!, durationSeconds: row.outputDurationSeconds!, width: technical.width, height: technical.height, fps: technical.fps },
      synchronizationStatus: 'SYNCED',
      finalAuthorizationOrReturn: 'FINAL_AUTHORIZATION'
    });
  }

  // ---- serial worker ----

  /** Resolves when the serial worker has fully drained the queue (tests/graceful shutdown). */
  idle(): Promise<void> {
    return this.chain;
  }

  private kickWorker(): Promise<void> {
    this.chain = this.chain.catch(() => undefined).then(() => this.drain());
    return this.chain;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const next = this.renders.listQueue().find(row => row.state === 'QUEUED');
      if (!next) return;
      await this.execute(next.renderId);
    }
  }

  private async execute(renderId: string): Promise<void> {
    try {
      this.renders.markRunning(renderId);
    } catch {
      return; // Another execution owns it; the serial chain moves on.
    }
    const row = this.renders.get(renderId);
    const attemptNumber = this.renders.nextAttemptNumber(renderId);
    // Attribution: the attempt belongs to whoever queued (or retried) THIS
    // render, never to whichever later action happened to trigger the drain.
    this.renders.recordAttemptStart(renderId, attemptNumber, row.queuedBy);
    let stage = 'PREFLIGHT' as (typeof RENDER_STAGES)[number];
    try {
      const handoff = row.handoffPayload as StoryboardToRenderHandoff;
      const technical = resolveTechnicalOutput(this.profileEnv, handoff.profile.aspectRatio);

      stage = 'PREFLIGHT';
      this.renders.updateStage(renderId, stage);
      await this.renderer.preflight();

      stage = 'NARRATION';
      this.renders.updateStage(renderId, stage);
      const narrationFiles: Record<string, string> = {};
      const narrationDir = join(this.dataDir, 'renders', renderId, 'narration');
      mkdirSync(narrationDir, { recursive: true });
      for (const segment of [...handoff.authorizedSegments].sort((a, b) => a.position - b.position)) {
        try {
          const synthesis = await this.synthesizer.synthesize(segment.narrativeSpan, segment.durationSeconds, narrationDir);
          narrationFiles[segment.segmentId] = synthesis.filePath;
        } catch (error) {
          if (error instanceof RenderSpecificationError && !error.details?.segmentId) {
            // Re-wrap with the failing segment attached for operator visibility.
            throw new RenderSpecificationError(error.message, { ...(error.details ?? {}), segmentId: segment.segmentId });
          }
          throw error;
        }
      }

      stage = 'COMPOSITION';
      this.renders.updateStage(renderId, stage);
      const compositionDir = join(this.dataDir, 'renders', renderId, 'composition');
      mkdirSync(compositionDir, { recursive: true });
      const engineVersion = await this.safeEngineVersion();
      const engine: CompositionEngineMetadata = { name: 'hyperframes', version: engineVersion, flags: RENDER_CLI_FLAGS };
      const composition = buildComposition(handoff, technical, narrationFiles, engine);
      writeFileSync(join(compositionDir, 'index.html'), composition.indexHtml, 'utf8');
      writeFileSync(join(compositionDir, 'manifest.json'), composition.manifestJson, 'utf8');

      stage = 'VALIDATION';
      this.renders.updateStage(renderId, stage);
      await this.renderer.lint(compositionDir);
      await this.renderer.check(compositionDir);

      stage = 'ENCODING';
      this.renders.updateStage(renderId, stage);
      const outputPath = join(this.dataDir, 'renders', renderId, 'output.mp4');
      const rendered = await this.renderer.render({ compositionDir, outputPath, fps: technical.fps });
      // CA-8 invariant: the approved duration is honored within ±2 frames.
      assertOutputDuration(rendered.durationSeconds, handoff.finalDurationSeconds, technical.fps);
      const result = renderResultSchema.parse({
        outputPath: rendered.outputPath,
        sha256: sha256File(rendered.outputPath),
        durationSeconds: rendered.durationSeconds,
        width: technical.width,
        height: technical.height,
        fps: technical.fps
      });

      this.renders.recordAttemptFinish(renderId, attemptNumber, 'SUCCEEDED');
      this.renders.completeSuccess(renderId, result);
    } catch (error) {
      const failure = classifyFailure(error, stage);
      const excerpt = failure.rawExcerpt ?? String(error instanceof Error ? `${error.name}: ${error.message}` : error).slice(0, 4000);
      this.renders.recordAttemptFinish(renderId, attemptNumber, 'FAILED', { failureClass: failure.failureClass, failureCause: failure.cause, logExcerpt: excerpt.slice(0, 2000) });
      this.renders.completeFailure(renderId, renderFailureSchema.parse(failure), excerpt);
    }
  }

  private async safeEngineVersion(): Promise<string> {
    const renderer = this.renderer as VideoRenderer & { version?: () => Promise<string> };
    if (typeof renderer.version !== 'function') return HYPERFRAMES_PACKAGE_VERSION;
    try {
      return await renderer.version();
    } catch {
      return HYPERFRAMES_PACKAGE_VERSION;
    }
  }
}

function classifyFailure(error: unknown, stage: (typeof RENDER_STAGES)[number]): RenderFailure & { rawExcerpt?: string } {
  const specificationAction = 'Return to storyboard: correct it and request an explicit user reapproval before producing again';
  const environmentAction = 'Verify the render environment (FFmpeg, TTS voices, resources) and retry from the operator endpoint';
  const unclassifiedAction = 'Decide between retrying production after verifying the environment OR returning to storyboard with correction and reapproval';
  if (error instanceof RenderSpecificationError) {
    const details = error.details ?? {};
    return { failureClass: 'SPECIFICATION', stage, cause: error.message, ...(details.segmentId ? { segmentId: details.segmentId } : {}), suggestedAction: specificationAction, ...(details.validatorFindings ? { rawExcerpt: details.validatorFindings } : {}) };
  }
  if (error instanceof RenderEnvironmentError) {
    const details = (error.details ?? {}) as { suggestedAction?: string; rawExcerpt?: string; check?: string };
    return { failureClass: 'ENVIRONMENT', stage, cause: error.message, suggestedAction: typeof details.suggestedAction === 'string' ? details.suggestedAction : environmentAction, ...(details.rawExcerpt || details.check ? { rawExcerpt: details.rawExcerpt ?? details.check } : {}) };
  }
  if (error instanceof RenderUnclassifiedError) {
    const details = (error.details ?? {}) as { rawLog?: string };
    return { failureClass: 'UNCLASSIFIED', stage, cause: error.message, suggestedAction: unclassifiedAction, rawExcerpt: details.rawLog ?? String(error.message) };
  }
  if (error instanceof ValidationError && /duration/i.test(error.message)) {
    return { failureClass: 'SPECIFICATION', stage, cause: `Produced output violates the approved duration: ${error.message}`, suggestedAction: specificationAction };
  }
  return { failureClass: 'UNCLASSIFIED', stage, cause: String(error instanceof Error ? error.message : error), suggestedAction: unclassifiedAction, rawExcerpt: String(error instanceof Error ? error.stack ?? error.message : error).slice(0, 4000) };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
