const jwt = require('jsonwebtoken');
const db = require('../config/db');

function normalizarPerfil(perfil) {
    return String(perfil || '').trim().toUpperCase();
}

function getBearerToken(req) {
    const auth = req.headers.authorization || '';
    return auth.startsWith('Bearer ') ? auth.split(' ')[1] : null;
}

// Verifica token JWT e se o usuário ainda está ativo no banco
async function autenticar(req, res, next) {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ erro: 'Não autorizado.' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        req.user.perfil = normalizarPerfil(req.user.perfil);
        // /me já valida sessão — evita query dupla em cada heartbeat
        if (req.path !== '/api/me') {
            const r = await db.query('SELECT ativo FROM usuarios WHERE id = $1 LIMIT 1', [req.user.id]);
            if (!r.rows.length || !r.rows[0].ativo) {
                return res.status(401).json({ erro: 'Usuário inativo ou removido. Faça login novamente.' });
            }
        }
        next();
    } catch {
        return res.status(401).json({ erro: 'Token inválido ou expirado.' });
    }
}

function somenteAdmin(req, res, next) {
    if (!req.user || normalizarPerfil(req.user.perfil) !== 'ADMIN') {
        return res.status(403).json({ erro: 'Acesso permitido somente para ADMIN.' });
    }
    next();
}

// Backward-compat: criarAuth still exported for any existing code that imports it
function criarAuth(JWT_SECRET) {
    return {
        autenticar,
        somenteAdmin,
        garantirParceiroPermitido: (req, parceiroId) => {
            if (!req.user) return false;
            if (normalizarPerfil(req.user.perfil) === 'ADMIN') return true;
            return Number(req.user.parceiro_id) === Number(parceiroId);
        }
    };
}

module.exports = { autenticar, somenteAdmin, normalizarPerfil, getBearerToken, criarAuth };
