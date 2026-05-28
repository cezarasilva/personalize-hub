const jwt = require('jsonwebtoken');
function normalizarPerfil(perfil) { return String(perfil || '').trim().toUpperCase(); }
function getBearerToken(req) { const auth = req.headers.authorization || ''; return auth.startsWith('Bearer ') ? auth.split(' ')[1] : null; }
function criarAuth(JWT_SECRET) {
  function autenticar(req, res, next) {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ erro: 'Não autorizado.' });
    try { req.user = jwt.verify(token, JWT_SECRET); req.user.perfil = normalizarPerfil(req.user.perfil); next(); }
    catch { return res.status(401).json({ erro: 'Token inválido ou expirado.' }); }
  }
  function somenteAdmin(req, res, next) {
    if (!req.user || normalizarPerfil(req.user.perfil) !== 'ADMIN') return res.status(403).json({ erro: 'Acesso permitido somente para ADMIN.' });
    next();
  }
  function garantirParceiroPermitido(req, parceiroId) {
    if (!req.user) return false;
    if (normalizarPerfil(req.user.perfil) === 'ADMIN') return true;
    return Number(req.user.parceiro_id) === Number(parceiroId);
  }
  return { autenticar, somenteAdmin, garantirParceiroPermitido };
}
module.exports = { criarAuth, normalizarPerfil, getBearerToken };
