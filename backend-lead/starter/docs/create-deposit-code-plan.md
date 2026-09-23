# Code Plan — A1: Create Deposit (`POST /deposits`)

> Written after the code was done, with the real code included, for review/understanding — not just signatures.

## Files changed

| File | Kind |
|---|---|
| `src/lib/httpError.ts` | new |
| `src/lib/validators.ts` | new |
| `src/services/depositService.ts` | new (the `createDeposit` part) |
| `src/routes/deposits.ts` | new |
| `src/app.ts` | modified — mount route + catch `HttpError` |

## 1. `src/lib/httpError.ts` (new)

Business errors (404/422/...) thrown by services; the shared error handler in `app.ts` maps them straight to a status/body, so routes don't need to know the status code.

```ts
// Thrown by services for expected business-rule failures (404/422/...); the
// central error handler in app.ts maps it straight to the given status/body,
// keeping routes thin (services own the status code, not the route).
export class HttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(typeof body === 'string' ? body : JSON.stringify(body));
    this.status = status;
    this.body = body;
  }
}
```

## 2. `src/lib/validators.ts` (new)

A zod validator shared by every money field (A1-A4) — parses with `dec()` (BigNumber) to guarantee `amount` is a valid, positive decimal string.

```ts
import { z } from 'zod';
import { dec } from './money';

export const positiveDecimalString = z.string().refine((value) => {
  try {
    return dec(value).isPositive();
  } catch {
    return false;
  }
}, 'must be a positive decimal string');
```

## 3. `src/services/depositService.ts` (new) — the `createDeposit` function

```ts
import { sequelize } from '../db/sequelize';
import { FundingTransaction, Member } from '../db/models';
import { generatePspRef } from '../lib/pspRef';
import { HttpError } from '../lib/httpError';

// A1: creates a Pending funding transaction. No money moves yet.
export async function createDeposit(
  memberId: string,
  amount: string,
  turnoverMultiplier: number,
): Promise<FundingTransaction> {
  const member = await Member.findByPk(memberId);
  if (!member) {
    throw new HttpError(404, { error: 'member_not_found' });
  }

  return FundingTransaction.create({
    memberId,
    type: 'deposit',
    status: 'pending',
    amount,
    turnoverMultiplier,
    pspRef: generatePspRef(),
  });
}
```

No `sequelize.transaction` wrapper — only 1 row is written (`FundingTransaction`), consistent with the "transaction only required when writing >1 row" convention. `Member.findByPk` is checked first so a clean `404` is returned instead of letting an FK constraint error surface as `500`.

## 4. `src/routes/deposits.ts` (new)

```ts
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
```

## 5. `src/app.ts` (modified)

```diff
 import express, { ErrorRequestHandler } from 'express';
 import { ZodError } from 'zod';
+import { HttpError } from './lib/httpError';
 import { healthRouter } from './routes/health';
 import { membersRouter } from './routes/members';
+import { depositsRouter } from './routes/deposits';

 const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
   if (err instanceof ZodError) {
     res.status(400).json({ error: 'validation_error', details: err.issues });
     return;
   }
+  if (err instanceof HttpError) {
+    res.status(err.status).json(err.body);
+    return;
+  }
   // eslint-disable-next-line no-console
   console.error(err);
   res.status(500).json({ error: 'internal_error' });
 };

 export function createApp() {
   const app = express();
   app.use(express.json());

   app.use('/health', healthRouter);
   app.use('/members', membersRouter);
+  app.use('/deposits', depositsRouter);
-  // Mount your new routes here.

   app.use(errorHandler);
   return app;
 }
```

## Test coverage (`test/deposits.test.ts`)

- Successful creation → `201 { id, pspRef }`, DB row has `status=pending, type=deposit`.
- `turnoverMultiplier` defaults to `1` when omitted.
- Rejects a negative `amount`.
- Rejects an unparseable `amount` (`'not-a-number'`).
- Rejects an unknown `memberId` → `404`.
