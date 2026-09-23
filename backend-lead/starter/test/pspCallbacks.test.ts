import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../src/db/models';
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

async function createMemberWithDeposit(username: string, amount: string, turnoverMultiplier = 1) {
  const memberRes = await request(app).post('/members').send({ username });
  const member = memberRes.body.member as { id: string };

  const depositRes = await request(app)
    .post('/deposits')
    .send({ memberId: member.id, amount, turnoverMultiplier });

  return { memberId: member.id, pspRef: depositRes.body.pspRef as string, depositId: depositRes.body.id as string };
}

describe('POST /psp/callbacks', () => {
  it('credits the wallet exactly once on a completed callback, with one ledger entry', async () => {
    const { memberId, pspRef } = await createMemberWithDeposit('cbuser01', '100.50');

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'completed', amount: '100.50' });

    expect(res.status).toBe(200);

    const wallet = await Wallet.findOne({ where: { memberId } });
    expect(wallet?.balance).toBe('100.500000000000000000');

    const ledgerEntries = await WalletTx.findAll({ where: { walletId: wallet!.id } });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].amount).toBe('100.500000000000000000');
    expect(ledgerEntries[0].type).toBe('deposit');
  });

  it('does not double-credit on a sequential duplicate callback', async () => {
    const { memberId, pspRef } = await createMemberWithDeposit('cbuser02', '50.00');

    const res1 = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'completed', amount: '50.00' });
    const res2 = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'completed', amount: '50.00' });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const wallet = await Wallet.findOne({ where: { memberId } });
    expect(wallet?.balance).toBe('50.000000000000000000');

    const ledgerEntries = await WalletTx.findAll({ where: { walletId: wallet!.id } });
    expect(ledgerEntries).toHaveLength(1);
  });

  it('does not double-credit on concurrent duplicate callbacks', async () => {
    const { memberId, pspRef } = await createMemberWithDeposit('cbuser03', '75.00');

    const [res1, res2] = await Promise.all([
      request(app).post('/psp/callbacks').send({ pspRef, status: 'completed', amount: '75.00' }),
      request(app).post('/psp/callbacks').send({ pspRef, status: 'completed', amount: '75.00' }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const wallet = await Wallet.findOne({ where: { memberId } });
    expect(wallet?.balance).toBe('75.000000000000000000');

    const ledgerEntries = await WalletTx.findAll({ where: { walletId: wallet!.id } });
    expect(ledgerEntries).toHaveLength(1);
  });

  it('returns 404 for an unknown pspRef instead of crashing', async () => {
    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: 'psp_does_not_exist', status: 'completed', amount: '10' });

    expect(res.status).toBe(404);
  });

  it('marks the transaction failed without crediting the wallet', async () => {
    const { memberId, pspRef } = await createMemberWithDeposit('cbuser04', '20.00');

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'failed', amount: '20.00' });

    expect(res.status).toBe(200);

    const wallet = await Wallet.findOne({ where: { memberId } });
    expect(wallet?.balance).toBe('0.000000000000000000');

    const tx = await FundingTransaction.findOne({ where: { pspRef } });
    expect(tx?.status).toBe('failed');

    const ledgerEntries = await WalletTx.findAll({ where: { walletId: wallet!.id } });
    expect(ledgerEntries).toHaveLength(0);
  });

  it('does not apply a completed callback after the transaction already failed', async () => {
    const { memberId, pspRef } = await createMemberWithDeposit('cbuser05', '30.00');

    await request(app).post('/psp/callbacks').send({ pspRef, status: 'failed', amount: '30.00' });
    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef, status: 'completed', amount: '30.00' });

    expect(res.status).toBe(200);

    const wallet = await Wallet.findOne({ where: { memberId } });
    expect(wallet?.balance).toBe('0.000000000000000000');

    const tx = await FundingTransaction.findOne({ where: { pspRef } });
    expect(tx?.status).toBe('failed');
  });
});
