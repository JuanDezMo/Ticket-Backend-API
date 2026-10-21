import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('seats')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('event_id', 'uuid', (col) =>
      col.notNull().references('events.id').onDelete('cascade'),
    )
    .addColumn('row', sql`char(1)`, (col) => col.notNull())
    .addColumn('number', 'integer', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('AVAILABLE'))
    .addCheckConstraint(
      'seats_status_check',
      sql`status IN ('AVAILABLE', 'RESERVED', 'SOLD', 'BLOCKED')`,
    )
    .addCheckConstraint('seats_number_check', sql`number BETWEEN 1 AND 10`)
    .addUniqueConstraint('seats_event_row_number_key', ['event_id', 'row', 'number'])
    .execute();

  await db.schema
    .createIndex('seats_event_status_idx')
    .on('seats')
    .columns(['event_id', 'status'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('seats').execute();
}
