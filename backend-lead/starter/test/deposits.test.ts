import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTransaction } from '../src/db/models';
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
  return res.body.member as { id: string; username: string };
}

describe('POST /deposits', () => {
  it('creates a pending deposit and returns an id and pspRef, with no balance movement', async () => {
    const member = await createMember('depuser01');

    const res = await request(app)
      .post('/deposits')
      .send({ memberId: member.id, amount: '100.50', turnoverMultiplier: 2 });

    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.pspRef).toEqual(expect.any(String));

    const tx = await FundingTransaction.findByPk(res.body.id);
    expect(tx?.status).toBe('pending');
    expect(tx?.type).toBe('deposit');
    expect(tx?.amount).toBe('100.500000000000000000');
    expect(tx?.turnoverMultiplier).toBe(2);

    const walletRes = await request(app).get(`/members/${member.id}/wallet`);
    expect(walletRes.body.balance).toBe('0.000000000000000000');
  });

  it('defaults turnoverMultiplier to 1 when omitted', async () => {
    const member = await createMember('depuser02');

    const res = await request(app).post('/deposits').send({ memberId: member.id, amount: '10' });

    expect(res.status).toBe(201);
    const tx = await FundingTransaction.findByPk(res.body.id);
    expect(tx?.turnoverMultiplier).toBe(1);
  });

  it('rejects a non-positive amount', async () => {
    const member = await createMember('depuser03');

    const res = await request(app).post('/deposits').send({ memberId: member.id, amount: '-5' });

    expect(res.status).toBe(400);
  });

  it('rejects a malformed amount string', async () => {
    const member = await createMember('depuser04');

    const res = await request(app).post('/deposits').send({ memberId: member.id, amount: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown memberId', async () => {
    const res = await request(app)
      .post('/deposits')
      .send({ memberId: '00000000-0000-0000-0000-000000000000', amount: '10' });

    expect(res.status).toBe(404);
  });
});
