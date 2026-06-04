const rateLimit = require('express-rate-limit');

const limiterLogin = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' }
});

const limiterCatalogoPublico = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas requisições. Aguarde alguns minutos.' }
});

const limiterSenha = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas de recuperação de senha. Aguarde 1 hora.' }
});

module.exports = { limiterLogin, limiterCatalogoPublico, limiterSenha };
