import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REMINDER_KINDS } from '../src/domain/reminders.js';

const schemaSql = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/0001_schema.sql', import.meta.url)),
  'utf8',
);

/** Values listed in `constraint <name> check (<column> in (...))`. */
function checkValues(constraint: string): string[] {
  const re = new RegExp(`constraint\\s+${constraint}\\s+check\\s*\\(\\s*\\w+\\s+in\\s*\\(([^)]*)\\)`, 'i');
  const m = re.exec(schemaSql);
  if (!m) throw new Error(`constraint ${constraint} not found in 0001_schema.sql`);
  return m[1]!.split(',').map((v) => v.trim().replace(/^'(.*)'$/, '$1'));
}

describe('migrations match the domain', () => {
  it('reminders_kind_check lists exactly REMINDER_KINDS', () => {
    expect(checkValues('reminders_kind_check')).toEqual([...REMINDER_KINDS]);
  });
});
