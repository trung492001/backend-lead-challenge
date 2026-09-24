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
