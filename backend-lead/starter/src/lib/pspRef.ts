import { randomUUID } from 'crypto';

// Opaque reference we generate at deposit time; the mock PSP echoes it back
// in the callback (POST /psp/callbacks) so we can look up the funding transaction.
export function generatePspRef(): string {
  return `psp_${randomUUID()}`;
}
