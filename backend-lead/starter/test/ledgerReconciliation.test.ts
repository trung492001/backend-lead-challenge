import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet, WalletTx } from '../src/db/models';
import { dec, ZERO } from '../src/lib/money';
import '../src/db/models';

const app = createApp();

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

async function createMember(username: string) {
  const res = await request(app).post('/members').send({ username });
  return res.body.member as { id: string };
}

async function depositAndComplete(memberId: string, amount: string, turnoverMultiplier: number) {
  const depositRes = await request(app)
    .post('/deposits')
    .send({ memberId, amount, turnoverMultiplier });
  await request(app)
    .post('/psp/callbacks')
    .send({ pspRef: depositRes.body.pspRef, status: 'completed', amount });
}

// DECISIONS.md #1: wallets.balance is only a cache; the ledger is the source
// of truth, so balance must always equal SUM(wallet_txs.amount) for the wallet.
describe('ledger reconciliation invariant', () => {
  it('keeps balance in sync with the ledger across a mixed deposit/wager/withdrawal sequence', async () => {
    const member = await createMember('reconuser01');

    await depositAndComplete(member.id, '100.00', 1); // +100, required += 100
    const wallet = await Wallet.findOne({ where: { memberId: member.id } });
    const walletId = wallet!.id as string;

    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '30.00' }); // -30, accrued += 30
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '20.00' }); // -20, accrued += 20

    await depositAndComplete(member.id, '50.00', 0); // +50, required += 0

    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '50.00' }); // -50, accrued += 50 (total 100)

    const withdrawRes = await request(app)
      .post('/withdrawals')
      .send({ memberId: member.id, amount: '20.00' }); // -20, requires accrued(100) >= required(100)
    expect(withdrawRes.status).toBe(201);

    const entries = await WalletTx.findAll({ where: { walletId } });
    const ledgerSum = entries.reduce((sum, entry) => sum.plus(dec(entry.amount)), ZERO);

    const finalWallet = await Wallet.findByPk(walletId);
    expect(finalWallet?.balance).toBe(ledgerSum.toFixed(18));
    // Sanity check the arithmetic actually exercised the sequence above.
    expect(finalWallet?.balance).toBe('30.000000000000000000');
  });
});
