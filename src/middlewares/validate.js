const { z } = require('zod');

// Returns Express middleware that validates req.body against a Zod schema.
// On failure returns 400 with { erro: "...", detalhes: [...] }
function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const detalhes = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
            return res.status(400).json({ erro: detalhes[0], detalhes });
        }
        req.body = result.data;
        next();
    };
}

// ---- Schemas ----

const schemaLogin = z.object({
    usuario: z.string().min(1, 'Usuário é obrigatório.'),
    senha:   z.string().min(1, 'Senha é obrigatória.'),
});

const schemaCadastrarParceiro = z.object({
    nome_loja:   z.string().min(2,  'Nome da loja deve ter ao menos 2 caracteres.'),
    responsavel: z.string().min(2,  'Nome do responsável deve ter ao menos 2 caracteres.'),
    email:       z.string().email('E-mail inválido.'),
    usuario:     z.string().min(3,  'Usuário deve ter ao menos 3 caracteres.').regex(/^[a-zA-Z0-9._-]+$/, 'Usuário: apenas letras, números, ponto, traço e sublinhado.'),
    senha:       z.string().min(6,  'Senha deve ter ao menos 6 caracteres.'),
    telefone:    z.string().optional(),
    cnpj_cpf:    z.string().optional(),
    status:      z.enum(['ATIVO', 'PENDENTE', 'INATIVO']).optional(),
    cep:         z.string().optional(),
    rua:         z.string().optional(),
    numero:      z.string().optional(),
    complemento: z.string().optional(),
});

const schemaSolicitarParceiro = z.object({
    nome_loja:    z.string().min(2,  'Nome da loja é obrigatório.'),
    responsavel:  z.string().min(2,  'Nome do responsável é obrigatório.'),
    email_login:  z.string().email('E-mail inválido.'),
    senha_login:  z.string().min(6,  'Senha deve ter ao menos 6 caracteres.'),
    telefone:     z.string().optional(),
});

const schemaCriarProduto = z.object({
    nome:           z.string().min(2, 'Nome do produto é obrigatório.'),
    categoria:      z.string().optional(),
    descricao:      z.string().optional(),
    status:         z.enum(['ATIVO', 'INATIVO']).optional(),
    preco_venda:    z.union([z.string(), z.number()]).optional(),
    preco_repasse:  z.union([z.string(), z.number()]).optional(),
    custo_producao: z.union([z.string(), z.number()]).optional(),
    estoque_central:z.union([z.string(), z.number()]).optional(),
    sku:            z.string().optional(),
    variacao:       z.string().optional(),
});

const schemaCriarUsuario = z.object({
    nome:   z.string().min(2,  'Nome é obrigatório.'),
    email:  z.string().email('E-mail inválido.'),
    usuario:z.string().min(3,  'Usuário deve ter ao menos 3 caracteres.').regex(/^[a-zA-Z0-9._-]+$/, 'Usuário: apenas letras, números, ponto, traço e sublinhado.'),
    senha:  z.string().min(6,  'Senha deve ter ao menos 6 caracteres.'),
    perfil: z.enum(['ADMIN', 'PARCEIRO']).optional(),
});

const schemaRecuperarSenha = z.object({
    email: z.string().email('E-mail inválido.'),
});

const schemaResetSenha = z.object({
    token:    z.string().min(1, 'Token é obrigatório.'),
    novaSenha:z.string().min(6, 'A nova senha deve ter ao menos 6 caracteres.'),
});

module.exports = {
    validate,
    schemaLogin,
    schemaCadastrarParceiro,
    schemaSolicitarParceiro,
    schemaCriarProduto,
    schemaCriarUsuario,
    schemaRecuperarSenha,
    schemaResetSenha,
};
