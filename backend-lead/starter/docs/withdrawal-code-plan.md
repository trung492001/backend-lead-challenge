# Code Plan — A4: Withdrawal + turnover lock (`POST /withdrawals`)

> Written before coding and approved, then implemented exactly as shown below. Design context: `withdrawal-plan.md`. Turnover model rationale: `../DECISIONS.md` #6.

## Files to add/change

| File | Kind |
|---|---|
| `src/services/withdrawalService.ts` | new |
| `src/routes/withdrawals.ts` | new |
| `src/app.ts` | modify — mount route |

## 1. `src/services/withdrawalService.ts` (new)

```ts
import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { HttpError } from '../lib/httpError';

// Both queries return their SUM cast to ::text so the value stays a decimal
// string end to end - Sequelize's .sum() would otherwise parse it into a JS
// number and risk precision loss, which money must never touch (src/lib/money.ts).
async function getRequiredTurnover(memberId: string, t: Transaction): Promise<string> {
  const [row] = await sequelize.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount * turnover_multiplier), 0)::text AS total
     FROM funding_transactions
     WHERE member_id = :memberId AND type = 'deposit' AND status = 'completed'`,
    { replacements: { memberId }, transaction: t, type: QueryTypes.SELECT },
  );
  return row.total;
}

async function getAccruedTurnover(memberId: string, t: Transaction): Promise<string> {
  const [row] = await sequelize.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM wagers WHERE member_id = :memberId`,
    { replacements: { memberId }, transaction: t, type: QueryTypes.SELECT },
  );
  return row.total;
}

// A4: withdraws once turnover is satisfied. required/accrued are lifetime
// totals, not paired to a specific deposit or withdrawal - see DECISIONS.md #6.
export async function createWithdrawal(memberId: string, amount: string): Promise<FundingTransaction> {
  return sequelize.transaction(async (t) => {
    // Locks the wallet, which also serializes concurrent withdrawals for the
    // same member: a second request waits here and re-reads balance/turnover fresh.
    const wallet = await Wallet.findOne({
      where: { memberId },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!wallet) {
      throw new HttpError(404, { error: 'wallet_not_found' });
    }

    const required = dec(await getRequiredTurnover(memberId, t));
    const accrued = dec(await getAccruedTurnover(memberId, t));

    if (accrued.isLessThan(required)) {
      throw new HttpError(422, {
        error: 'turnover_not_met',
        outstandingTurnover: required.minus(accrued).toString(),
      });
    }

    if (dec(wallet.balance).isLessThan(dec(amount))) {
      throw new HttpError(422, { error: 'insufficient_balance' });
    }

    // turnoverMultiplier has no meaning for a withdrawal row (see architecture.md);
    // set to 0 rather than leaving the column's deposit-oriented default of 1.
    const tx = await FundingTransaction.create(
      { memberId, type: 'withdrawal', status: 'pending', amount, turnoverMultiplier: 0 },
      { transaction: t },
    );

    await WalletTx.create(
      {
        walletId: wallet.id,
        amount: dec(amount).negated().toString(),
        type: 'withdrawal',
        fundingTransactionId: tx.id,
      },
      { transaction: t },
    );

    await wallet.update(
      { balance: dec(wallet.balance).minus(dec(amount)).toString() },
      { transaction: t },
    );

    return tx;
  });
}
```

**Why the steps are ordered this way:**
1. Lock the `wallets` row **first**, by `memberId` — same lock A2/A3 take on this wallet, so a withdrawal can never interleave with a concurrent deposit-credit or wager-debit on the same member.
2. Compute `required`/`accrued` **inside the transaction, after the lock** — guarantees the numbers reflect every deposit/wager committed so far, not a stale read from before the lock was acquired.
3. Check turnover **before** balance, matching the order in `withdrawal-plan.md` — turnover is the business gate; balance is a hard limit. Either failure rolls back with no writes.
4. Only once both checks pass: create the `Pending` withdrawal funding transaction, then the ledger row, then debit the balance — same all-or-nothing pattern as A2/A3.
5. Raw SQL (`sequelize.query`) instead of `Wallet.sum()`/`Wager.sum()`: Sequelize's aggregate helpers parse the result into a JS `number`, which breaks the repo's "money never touches JS `number`" convention (`TASK.md` #1) for large or high-precision values. Casting to `::text` in SQL keeps the value a string all the way into `dec()`.

## 2. `src/routes/withdrawals.ts` (new)

```ts
import { Router } from 'express';
import { z } from 'zod';
import { positiveDecimalString } from '../lib/validators';
import * as withdrawalService from '../services/withdrawalService';

export const withdrawalsRouter = Router();

const createWithdrawalBody = z.object({
  memberId: z.string().uuid(),
  amount: positiveDecimalString,
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = createWithdrawalBody.parse(req.body);
    const tx = await withdrawalService.createWithdrawal(body.memberId, body.amount);
    res.status(201).json({ id: tx.id, status: tx.status });
  } catch (err) {
    next(err);
  }
});
```

## 3. `src/app.ts` (modify)

```diff
 import { pspCallbacksRouter } from './routes/pspCallbacks';
 import { wagersRouter } from './routes/wagers';
+import { withdrawalsRouter } from './routes/withdrawals';

   app.use('/wallets/:walletId/wagers', wagersRouter);
+  app.use('/withdrawals', withdrawalsRouter);
```

(Assumes A3 is merged first per `wager-code-plan.md`; if A4 lands alone, drop the `wagersRouter` line from the diff.)

## Test coverage (`test/withdrawals.test.ts`)

- Blocks a withdrawal when turnover is insufficient → `422 { outstandingTurnover }` with the correct remaining amount.
- Allows the withdrawal once enough wagers bring `accrued >= required` → `201 { id, status: 'pending' }`, balance debited, `funding_transactions` row is `type=withdrawal, status=pending`.
- Rejects when turnover is sufficient but `balance < amount` → `422 insufficient_balance`, no rows written.
- Turnover keeps accumulating across multiple deposits (each adds `amount × turnoverMultiplier` to `required`) — a second deposit raises the bar even after the member had already qualified once.
