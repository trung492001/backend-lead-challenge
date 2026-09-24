# Code Plan — A3: Wager (`POST /wallets/:walletId/wagers`)

> Written before coding and approved, then implemented exactly as shown below. Design context: `wager-plan.md`. Locking rationale: `../DECISIONS.md` #3, #7.

## Files to add/change

| File | Kind |
|---|---|
| `src/services/wagerService.ts` | new |
| `src/routes/wagers.ts` | new |
| `src/app.ts` | modify — mount route |

## 1. `src/services/wagerService.ts` (new)

```ts
import { Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { Wallet, Wager, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { HttpError } from '../lib/httpError';

// A3: debits the wallet for a wager. Two concurrent wagers on the same wallet
// must not overdraw it - see DECISIONS.md #3. No Pending state - see #7.
export async function createWager(walletId: string, amount: string): Promise<Wager> {
  return sequelize.transaction(async (t) => {
    // Row lock on the wallet. A concurrent second wager on the same wallet
    // blocks here until this transaction commits, then re-reads the debited balance.
    const wallet = await Wallet.findByPk(walletId, {
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });

    if (!wallet) {
      throw new HttpError(404, { error: 'wallet_not_found' });
    }

    if (dec(wallet.balance).isLessThan(dec(amount))) {
      throw new HttpError(422, { error: 'insufficient_balance' });
    }

    const wager = await Wager.create(
      { walletId: wallet.id, memberId: wallet.memberId, amount },
      { transaction: t },
    );

    await WalletTx.create(
      {
        walletId: wallet.id,
        amount: dec(amount).negated().toString(),
        type: 'wager',
        wagerId: wager.id,
      },
      { transaction: t },
    );

    await wallet.update(
      { balance: dec(wallet.balance).minus(dec(amount)).toString() },
      { transaction: t },
    );

    return wager;
  });
}
```

**Why the steps are ordered this way:**
1. Lock the `wallets` row **first**, by primary key — this is the only lock A3 needs; it already serializes against concurrent wagers *and* against a concurrent A2 callback crediting the same wallet (A2 takes the same lock).
2. Check `!wallet` → `404` — an unknown `walletId` shouldn't crash.
3. Check `balance < amount` **before creating anything** → `422`, no `wagers`/`wallet_txs` row is ever created for a rejected wager.
4. Only once funds are confirmed sufficient: create the `wagers` row, then the ledger row, then update the balance — all inside the one transaction, so a failure at any point rolls back everything (no ledger entry without a matching balance change, or vice versa).
5. `memberId` on the `wagers` row comes from `wallet.memberId` (denormalized, per `architecture.md`) rather than from the request body — the route only exposes `:walletId`, not `memberId`, so there's nothing to trust from the client here.

## 2. `src/routes/wagers.ts` (new)

```ts
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
```

(`Request<{ walletId: string }>` is needed because Express's typings don't infer merged params from the parent router automatically — without it, `req.params.walletId` fails to typecheck.)

Note: `:walletId` isn't validated as a UUID with zod before hitting the service (it's a route param, not a body field) — this matches the existing convention in `routes/members.ts` (`GET /members/:memberId/wallet` doesn't validate `:memberId` either). A malformed UUID in the URL will surface as a Postgres "invalid input syntax for type uuid" error, caught by the generic `500` handler. Flagging this as a known minor gap rather than adding new validation the rest of the codebase doesn't already have.

## 3. `src/app.ts` (modify)

```diff
 import { depositsRouter } from './routes/deposits';
 import { pspCallbacksRouter } from './routes/pspCallbacks';
+import { wagersRouter } from './routes/wagers';

   app.use('/psp/callbacks', pspCallbacksRouter);
+  app.use('/wallets/:walletId/wagers', wagersRouter);
```

## Test coverage (`test/wagers.test.ts`)

- Successful wager → `201 { id }`, wallet balance debited by the right amount, exactly one `wallet_txs` row (negative amount, `type=wager`, `wagerId` set).
- Rejects when `balance < amount` → `422`, no `wagers`/`wallet_txs` row created.
- **Concurrent** wagers on the same wallet (`Promise.all`) → the one that doesn't fit is rejected with `422`, balance never goes negative ⚠️ required test.
- Rejects an unknown `walletId` → `404`.
