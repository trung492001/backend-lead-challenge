import { Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { FundingTransaction, Member, Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { generatePspRef } from '../lib/pspRef';
import { HttpError } from '../lib/httpError';

export type PspCallbackStatus = 'completed' | 'failed';

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
