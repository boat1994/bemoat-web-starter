export async function up() {
  await db.run(sql`DROP TABLE users;`)
}

export async function down() {
  await db.run(sql`CREATE TABLE users (id INTEGER PRIMARY KEY);`)
}
