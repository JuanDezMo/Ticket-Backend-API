import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('venue', 'text', (col) => col.notNull())
    .addColumn('price', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('capacity', 'integer', (col) => col.notNull())
    // Máximo de seats que un usuario puede tener reservados o comprados en este evento; sin valor por defecto
    .addColumn('max_seats_per_user', 'integer', (col) => col.notNull())
    .addColumn('start_date', 'timestamptz', (col) => col.notNull())
    .addColumn('end_date', 'timestamptz', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('ACTIVE'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('events_type_check', sql`type IN ('CONCERT', 'MEETUP', 'MEETING', 'OTHER')`)
    .addCheckConstraint('events_status_check', sql`status IN ('ACTIVE', 'CANCELLED')`)
    .addCheckConstraint('events_capacity_check', sql`capacity BETWEEN 1 AND 260`)
    .addCheckConstraint(
      'events_max_seats_per_user_check',
      sql`max_seats_per_user BETWEEN 1 AND 8 AND max_seats_per_user <= capacity`,
    )
    .addCheckConstraint('events_price_check', sql`price > 0`)
    .addCheckConstraint('events_dates_check', sql`end_date > start_date`)
    .execute();

  // Orden y paginación del listado, y filtros por estado y tipo
  await db.schema
    .createIndex('events_start_date_id_idx')
    .on('events')
    .columns(['start_date', 'id'])
    .execute();
  await db.schema.createIndex('events_status_idx').on('events').column('status').execute();
  await db.schema.createIndex('events_type_idx').on('events').column('type').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('events').execute();
}
