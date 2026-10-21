import { sql, type Kysely } from 'kysely';

const CONSTRAINT = 'reservations_status_check';

// Nuevo estado CANCELLED_BY_USER: la reserva la canceló su dueño (CANCELLED queda para el evento)
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('reservations').dropConstraint(CONSTRAINT).execute();
  await db.schema
    .alterTable('reservations')
    .addCheckConstraint(
      CONSTRAINT,
      sql`status IN ('ACTIVE', 'EXPIRED', 'CONFIRMED', 'CANCELLED', 'CANCELLED_BY_USER')`,
    )
    .execute();
}

// Revierte siempre: las canceladas por el usuario pasan a CANCELLED y se pierde la causa
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE reservations SET status = 'CANCELLED' WHERE status = 'CANCELLED_BY_USER'`.execute(
    db,
  );
  await db.schema.alterTable('reservations').dropConstraint(CONSTRAINT).execute();
  await db.schema
    .alterTable('reservations')
    .addCheckConstraint(CONSTRAINT, sql`status IN ('ACTIVE', 'EXPIRED', 'CONFIRMED', 'CANCELLED')`)
    .execute();
}
