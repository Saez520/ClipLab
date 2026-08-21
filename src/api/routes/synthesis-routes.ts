import type { FastifyInstance } from 'fastify';
import { SynthesisService } from '../../application/synthesis-service.js';
import { sendError } from '../http-errors.js';
export async function synthesisRoutes(app: FastifyInstance, service: SynthesisService) {
  app.post('/opportunities/:id/synthesis/sessions', async (req, res) => {
    try {
      const body = req.body as any;
      const opportunityId = (req.params as any).id;
      return res.code(201).send(service.startSession({ ...(body ?? {}), opportunityId }));
    } catch (error) {
      return sendError(res, error);
    }
  });
  app.post('/opportunities/:id/synthesis/queries', async (req, res) => {
    try {
      const body = req.body as any;
      const opportunityId = (req.params as any).id;
      return res.code(201).send(service.delegate({ ...(body ?? {}), opportunityId }));
    } catch (error) {
      return sendError(res, error);
    }
  });
  app.post('/opportunities/:id/synthesis/queries/:queryId/result', async (req, res) => {
    try {
      const params = req.params as any;
      return res.send(service.saveResult(params.queryId, params.id, req.body));
    } catch (error) {
      return sendError(res, error);
    }
  });
  app.get('/opportunities/:id/synthesis/sessions/:sessionId/queries/:queryId', async (req, res) => {
    try {
      const params = req.params as any;
      return res.send(service.getResult(params.queryId, params.sessionId, params.id));
    } catch (error) {
      return sendError(res, error);
    }
  });
  app.get('/opportunities/:id/synthesis/sessions/:sessionId/queries/:queryId/handoff', async (req, res) => {
    try {
      const params = req.params as any;
      return res.send(service.handoff(params.queryId, params.sessionId, params.id));
    } catch (error) {
      return sendError(res, error);
    }
  });
}
