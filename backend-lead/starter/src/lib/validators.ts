import { z } from 'zod';
import { dec } from './money';

export const positiveDecimalString = z.string().refine((value) => {
  try {
    return dec(value).isPositive();
  } catch {
    return false;
  }
}, 'must be a positive decimal string');
