import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RenderService } from '../../application/render-service.js';
import { sendError } from '../http-errors.js';

const params = z.object({ id: z.string().min(1) }).strict();
const renderParams = z.object({ renderId: z.string().min(1) }).strict();
const startBody = z.object({ actor: z.string().min(1) }).strict();

export async function renderRoutes(app: FastifyInstance, service: RenderService) {
  app.post('/opportunities/:id/production', async (req, res) => {
    try {
      const p = params.parse(req.params);
      const body = startBody.parse(req.body);
      return res.code(202).send(service.startProduction(p.id, body));
    } catch (error) { return sendError(res, error); }
  });

  app.get('/renders', async (_req, res) => {
    try { return res.send(service.listQueue()); }
    catch (error) { return sendError(res, error); }
  });

  app.get('/renders/:renderId', async (req, res) => {
    try {
      const p = renderParams.parse(req.params);
      const detail = service.getDetail(p.renderId);
      const attempts = service.attempts(p.renderId);
      return res.send({ ...detail, attempts });
    } catch (error) { return sendError(res, error); }
  });

  app.post('/renders/:renderId/retry', async (req, res) => {
    try {
      const p = renderParams.parse(req.params);
      const body = z.object({ actor: z.string().min(1) }).strict().parse(req.body);
      return res.code(202).send(service.retry(p.renderId, body));
    } catch (error) { return sendError(res, error); }
  });

  app.get('/opportunities/:id/renders', async (req, res) => {
    try { return res.send(service.listByOpportunity(params.parse(req.params).id)); }
    catch (error) { return sendError(res, error); }
  });
}
