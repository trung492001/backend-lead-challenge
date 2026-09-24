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
