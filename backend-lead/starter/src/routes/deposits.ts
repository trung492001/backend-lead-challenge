import { Router } from 'express';
import { z } from 'zod';
import { positiveDecimalString } from '../lib/validators';
import * as depositService from '../services/depositService';

export const depositsRouter = Router();

const createDepositBody = z.object({
  memberId: z.string().uuid(),
  amount: positiveDecimalString,
  turnoverMultiplier: z.number().int().nonnegative().default(1),
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = createDepositBody.parse(req.body);
    const tx = await depositService.createDeposit(body.memberId, body.amount, body.turnoverMultiplier);
    res.status(201).json({ id: tx.id, pspRef: tx.pspRef });
  } catch (err) {
    next(err);
  }
});
