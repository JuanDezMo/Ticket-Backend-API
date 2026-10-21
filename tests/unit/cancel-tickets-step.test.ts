import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { CancelTicketsStep } from '../../src/modules/cancellations/steps/cancel-tickets.step.js';

describe('CancelTicketsStep', () => {
  it('delegates to TicketService.cancelByEvent with the transaction and returns the count', async () => {
    const tickets = { cancelByEvent: vi.fn().mockResolvedValue(3) };
    const trx = {} as Db;
    const step = new CancelTicketsStep(tickets as never);
    expect(step.name).toBe('tickets');
    expect(await step.execute('event-1', trx)).toBe(3);
    expect(tickets.cancelByEvent).toHaveBeenCalledWith('event-1', trx);
  });
});
