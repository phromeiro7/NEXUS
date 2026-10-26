import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { ConflictError, NotFoundError } from './errors.js';
import { makeHolidayUseCases } from './holidays.js';

const U1 = 'user-1';
const U2 = 'user-2';

function setup() {
  const fakes = createFakes();
  return { fakes, uc: makeHolidayUseCases({ holidays: fakes.holidays }) };
}

describe('holidays', () => {
  it("creates and lists only the user's holidays, ordered by date", async () => {
    const { uc } = setup();
    const b = await uc.create(U1, { date: '2026-12-08', scope: 'municipal', name: 'B' });
    const a = await uc.create(U1, { date: '2026-11-20', scope: 'estadual', name: 'A' });
    await uc.create(U2, { date: '2026-11-21', scope: 'municipal', name: 'Other' });
    expect(await uc.list(U1)).toEqual([a, b]);
    expect((await uc.list(U2)).map((h) => h.name)).toEqual(['Other']);
  });

  it('duplicate date is a conflict for the same user only', async () => {
    const { uc } = setup();
    await uc.create(U1, { date: '2026-11-20', scope: 'municipal', name: 'A' });
    await expect(uc.create(U1, { date: '2026-11-20', scope: 'estadual', name: 'B' })).rejects.toEqual(
      new ConflictError('feriado_ja_cadastrado'),
    );
    await expect(uc.create(U2, { date: '2026-11-20', scope: 'municipal', name: 'C' })).resolves.toMatchObject({
      name: 'C',
    });
  });

  it('remove deletes own holiday; missing id is NotFound', async () => {
    const { uc } = setup();
    const h = await uc.create(U1, { date: '2026-11-20', scope: 'municipal', name: 'A' });
    await uc.remove(U1, h.id);
    expect(await uc.list(U1)).toEqual([]);
    await expect(uc.remove(U1, h.id)).rejects.toEqual(new NotFoundError('feriado'));
  });

  it("remove of another user's holiday is NotFound and leaves it untouched", async () => {
    const { uc } = setup();
    const mine = await uc.create(U1, { date: '2026-11-20', scope: 'municipal', name: 'A' });
    const theirs = await uc.create(U2, { date: '2026-11-20', scope: 'municipal', name: 'T' });
    await expect(uc.remove(U2, mine.id)).rejects.toEqual(new NotFoundError('feriado'));
    expect(await uc.list(U1)).toEqual([mine]);
    expect(await uc.list(U2)).toEqual([theirs]);
  });
});
