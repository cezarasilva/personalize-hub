async function registrarAuditoria(db, usuarioId, acao) {
  try {
    await db.query('INSERT INTO logs_auditoria (usuario_id, acao) VALUES ($1, $2)', [usuarioId || null, acao]);
  } catch (err) {
    console.warn('⚠️ Falha ao registrar auditoria:', err.message);
  }
}
module.exports = { registrarAuditoria };
