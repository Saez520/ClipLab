import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StoryboardService } from '../../application/storyboard-service.js';
import { sendError } from '../http-errors.js';

const params = z.object({ id: z.string().min(1) }).strict();
const actor = z.string().min(1);

export async function storyboardRoutes(app: FastifyInstance, service: StoryboardService) {
  app.post('/opportunities/:id/storyboard', async (req, res) => {
    try {
      const p = params.parse(req.params);
      const body = z.object({ actor: actor.optional(), profile: z.record(z.unknown()).optional(), segments: z.array(z.record(z.unknown())).min(1) }).strict().parse(req.body);
      return res.code(201).send(service.create(p.id, body));
    } catch (error) { return sendError(res, error); }
  });

  app.get('/opportunities/:id/storyboard', async (req, res) => {
    try { return res.send(service.get(params.parse(req.params).id)); }
    catch (error) { return sendError(res, error); }
  });

  app.get('/opportunities/:id/storyboard/lineage', async (req, res) => {
    try { return res.send(service.lineage(params.parse(req.params).id)); }
    catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/storyboard/approve', async (req, res) => {
    try {
      const p = params.parse(req.params);
      const body = z.object({ actor, storyboardRevisionId: z.string().min(1) }).strict().parse(req.body);
      return res.send(service.approve(p.id, body));
    } catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/storyboard/corrections', async (req, res) => {
    try {
      const p = params.parse(req.params);
      const body = z.object({ actor, segmentId: z.string().min(1), expectedAdjustment: z.string().min(1), editorialChange: z.boolean().optional() }).strict().parse(req.body);
      return res.code(201).send(service.requestCorrection(p.id, body));
    } catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/storyboard/revalidate', async (req, res) => {
    try {
      const p = params.parse(req.params);
      const body = z.object({ actor, segments: z.array(z.record(z.unknown())).optional() }).strict().parse(req.body);
      return res.send(service.revalidate(p.id, body));
    } catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/storyboard/block', async (req, res) => {
    try {
      const p = params.parse(req.params);
      const body = z.object({ actor, reason: z.string().min(1), recipient: z.string().min(1).optional() }).strict().parse(req.body);
      return res.send(service.block(p.id, body));
    } catch (error) { return sendError(res, error); }
  });

  app.get('/opportunities/:id/storyboard/handoff', async (req, res) => {
    try { return res.send(service.handoff(params.parse(req.params).id)); }
    catch (error) { return sendError(res, error); }
  });
}
