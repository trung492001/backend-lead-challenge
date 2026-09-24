import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet, WalletTx } from '../src/db/models';
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

async function createFundedWallet(username: string, balance: string) {
  const memberRes = await request(app).post('/members').send({ username });
  const member = memberRes.body.member as { id: string };
  const wallet = await Wallet.findOne({ where: { memberId: member.id } });
  await wallet!.update({ balance });
  return { memberId: member.id, walletId: wallet!.id as string };
}

describe('POST /wallets/:walletId/wagers', () => {
  it('debits the wallet and writes exactly one ledger entry', async () => {
    const { walletId } = await createFundedWallet('waguser01', '50.00');

    const res = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '10.00' });

    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));

    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('40.000000000000000000');

    const entries = await WalletTx.findAll({ where: { walletId } });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe('-10.000000000000000000');
    expect(entries[0].type).toBe('wager');
  });

  it('rejects when balance is insufficient, without creating any record', async () => {
    const { walletId } = await createFundedWallet('waguser02', '5.00');

    const res = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '10.00' });

    expect(res.status).toBe(422);

    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('5.000000000000000000');

    const entries = await WalletTx.findAll({ where: { walletId } });
    expect(entries).toHaveLength(0);
  });

  it('does not overdraw the wallet under concurrent wagers', async () => {
    const { walletId } = await createFundedWallet('waguser03', '15.00');

    const [res1, res2] = await Promise.all([
      request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '10.00' }),
      request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '10.00' }),
    ]);

    expect([res1.status, res2.status].sort()).toEqual([201, 422]);

    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('5.000000000000000000');

    const entries = await WalletTx.findAll({ where: { walletId } });
    expect(entries).toHaveLength(1);
  });

  it('returns 404 for an unknown walletId', async () => {
    const res = await request(app)
      .post('/wallets/00000000-0000-0000-0000-000000000000/wagers')
      .send({ amount: '10.00' });

    expect(res.status).toBe(404);
  });
});
