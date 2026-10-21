import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Registro de cobros aprobados por la pasarela. Nunca guarda datos de tarjeta.
  await db.schema
    .createTable('payments')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('reservation_id', 'uuid', (col) =>
      col.notNull().unique().references('reservations.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('event_id', 'uuid', (col) =>
      col.notNull().references('events.id').onDelete('cascade'),
    )
    .addColumn('transaction_id', 'text', (col) => col.notNull().unique())
    .addColumn('amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('payments_status_check', sql`status IN ('APPROVED', 'REFUND_PENDING')`)
    .execute();
  await db.schema.createIndex('payments_status_idx').on('payments').column('status').execute();

  await db.schema
    .createTable('tickets')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('reservation_id', 'uuid', (col) =>
      col.notNull().unique().references('reservations.id').onDelete('cascade'),
    )
    .addColumn('payment_id', 'uuid', (col) =>
      col.notNull().unique().references('payments.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('event_id', 'uuid', (col) =>
      col.notNull().references('events.id').onDelete('cascade'),
    )
    .addColumn('seat_id', 'uuid', (col) => col.notNull().references('seats.id').onDelete('cascade'))
    .addColumn('amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('ISSUED'))
    .addColumn('issued_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('tickets_status_check', sql`status IN ('ISSUED', 'CANCELLED_BY_EVENT')`)
    .execute();

  // Mis tickets (orden y paginación) y cancelación por evento
  await sql`CREATE INDEX tickets_user_issued_idx ON tickets (user_id, issued_at DESC, id)`.execute(
    db,
  );
  await sql`CREATE INDEX tickets_event_issued_idx ON tickets (event_id) WHERE status = 'ISSUED'`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('tickets').execute();
  await db.schema.dropTable('payments').execute();
}
