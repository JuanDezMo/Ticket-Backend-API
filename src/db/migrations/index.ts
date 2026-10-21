import type { Migration } from 'kysely/migration';
import * as createUsers from './001-create-users.js';
import * as createEvents from './002-create-events.js';
import * as createSeats from './003-create-seats.js';
import * as createReservations from './004-create-reservations.js';
import * as createPaymentsAndTickets from './005-create-payments-and-tickets.js';
import * as addReservationCancelledByUser from './006-add-reservation-cancelled-by-user.js';

// Las migraciones se registran de forma estática para que funcionen igual en tsx y en dist/
export const migrations: Record<string, Migration> = {
  '001-create-users': createUsers,
  '002-create-events': createEvents,
  '003-create-seats': createSeats,
  '004-create-reservations': createReservations,
  '005-create-payments-and-tickets': createPaymentsAndTickets,
  '006-add-reservation-cancelled-by-user': addReservationCancelledByUser,
};
