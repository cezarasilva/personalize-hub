async function transacao(db, callback) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const resultado = await callback(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw erro;
  } finally {
    client.release();
  }
}
module.exports = { transacao };
