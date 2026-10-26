import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { makeCaseUseCases } from './cases.js';
import { ConflictError, NotFoundError } from './errors.js';

const U1 = 'user-1';
const U2 = 'user-2';

function setup() {
  const fakes = createFakes();
  return { fakes, uc: makeCaseUseCases({ cases: fakes.cases }) };
}

describe('cases', () => {
  it('creates and gets a case', async () => {
    const { uc } = setup();
    const c = await uc.create(U1, { number: '0001', clientName: 'Ana' });
    expect(c).toMatchObject({ number: '0001', clientName: 'Ana', status: 'ativo' });
    expect(await uc.get(U1, c.id)).toEqual(c);
  });

  it('duplicate number for the same user is a conflict; another user may reuse it', async () => {
    const { uc } = setup();
    await uc.create(U1, { number: '0001' });
    await expect(uc.create(U1, { number: '0001' })).rejects.toEqual(new ConflictError('numero_ja_cadastrado'));
    await expect(uc.create(U2, { number: '0001' })).resolves.toMatchObject({ number: '0001' });
  });

  it('update archives a case and the list filters by status, per user', async () => {
    const { uc } = setup();
    const a = await uc.create(U1, { number: 'A' });
    const b = await uc.create(U1, { number: 'B' });
    await uc.create(U2, { number: 'C' });
    const archived = await uc.update(U1, a.id, { status: 'arquivado' });
    expect(archived.status).toBe('arquivado');
    expect((await uc.list(U1, { status: 'ativo' })).map((c) => c.id)).toEqual([b.id]);
    expect((await uc.list(U1, { status: 'arquivado' })).map((c) => c.id)).toEqual([a.id]);
    expect((await uc.list(U1, {})).map((c) => c.number).sort()).toEqual(['A', 'B']);
  });

  it('update to a number already used conflicts', async () => {
    const { uc } = setup();
    await uc.create(U1, { number: 'A' });
    const b = await uc.create(U1, { number: 'B' });
    await expect(uc.update(U1, b.id, { number: 'A' })).rejects.toEqual(new ConflictError('numero_ja_cadastrado'));
  });

  it("get and update of another user's case are NotFound and leave it untouched", async () => {
    const { uc } = setup();
    const mine = await uc.create(U1, { number: 'A', clientName: 'Ana' });
    await uc.create(U2, { number: 'Z' });
    await expect(uc.get(U2, mine.id)).rejects.toEqual(new NotFoundError('processo'));
    await expect(uc.update(U2, mine.id, { status: 'arquivado', clientName: 'Hack' })).rejects.toEqual(
      new NotFoundError('processo'),
    );
    expect(await uc.get(U1, mine.id)).toEqual(mine);
    await expect(uc.get(U1, 'missing')).rejects.toEqual(new NotFoundError('processo'));
  });
});
