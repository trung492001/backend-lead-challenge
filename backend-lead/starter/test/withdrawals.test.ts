import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet } from '../src/db/models';
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

async function getWalletId(memberId: string) {
  const wallet = await Wallet.findOne({ where: { memberId } });
  return wallet!.id as string;
}

describe('POST /withdrawals', () => {
  it('blocks withdrawal when turnover has not been met', async () => {
    const member = await createMember('wduser01');
    await depositAndComplete(member.id, '100.00', 1);

    const res = await request(app).post('/withdrawals').send({ memberId: member.id, amount: '10.00' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('turnover_not_met');
    expect(res.body.outstandingTurnover).toBe('100');

    const wallet = await Wallet.findOne({ where: { memberId: member.id } });
    expect(wallet?.balance).toBe('100.000000000000000000');
  });

  it('allows withdrawal once accrued turnover meets the requirement', async () => {
    const member = await createMember('wduser02');

    // Deposit 1 sets a turnover requirement and is fully wagered to satisfy it.
    await depositAndComplete(member.id, '100.00', 1);
    const walletId = await getWalletId(member.id);
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '100.00' });

    // Deposit 2 adds spendable balance without adding to the requirement (multiplier 0).
    await depositAndComplete(member.id, '50.00', 0);

    const res = await request(app).post('/withdrawals').send({ memberId: member.id, amount: '30.00' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');

    const wallet = await Wallet.findOne({ where: { memberId: member.id } });
    expect(wallet?.balance).toBe('20.000000000000000000');
  });

  it('rejects when turnover is met but balance is insufficient', async () => {
    const member = await createMember('wduser03');
    await depositAndComplete(member.id, '100.00', 0); // multiplier 0 -> no turnover requirement

    const res = await request(app).post('/withdrawals').send({ memberId: member.id, amount: '150.00' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
  });

  it('returns 404 for an unknown memberId', async () => {
    const res = await request(app)
      .post('/withdrawals')
      .send({ memberId: '00000000-0000-0000-0000-000000000000', amount: '10.00' });

    expect(res.status).toBe(404);
  });
});
