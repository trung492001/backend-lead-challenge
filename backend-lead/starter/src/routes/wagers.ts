import { Request, Router } from 'express';
import { z } from 'zod';
import { positiveDecimalString } from '../lib/validators';
import * as wagerService from '../services/wagerService';

// mergeParams: true so :walletId from the mount path in app.ts is visible here.
export const wagersRouter = Router({ mergeParams: true });

const createWagerBody = z.object({
  amount: positiveDecimalString,
});

wagersRouter.post('/', async (req: Request<{ walletId: string }>, res, next) => {
  try {
    const body = createWagerBody.parse(req.body);
    const wager = await wagerService.createWager(req.params.walletId, body.amount);
    res.status(201).json({ id: wager.id });
  } catch (err) {
    next(err);
  }
});
