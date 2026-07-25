// bemoat:destructive-migration-approved

export async function up() {
  await db.run(sql`DROP TABLE legacy_users;`)
}

export async function down() {
  await db.run(sql`CREATE TABLE legacy_users (id INTEGER PRIMARY KEY);`)
}
