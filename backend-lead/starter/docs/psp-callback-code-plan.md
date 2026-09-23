# Code Plan — A2: PSP Callback (`POST /psp/callbacks`)

> The core of the assignment. Written after the code was done, with the real code included, for review/understanding — not just signatures.

## Files changed

| File | Kind |
|---|---|
| `src/routes/pspCallbacks.ts` | new |
| `src/services/depositService.ts` | modified — added `applyPspCallback` |
| `src/app.ts` | modified — mount route |

## 1. `src/services/depositService.ts` — the `applyPspCallback` function (added to the file already created in A1)

```ts
import { Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { HttpError } from '../lib/httpError';

export type PspCallbackStatus = 'completed' | 'failed';

// A2: applies a PSP callback. Must be safe against redelivery and against two
// deliveries for the same pspRef arriving concurrently - see DECISIONS.md #2.
export async function applyPspCallback(
  pspRef: string,
  status: PspCallbackStatus,
  callbackAmount: string,
): Promise<void> {
  await sequelize.transaction(async (t) => {
    // Row lock on the funding transaction, keyed by pspRef. A concurrent second
    // delivery for the same pspRef blocks here until this transaction commits.
    const tx = await FundingTransaction.findOne({
      where: { pspRef },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });

    if (!tx) {
      throw new HttpError(404, { error: 'unknown_psp_ref' });
    }

    if (tx.status !== 'pending') {
      // Already resolved by an earlier delivery (sequential retry, or the
      // concurrent delivery that got here first). No-op - this is what makes
      // redelivery and concurrent redelivery both safe.
      return;
    }

    if (status === 'failed') {
      await tx.update({ status: 'failed' }, { transaction: t });
      return;
    }

    // status === 'completed'. Trust the amount recorded at deposit time, not
    // the callback's amount - see DECISIONS.md #5. Only log if they disagree.
    if (!dec(callbackAmount).eq(dec(tx.amount))) {
      // eslint-disable-next-line no-console
      console.warn(
        `psp callback amount mismatch for pspRef=${pspRef}: callback=${callbackAmount} original=${tx.amount}`,
      );
    }

    await tx.update({ status: 'completed' }, { transaction: t });

    // Lock the wallet row too: this serializes against concurrent wagers/withdrawals
    // on the same wallet (they also take this lock), not just against duplicate callbacks.
    const wallet = await Wallet.findOne({
      where: { memberId: tx.memberId },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!wallet) {
      throw new Error(`wallet not found for member ${tx.memberId}`);
    }

    await WalletTx.create(
      { walletId: wallet.id, amount: tx.amount, type: 'deposit', fundingTransactionId: tx.id },
      { transaction: t },
    );

    await wallet.update(
      { balance: dec(wallet.balance).plus(dec(tx.amount)).toString() },
      { transaction: t },
    );
  });
}
```

**Why the steps are ordered this way:**
1. Lock `funding_transactions` by `pspRef` **first** — this is the main locking point; everything after it runs safely in sequence.
2. Check `!tx` → `404` — handles an unknown `pspRef` without crashing.
3. The `status !== 'pending'` guard **returns early** — this is the single most important line in all of A2: it's what turns redelivery (sequential or concurrent) into a no-op.
4. The `failed` branch is separate and returns early — it never touches the wallet.
5. The `completed` branch: compare amounts (log only), update status, then lock `wallets` and write the ledger + balance — all inside the same transaction, so if any step throws, everything rolls back (no half-applied state: status `Completed` without a credit).

## 2. `src/routes/pspCallbacks.ts` (new)

```ts
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
```

The route always returns `200 { status: 'ok' }` when the service doesn't throw — including when the service no-ops internally (redelivery). The mock PSP has no need to distinguish "already processed" from "just processed"; both look like success from its side.

## 3. `src/app.ts` (modified)

```diff
 import { HttpError } from './lib/httpError';
 import { healthRouter } from './routes/health';
 import { membersRouter } from './routes/members';
 import { depositsRouter } from './routes/deposits';
+import { pspCallbacksRouter } from './routes/pspCallbacks';

   app.use('/deposits', depositsRouter);
+  app.use('/psp/callbacks', pspCallbacksRouter);
```

## Test coverage (`test/pspCallbacks.test.ts`)

- `completed` callback → credits exactly once, exactly one `wallet_txs` row.
- **Sequential** duplicate callback → doesn't double-credit.
- **Concurrent** duplicate callback (`Promise.all`) → doesn't double-credit ⚠️ the single most important test in the assignment.
- Unknown `pspRef` → `404`, no crash.
- `failed` callback → balance unchanged, `status=failed`.
- Bonus: send `failed` then `completed` afterward → stays `failed`, no credit (invalid transition blocked).
