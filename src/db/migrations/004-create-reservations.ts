import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('reservations')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('seat_id', 'uuid', (col) => col.notNull().references('seats.id').onDelete('cascade'))
    .addColumn('event_id', 'uuid', (col) =>
      col.notNull().references('events.id').onDelete('cascade'),
    )
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('ACTIVE'))
    .addColumn('amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'reservations_status_check',
      sql`status IN ('ACTIVE', 'EXPIRED', 'CONFIRMED', 'CANCELLED')`,
    )
    .execute();

  // Un seat tiene como máximo una reserva ACTIVE (defensa en datos contra la doble reserva)
  await sql`CREATE UNIQUE INDEX reservations_seat_active_key ON reservations (seat_id) WHERE status = 'ACTIVE'`.execute(
    db,
  );
  // Búsqueda de reservas vencidas, global y por evento
  await sql`CREATE INDEX reservations_expires_at_active_idx ON reservations (expires_at) WHERE status = 'ACTIVE'`.execute(
    db,
  );
  await sql`CREATE INDEX reservations_event_active_idx ON reservations (event_id) WHERE status = 'ACTIVE'`.execute(
    db,
  );
  // Conteo del límite por evento (reservas ACTIVE y CONFIRMED del usuario en ese evento)
  await sql`CREATE INDEX reservations_user_event_hold_idx ON reservations (user_id, event_id) WHERE status IN ('ACTIVE', 'CONFIRMED')`.execute(
    db,
  );
  // Conteo del tope global (reservas ACTIVE del usuario en todos los eventos)
  await sql`CREATE INDEX reservations_user_active_idx ON reservations (user_id) WHERE status = 'ACTIVE'`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('reservations').execute();
}
