import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NarrativeService } from '../../application/narrative-service.js';
import { sendError } from '../http-errors.js';

const params = z.object({ id: z.string().min(1) });
const configurationParams = z.object({ id: z.string().min(1), configurationId: z.string().min(1) });
const actor = z.string().min(1);

export async function narrativeRoutes(app: FastifyInstance, service: NarrativeService) {
  app.post('/opportunities/:id/narrative/configurations', async (req, res) => {
    try {
      const p = params.parse(req.params);
      const body = z.object({ director: actor.optional(), configuration: z.record(z.unknown()).optional() }).passthrough().parse(req.body);
      const input = body.configuration ?? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'director'));
      return res.code(201).send(service.proposeConfiguration(p.id, input, body.director ?? 'director'));
    } catch (error) { return sendError(res, error); }
  });

  app.get('/opportunities/:id/narrative/configurations/:configurationId?', async (req, res) => {
    try {
      const p = z.object({ id: z.string().min(1), configurationId: z.string().min(1).optional() }).parse(req.params);
      return res.send(service.getConfiguration(p.id, p.configurationId));
    } catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/narrative/configurations/:configurationId/approve', async (req, res) => {
    try {
      const p = configurationParams.parse(req.params);
      return res.send(service.approveConfiguration(p.id, p.configurationId, z.object({ actor }).parse(req.body)));
    } catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/narrative/scripts/generate', async (req, res) => {
    try {
      const p = params.parse(req.params);
      return res.code(201).send(service.generate(p.id, req.body));
    } catch (error) { return sendError(res, error); }
  });

  app.get('/opportunities/:id/narrative/scripts/:scriptId?', async (req, res) => {
    try {
      const p = z.object({ id: z.string().min(1), scriptId: z.string().min(1).optional() }).parse(req.params);
      return res.send(service.getScript(p.id, p.scriptId));
    } catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/narrative/scripts/block', async (req, res) => {
    try { return res.send(service.block(params.parse(req.params).id, req.body)); }
    catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/narrative/scripts/clarify', async (req, res) => {
    try { return res.send(service.clarify(params.parse(req.params).id, req.body)); }
    catch (error) { return sendError(res, error); }
  });

  app.post('/opportunities/:id/narrative/scripts/validate', async (req, res) => {
    try { return res.send(service.validateDirector(params.parse(req.params).id, req.body)); }
    catch (error) { return sendError(res, error); }
  });

  app.get('/opportunities/:id/narrative/lineage', async (req, res) => {
    try { return res.send(service.lineage(params.parse(req.params).id)); }
    catch (error) { return sendError(res, error); }
  });

  app.get('/opportunities/:id/narrative/handoff', async (req, res) => {
    try { return res.send(service.handoff(params.parse(req.params).id)); }
    catch (error) { return sendError(res, error); }
  });
}
