import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Un pedido por compra: agrupa las reservas pagadas juntas y guarda el monto total.
  await db.schema
    .createTable('orders')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('event_id', 'uuid', (col) =>
      col.notNull().references('events.id').onDelete('cascade'),
    )
    .addColumn('amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Registro del cobro de un pedido (uno por pedido) aprobado por la pasarela. Nunca guarda datos de tarjeta.
  await db.schema
    .createTable('payments')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('order_id', 'uuid', (col) =>
      col.notNull().unique().references('orders.id').onDelete('cascade'),
    )
    .addColumn('transaction_id', 'text', (col) => col.notNull().unique())
    .addColumn('amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('payments_status_check', sql`status IN ('APPROVED', 'REFUND_PENDING')`)
    .execute();
  await db.schema.createIndex('payments_status_idx').on('payments').column('status').execute();

  // Un ticket por reserva; varios tickets de un mismo pedido comparten pago
  await db.schema
    .createTable('tickets')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('reservation_id', 'uuid', (col) =>
      col.notNull().unique().references('reservations.id').onDelete('cascade'),
    )
    .addColumn('order_id', 'uuid', (col) =>
      col.notNull().references('orders.id').onDelete('cascade'),
    )
    .addColumn('payment_id', 'uuid', (col) =>
      col.notNull().references('payments.id').onDelete('cascade'),
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

  // Mis tickets (orden y paginación), cancelación por evento y búsqueda por pedido
  await sql`CREATE INDEX tickets_user_issued_idx ON tickets (user_id, issued_at DESC, id)`.execute(
    db,
  );
  await sql`CREATE INDEX tickets_event_issued_idx ON tickets (event_id) WHERE status = 'ISSUED'`.execute(
    db,
  );
  await db.schema.createIndex('tickets_order_idx').on('tickets').column('order_id').execute();

  // `orders` se crea aquí, después de `reservations` (migración 004): las columnas que apuntan a él se agregan ahora.
  // order_id: se llena cuando la reserva entra a un pedido pagado.
  // payment_started_at: reclamo atómico mientras se cobra, para no cobrar dos veces a la vez.
  await db.schema
    .alterTable('reservations')
    .addColumn('order_id', 'uuid', (col) => col.references('orders.id').onDelete('set null'))
    .addColumn('payment_started_at', 'timestamptz')
    .execute();
  await db.schema
    .createIndex('reservations_order_idx')
    .on('reservations')
    .column('order_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('reservations')
    .dropColumn('payment_started_at')
    .dropColumn('order_id')
    .execute();
  await db.schema.dropTable('tickets').execute();
  await db.schema.dropTable('payments').execute();
  await db.schema.dropTable('orders').execute();
}
