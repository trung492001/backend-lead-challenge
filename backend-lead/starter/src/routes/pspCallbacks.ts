import { Router } from 'express';
import { z } from 'zod';
import { positiveDecimalString } from '../lib/validators';
import * as depositService from '../services/depositService';

export const pspCallbacksRouter = Router();

const pspCallbackBody = z.object({
  pspRef: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  amount: positiveDecimalString,
});

pspCallbacksRouter.post('/', async (req, res, next) => {
  try {
    const body = pspCallbackBody.parse(req.body);
    await depositService.applyPspCallback(body.pspRef, body.status, body.amount);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});
