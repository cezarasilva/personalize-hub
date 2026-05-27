require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const db = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'chave_super_secreta_personalize';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// =========================================================
// HELPERS
// =========================================================

function parseMoeda(valor) {
    if (valor === null || valor === undefined || valor === '') return 0;

    if (typeof valor === 'number') {
        return Number.isFinite(valor) ? Number(valor.toFixed(2)) : 0;
    }

    let texto = String(valor)
        .replace(/R\$/gi, '')
        .replace(/\s/g, '')
        .trim();

    if (!texto) return 0;

    const temVirgula = texto.includes(',');
    const temPonto = texto.includes('.');

    if (temVirgula && temPonto) {
        const ultimaVirgula = texto.lastIndexOf(',');
        const ultimoPonto = texto.lastIndexOf('.');
        if (ultimaVirgula > ultimoPonto) {
            texto = texto.replace(/\./g, '').replace(',', '.');
        } else {
            texto = texto.replace(/,/g, '');
        }
    } else if (temVirgula) {
        texto = texto.replace(',', '.');
    }

    texto = texto.replace(/[^0-9.-]/g, '');
    const numero = Number(texto);
    return Number.isFinite(numero) ? Number(numero.toFixed(2)) : 0;
}

function toInt(valor, padrao = 0) {
    const n = parseInt(valor, 10);
    return Number.isFinite(n) ? n : padrao;
}

function money(valor) {
    const n = Number(valor || 0);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function calcularCustosMaquina(dados = {}) {
    const valorCompra = parseMoeda(dados.valor_compra);
    const vidaUtilHoras = parseMoeda(dados.vida_util_horas);
    const potenciaKw = parseMoeda(dados.potencia_kw);
    const valorKwh = parseMoeda(dados.valor_kwh);
    const manutencao = parseMoeda(dados.custo_manutencao_hora);
    const custoHoraManual = parseMoeda(dados.custo_hora_manual);
    const usarManual = dados.usar_custo_manual === true || String(dados.usar_custo_manual).toLowerCase() === 'true';

    const depreciacao = vidaUtilHoras > 0 ? valorCompra / vidaUtilHoras : 0;
    const energia = potenciaKw * valorKwh;
    const calculado = depreciacao + energia + manutencao;
    const total = usarManual && custoHoraManual > 0 ? custoHoraManual : calculado;

    return {
        custo_depreciacao_hora: Number(depreciacao.toFixed(4)),
        custo_energia_hora: Number(energia.toFixed(4)),
        custo_total_hora: Number(total.toFixed(4)),
        custo_hora_manual: custoHoraManual,
        usar_custo_manual: usarManual
    };
}

function normalizarPerfil(perfil) {
    return String(perfil || '').trim().toUpperCase();
}

function gerarCodigo(prefixo) {
    const agora = new Date();
    const yyyy = agora.getFullYear();
    const mm = String(agora.getMonth() + 1).padStart(2, '0');
    const dd = String(agora.getDate()).padStart(2, '0');
    const hh = String(agora.getHours()).padStart(2, '0');
    const mi = String(agora.getMinutes()).padStart(2, '0');
    const ss = String(agora.getSeconds()).padStart(2, '0');
    const rnd = Math.floor(Math.random() * 900 + 100);
    return `${prefixo}-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rnd}`;
}

function getBearerToken(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    return auth.split(' ')[1];
}

function autenticar(req, res, next) {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ erro: 'Não autorizado.' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        req.user.perfil = normalizarPerfil(req.user.perfil);
        next();
    } catch (err) {
        return res.status(401).json({ erro: 'Token inválido ou expirado.' });
    }
}

function somenteAdmin(req, res, next) {
    if (!req.user || normalizarPerfil(req.user.perfil) !== 'ADMIN') {
        return res.status(403).json({ erro: 'Acesso permitido somente para ADMIN.' });
    }
    next();
}

function garantirParceiroPermitido(req, parceiroId) {
    if (!req.user) return false;
    if (normalizarPerfil(req.user.perfil) === 'ADMIN') return true;
    return Number(req.user.parceiro_id) === Number(parceiroId);
}

async function transacao(callback) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resultado = await callback(client);
        await client.query('COMMIT');
        return resultado;
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }
}

async function registrarAuditoria(usuarioId, acao) {
    try {
        await db.query(
            'INSERT INTO logs_auditoria (usuario_id, acao) VALUES ($1, $2)',
            [usuarioId || null, acao]
        );
    } catch (err) {
        console.warn('⚠️ Falha ao registrar auditoria:', err.message);
    }
}

async function registrarMovimentacao(clientOrDb, dados) {
    const executor = clientOrDb || db;
    const usarSavepoint = !!clientOrDb;
    const sp = 'sp_movimentacao_estoque';

    try {
        if (usarSavepoint) await executor.query(`SAVEPOINT ${sp}`);
        await executor.query(
            `INSERT INTO movimentacoes_estoque (
                produto_id, variacao_id, parceiro_id, usuario_id,
                tipo, quantidade, estoque_origem, estoque_destino,
                referencia_tipo, referencia_id, observacao
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
                dados.produto_id || null,
                dados.variacao_id || null,
                dados.parceiro_id || null,
                dados.usuario_id || null,
                dados.tipo,
                toInt(dados.quantidade, 0),
                dados.estoque_origem || null,
                dados.estoque_destino || null,
                dados.referencia_tipo || null,
                dados.referencia_id || null,
                dados.observacao || null
            ]
        );
        if (usarSavepoint) await executor.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
        if (usarSavepoint) {
            try { await executor.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch (_) {}
            try { await executor.query(`RELEASE SAVEPOINT ${sp}`); } catch (_) {}
        }
        console.warn('⚠️ Falha ao registrar movimentação. Operação principal continua:', err.message);
    }
}

async function uploadImagemProduto(file) {
    if (!file) return null;
    if (!supabase) throw new Error('Supabase Storage não configurado. Verifique SUPABASE_URL e SUPABASE_KEY.');

    const nomeSeguro = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '');
    const nomeArq = `${Date.now()}_${nomeSeguro}`;
    const { error } = await supabase.storage
        .from('produtos')
        .upload(nomeArq, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) throw error;
    const { data } = supabase.storage.from('produtos').getPublicUrl(nomeArq);
    return data.publicUrl;
}


function arquivosProduto(req) {
    const arquivos = [];

    if (req.files?.imagens?.length) arquivos.push(...req.files.imagens);
    if (req.files?.imagem?.length && arquivos.length === 0) arquivos.push(req.files.imagem[0]);
    if (req.file && arquivos.length === 0) arquivos.push(req.file);

    return arquivos.slice(0, 10);
}

async function uploadImagensProduto(arquivos) {
    const lista = Array.isArray(arquivos) ? arquivos.slice(0, 10) : [];
    const urls = [];

    for (const file of lista) {
        const url = await uploadImagemProduto(file);
        if (url) urls.push(url);
    }

    return urls;
}

async function salvarGaleriaProduto(client, produtoId, urls) {
    const imagens = Array.isArray(urls) ? urls.filter(Boolean).slice(0, 10) : [];
    if (!imagens.length) return null;

    const sp = 'sp_galeria_produto';
    try {
        await client.query(`SAVEPOINT ${sp}`);
        await client.query('DELETE FROM produto_imagens WHERE produto_id = $1', [produtoId]);

        for (let i = 0; i < imagens.length; i++) {
            await client.query(
                `INSERT INTO produto_imagens (produto_id, imagem_url, ordem, principal)
                 VALUES ($1, $2, $3, $4)`,
                [produtoId, imagens[i], i + 1, i === 0]
            );
        }
        await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
        try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch (_) {}
        try { await client.query(`RELEASE SAVEPOINT ${sp}`); } catch (_) {}

        if (String(err.message || '').includes('produto_imagens')) {
            console.warn('⚠️ Tabela produto_imagens não existe. Salvando apenas imagem principal em produtos.imagem_url. Rode o SQL de correção.');
        } else {
            throw err;
        }
    }

    await client.query('UPDATE produtos SET imagem_url = $1 WHERE id = $2', [imagens[0], produtoId]);
    return imagens[0];
}


function gerarSkuAutomatico(nome, categoria, produtoId) {
    const limpar = (texto, fallback) => {
        const s = String(texto || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase();
        return (s.slice(0, 3) || fallback);
    };
    return `${limpar(categoria, 'PRD')}-${limpar(nome, 'PRO')}-${String(produtoId || Date.now()).padStart(4, '0')}`;
}

function normalizarSku(valor) {
    const sku = String(valor || '').trim();
    return sku ? sku : null;
}

async function salvarPrecificacaoProduto(client, produtoId, variacaoId, body, usuarioId) {
    const precificado = String(body.precificado || '').toLowerCase() === 'true' || String(body.precificado || '').toLowerCase() === 'sim';
    if (!precificado) return;

    const dados = {
        peso_gramas: parseMoeda(body.peso_gramas),
        valor_kg_material: parseMoeda(body.valor_kg_material),
        quantidade_produzida: Math.max(1, toInt(body.quantidade_produzida, 1)),
        unidade_precificacao: body.unidade_precificacao || 'UNIDADE',
        maquina_id: body.maquina_id ? toInt(body.maquina_id, 0) : null,
        maquina_nome_snapshot: body.maquina_nome_snapshot || null,
        tempo_maquina_horas: parseMoeda(body.tempo_maquina_horas),
        valor_hora_maquina: parseMoeda(body.valor_hora_maquina),
        custo_material: parseMoeda(body.custo_material),
        custo_maquina: parseMoeda(body.custo_maquina),
        custo_energia: parseMoeda(body.custo_energia),
        custo_mao_obra: parseMoeda(body.custo_mao_obra),
        custo_embalagem: parseMoeda(body.custo_embalagem),
        custo_acessorios: parseMoeda(body.custo_acessorios),
        custo_perdas: parseMoeda(body.custo_perdas),
        custo_extra: parseMoeda(body.custo_extra),
        custo_total: parseMoeda(body.custo_total || body.custo_producao),
        custo_total_producao: parseMoeda(body.custo_total_producao || body.custo_total || body.custo_producao),
        custo_unitario: parseMoeda(body.custo_unitario || body.custo_producao),
        custo_hora_maquina: parseMoeda(body.custo_hora_maquina || body.valor_hora_maquina),
        custo_total_maquina: parseMoeda(body.custo_total_maquina || body.custo_maquina),
        margem_percentual: parseMoeda(body.margem_percentual),
        taxa_canal_percentual: parseMoeda(body.taxa_canal_percentual),
        taxa_canal_fixa: parseMoeda(body.taxa_canal_fixa),
        preco_sugerido: parseMoeda(body.preco_sugerido || body.preco_venda),
        preco_sugerido_unitario: parseMoeda(body.preco_sugerido_unitario || body.preco_sugerido || body.preco_venda),
        preco_venda_final: parseMoeda(body.preco_venda_final || body.preco_venda),
        preco_final_unitario: parseMoeda(body.preco_final_unitario || body.preco_venda_final || body.preco_venda),
        preco_total_lote: parseMoeda(body.preco_total_lote),
        preco_repasse_final: parseMoeda(body.preco_repasse),
        canal_venda: body.canal_venda || 'Venda direta',
        tipo_precificacao: 'IMPRESSAO_3D'
    };

    const sp = 'sp_precificacao_produto';
    try {
        await client.query(`SAVEPOINT ${sp}`);
        await client.query(
            `INSERT INTO precificacoes (
                produto_id, variacao_id, usuario_id, tipo_precificacao, canal_venda,
                peso_gramas, valor_kg_material, quantidade_produzida, unidade_precificacao,
                maquina_id, maquina_nome_snapshot, tempo_maquina_horas, valor_hora_maquina, custo_hora_maquina, custo_total_maquina,
                custo_material, custo_maquina, custo_energia, custo_mao_obra,
                custo_embalagem, custo_acessorios, custo_perdas, custo_extra,
                custo_total, custo_total_producao, custo_unitario,
                margem_percentual, taxa_canal_percentual, taxa_canal_fixa,
                preco_sugerido, preco_sugerido_unitario, preco_venda_final, preco_final_unitario, preco_total_lote, preco_repasse_final
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35
            )`,
            [
                produtoId, variacaoId || null, usuarioId || null, dados.tipo_precificacao, dados.canal_venda,
                dados.peso_gramas, dados.valor_kg_material, dados.quantidade_produzida, dados.unidade_precificacao,
                dados.maquina_id, dados.maquina_nome_snapshot, dados.tempo_maquina_horas, dados.valor_hora_maquina, dados.custo_hora_maquina, dados.custo_total_maquina,
                dados.custo_material, dados.custo_maquina, dados.custo_energia, dados.custo_mao_obra,
                dados.custo_embalagem, dados.custo_acessorios, dados.custo_perdas, dados.custo_extra,
                dados.custo_total, dados.custo_total_producao, dados.custo_unitario,
                dados.margem_percentual, dados.taxa_canal_percentual, dados.taxa_canal_fixa,
                dados.preco_sugerido, dados.preco_sugerido_unitario, dados.preco_venda_final, dados.preco_final_unitario, dados.preco_total_lote, dados.preco_repasse_final
            ]
        );
        await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
        try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch (_) {}
        try { await client.query(`RELEASE SAVEPOINT ${sp}`); } catch (_) {}
        console.warn('⚠️ Falha ao salvar histórico de precificação. Produto será salvo normalmente:', err.message);
    }
}

function inicioFimMes(mesReferencia) {
    // Aceita YYYY-MM, MM/YYYY ou YYYY/MM
    let ano;
    let mes;

    const texto = String(mesReferencia || '').trim();
    if (/^\d{4}-\d{2}$/.test(texto)) {
        [ano, mes] = texto.split('-').map(Number);
    } else if (/^\d{2}\/\d{4}$/.test(texto)) {
        const partes = texto.split('/').map(Number);
        mes = partes[0];
        ano = partes[1];
    } else if (/^\d{4}\/\d{2}$/.test(texto)) {
        [ano, mes] = texto.split('/').map(Number);
    } else {
        const hoje = new Date();
        ano = hoje.getFullYear();
        mes = hoje.getMonth() + 1;
    }

    const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const proximoMes = mes === 12 ? 1 : mes + 1;
    const proximoAno = mes === 12 ? ano + 1 : ano;
    const fim = `${proximoAno}-${String(proximoMes).padStart(2, '0')}-01`;
    const ref = `${ano}-${String(mes).padStart(2, '0')}`;
    return { inicio, fim, ref };
}

// =========================================================
// AUTH / SENHA
// =========================================================

app.post('/api/login', async (req, res) => {
    try {
        const { usuario, senha } = req.body;
        if (!usuario || !senha) return res.status(400).json({ erro: 'Usuário e senha são obrigatórios.' });

        const resU = await db.query(
            `SELECT * FROM usuarios WHERE usuario = $1 OR email = $1 LIMIT 1`,
            [usuario]
        );

        if (resU.rows.length === 0) return res.status(401).json({ erro: 'Usuário ou senha incorretos!' });

        const user = resU.rows[0];
        if (user.ativo === false || String(user.status || '').toUpperCase() === 'INATIVO') {
            return res.status(403).json({ erro: 'Acesso bloqueado ou em análise.' });
        }

        const valida = await bcrypt.compare(senha, user.senha_hash);
        if (!valida) return res.status(401).json({ erro: 'Usuário ou senha incorretos!' });

        const perfil = normalizarPerfil(user.perfil);
        const token = jwt.sign(
            { id: user.id, perfil, parceiro_id: user.parceiro_id || null },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            usuario: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                perfil,
                parceiro_id: user.parceiro_id,
                usuario: user.usuario
            }
        });
    } catch (e) {
        console.error('❌ Erro login:', e);
        res.status(500).json({ erro: 'Erro interno no login.' });
    }
});

app.get('/api/me', autenticar, async (req, res) => {
    try {
        const u = await db.query(
            `SELECT u.id, u.nome, u.email, u.usuario, u.perfil, u.parceiro_id, p.nome_loja
             FROM usuarios u
             LEFT JOIN parceiros p ON p.id = u.parceiro_id
             WHERE u.id = $1`,
            [req.user.id]
        );
        if (u.rows.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });
        res.json(u.rows[0]);
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao buscar usuário logado.' });
    }
});

app.post('/api/usuarios/recuperar', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ erro: 'Email é obrigatório.' });

        const userRes = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ erro: 'E-mail não encontrado no sistema.' });
        if (!resend) return res.status(500).json({ erro: 'Resend não configurado no servidor.' });

        const user = userRes.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        const host = req.get('host');
        const protocolo = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const link = `${protocolo}://${host}/redefinir-senha.html?token=${token}`;

        const { error } = await resend.emails.send({
            from: process.env.RESEND_FROM || 'PERSONALIZE Hub <onboarding@resend.dev>',
            to: email,
            subject: 'Recuperação de senha - PERSONALIZE Hub',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; color: #111827;">
                    <h2 style="color: #2563eb; text-align: center;">PERSONALIZE Hub</h2>
                    <p>Olá, <strong>${user.nome}</strong>.</p>
                    <p>Recebemos um pedido para redefinir sua senha de acesso.</p>
                    <p>Seu usuário é: <strong>${user.usuario || user.email}</strong></p>
                    <p style="text-align:center; margin: 30px 0;">
                        <a href="${link}" style="background:#10b981;color:white;padding:14px 24px;text-decoration:none;border-radius:8px;font-weight:bold;">Redefinir senha</a>
                    </p>
                    <p style="font-size:13px;color:#ef4444;text-align:center;">Este link expira em 1 hora.</p>
                </div>`
        });

        if (error) {
            console.error('❌ Erro Resend:', error);
            return res.status(500).json({ erro: 'Erro ao enviar e-mail pela API.' });
        }

        res.json({ mensagem: 'Link de recuperação enviado com sucesso!' });
    } catch (erro) {
        console.error('❌ ERRO RECUPERAÇÃO:', erro);
        res.status(500).json({ erro: 'Erro interno no servidor.' });
    }
});

app.post('/api/usuarios/reset-password', async (req, res) => {
    try {
        const { token, novaSenha } = req.body;
        if (!token || !novaSenha) return res.status(400).json({ erro: 'Dados inválidos.' });
        if (String(novaSenha).length < 6) return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres.' });

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(400).json({ erro: 'Link expirado ou inválido. Solicite novamente.' });
        }

        const hash = await bcrypt.hash(novaSenha, 10);
        await db.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, decoded.id]);
        res.status(200).json({ mensagem: 'Senha redefinida com sucesso!' });
    } catch (erro) {
        console.error('❌ ERRO RESET:', erro);
        res.status(500).json({ erro: 'Erro ao redefinir a senha.' });
    }
});

// =========================================================
// USUÁRIOS
// =========================================================

app.get('/api/usuarios', autenticar, somenteAdmin, async (req, res) => {
    try {
        const u = await db.query(
            `SELECT u.id, u.nome, u.email, u.usuario, u.perfil, u.ativo, u.status, u.parceiro_id, p.nome_loja
             FROM usuarios u
             LEFT JOIN parceiros p ON u.parceiro_id = p.id
             ORDER BY u.id DESC`
        );
        res.json(u.rows);
    } catch (e) {
        console.error('❌ Erro usuários:', e);
        res.status(500).json({ erro: 'Erro ao buscar usuários.' });
    }
});

app.put('/api/usuarios/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        const { nome, senha, ativo, perfil, usuario, email, parceiro_id } = req.body;

        if (senha) {
            const hash = await bcrypt.hash(senha, 10);
            await db.query(
                `UPDATE usuarios
                 SET nome = COALESCE($1, nome), senha_hash = $2, ativo = COALESCE($3, ativo),
                     perfil = COALESCE($4, perfil), usuario = COALESCE($5, usuario), email = COALESCE($6, email),
                     parceiro_id = COALESCE($7, parceiro_id)
                 WHERE id = $8`,
                [nome, hash, ativo, perfil, usuario, email, parceiro_id, req.params.id]
            );
        } else {
            await db.query(
                `UPDATE usuarios
                 SET nome = COALESCE($1, nome), ativo = COALESCE($2, ativo),
                     perfil = COALESCE($3, perfil), usuario = COALESCE($4, usuario), email = COALESCE($5, email),
                     parceiro_id = COALESCE($6, parceiro_id)
                 WHERE id = $7`,
                [nome, ativo, perfil, usuario, email, parceiro_id, req.params.id]
            );
        }

        await registrarAuditoria(req.user.id, `Atualizou usuário ID ${req.params.id}`);
        res.json({ mensagem: '✅ Usuário atualizado!' });
    } catch (e) {
        console.error('❌ Erro atualizar usuário:', e);
        res.status(500).json({ erro: 'Erro ao atualizar usuário: ' + e.message });
    }
});

app.delete('/api/usuarios/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        if (Number(req.params.id) === Number(req.user.id)) {
            return res.status(400).json({ erro: 'Você não pode excluir seu próprio usuário logado.' });
        }
        await db.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
        await registrarAuditoria(req.user.id, `Removeu usuário ID ${req.params.id}`);
        res.json({ mensagem: '✅ Usuário removido.' });
    } catch (e) {
        console.error('❌ Erro excluir usuário:', e);
        res.status(500).json({ erro: 'Erro ao excluir usuário.' });
    }
});

// =========================================================
// PARCEIROS / LOJAS
// =========================================================

app.get('/api/parceiros', autenticar, async (req, res) => {
    try {
        if (req.user.perfil === 'PARCEIRO') {
            const d = await db.query(
                `SELECT p.*, u.usuario, u.email as email_login
                 FROM parceiros p
                 LEFT JOIN usuarios u ON u.parceiro_id = p.id
                 WHERE p.id = $1
                 ORDER BY p.id DESC`,
                [req.user.parceiro_id]
            );
            return res.json(d.rows);
        }

        const d = await db.query(
            `SELECT p.*, u.usuario, u.email as email_login
             FROM parceiros p
             LEFT JOIN usuarios u ON u.parceiro_id = p.id
             ORDER BY p.id DESC`
        );
        res.json(d.rows);
    } catch (e) {
        console.error('❌ Erro parceiros:', e);
        res.status(500).json({ erro: 'Erro ao buscar parceiros.' });
    }
});


app.get('/api/parceiros/:id', autenticar, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ erro: 'ID da loja inválido.' });

        if (req.user.perfil === 'PARCEIRO' && Number(req.user.parceiro_id) !== id) {
            return res.status(403).json({ erro: 'Você só pode consultar os dados da sua própria loja.' });
        }

        const d = await db.query(
            `SELECT p.*, u.usuario, u.email as email_login
             FROM parceiros p
             LEFT JOIN usuarios u ON u.parceiro_id = p.id
             WHERE p.id = $1
             LIMIT 1`,
            [id]
        );

        if (!d.rows.length) return res.status(404).json({ erro: 'Loja não encontrada.' });
        res.json(d.rows[0]);
    } catch (e) {
        console.error('❌ Erro parceiro por ID:', e);
        res.status(500).json({ erro: 'Erro ao buscar loja.' });
    }
});

app.post('/api/parceiros', autenticar, somenteAdmin, async (req, res) => {
    try {
        const { nome_loja, responsavel, telefone, email, usuario, senha, cnpj_cpf, cep, rua, numero, complemento } = req.body;
        if (!nome_loja || !responsavel || !email || !usuario || !senha) {
            return res.status(400).json({ erro: 'Nome da loja, responsável, e-mail, usuário e senha são obrigatórios.' });
        }

        const checkUser = await db.query('SELECT id FROM usuarios WHERE email = $1 OR usuario = $2', [email, usuario]);
        if (checkUser.rows.length > 0) return res.status(400).json({ erro: 'E-mail ou nome de usuário já em uso!' });

        await transacao(async (client) => {
            const novaLoja = await client.query(
                `INSERT INTO parceiros (nome_loja, responsavel, telefone, status, cnpj_cpf, cep, rua, numero, complemento)
                 VALUES ($1, $2, $3, 'ATIVO', $4, $5, $6, $7, $8)
                 RETURNING id`,
                [nome_loja, responsavel, telefone || null, cnpj_cpf || null, cep || null, rua || null, numero || null, complemento || null]
            );

            const hash = await bcrypt.hash(senha, 10);
            await client.query(
                `INSERT INTO usuarios (nome, email, usuario, senha_hash, perfil, parceiro_id, ativo)
                 VALUES ($1, $2, $3, $4, 'PARCEIRO', $5, true)`,
                [responsavel, email, usuario, hash, novaLoja.rows[0].id]
            );
        });

        await registrarAuditoria(req.user.id, `Cadastrou parceiro ${nome_loja}`);
        res.status(201).json({ mensagem: '✅ Parceiro cadastrado com sucesso!' });
    } catch (erro) {
        console.error('❌ Erro cadastrar parceiro:', erro);
        res.status(500).json({ erro: 'Erro interno: ' + erro.message });
    }
});

app.post('/api/parceiros/solicitar', async (req, res) => {
    try {
        const { nome_loja, responsavel, telefone, email_login, senha_login } = req.body;
        if (!nome_loja || !responsavel || !email_login || !senha_login) {
            return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });
        }

        const check = await db.query('SELECT id FROM usuarios WHERE email = $1', [email_login]);
        if (check.rows.length > 0) return res.status(400).json({ erro: 'Este e-mail já está em uso!' });

        await transacao(async (client) => {
            const novaLoja = await client.query(
                `INSERT INTO parceiros (nome_loja, responsavel, telefone, status)
                 VALUES ($1, $2, $3, 'PENDENTE') RETURNING id`,
                [nome_loja, responsavel, telefone || null]
            );

            const hash = await bcrypt.hash(senha_login, 10);
            await client.query(
                `INSERT INTO usuarios (nome, email, senha_hash, perfil, parceiro_id, ativo)
                 VALUES ($1, $2, $3, 'PARCEIRO', $4, false)`,
                [responsavel, email_login, hash, novaLoja.rows[0].id]
            );
        });

        res.status(201).json({ mensagem: '✅ Solicitação enviada! Aguarde nossa análise.' });
    } catch (erro) {
        console.error('❌ Erro solicitar parceiro:', erro);
        res.status(500).json({ erro: 'Erro interno ao enviar solicitação.' });
    }
});

app.put('/api/parceiros/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome_loja, responsavel, telefone, status, usuario, cnpj_cpf, cep, rua, numero, complemento } = req.body;

        await transacao(async (client) => {
            const resultado = await client.query(
                `UPDATE parceiros
                 SET nome_loja = COALESCE($1, nome_loja),
                     responsavel = COALESCE($2, responsavel),
                     telefone = COALESCE($3, telefone),
                     status = COALESCE($4, status),
                     cnpj_cpf = COALESCE($5, cnpj_cpf),
                     cep = COALESCE($6, cep),
                     rua = COALESCE($7, rua),
                     numero = COALESCE($8, numero),
                     complemento = COALESCE($9, complemento)
                 WHERE id = $10
                 RETURNING *`,
                [nome_loja, responsavel, telefone, status, cnpj_cpf, cep, rua, numero, complemento, id]
            );

            if (resultado.rowCount === 0) throw new Error('Loja não encontrada.');

            if (usuario) {
                await client.query('UPDATE usuarios SET usuario = $1 WHERE parceiro_id = $2', [usuario, id]);
            }

            if (status === 'ATIVO') {
                await client.query('UPDATE usuarios SET ativo = true WHERE parceiro_id = $1', [id]);
            } else if (status === 'INATIVO' || status === 'PENDENTE') {
                await client.query('UPDATE usuarios SET ativo = false WHERE parceiro_id = $1', [id]);
            }
        });

        await registrarAuditoria(req.user.id, `Atualizou parceiro ID ${id}`);
        res.json({ mensagem: '✅ Loja atualizada com sucesso!' });
    } catch (erro) {
        console.error('❌ Erro atualizar parceiro:', erro);
        res.status(500).json({ erro: 'Erro interno: ' + erro.message });
    }
});

app.delete('/api/parceiros/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await transacao(async (client) => {
            await client.query('DELETE FROM consignacoes_estoque WHERE parceiro_id = $1', [id]);
            await client.query('DELETE FROM financeiro_repasses WHERE parceiro_id = $1', [id]);
            await client.query('DELETE FROM usuarios WHERE parceiro_id = $1', [id]);
            await client.query('DELETE FROM parceiros WHERE id = $1', [id]);
        });
        await registrarAuditoria(req.user.id, `Removeu parceiro ID ${id}`);
        res.json({ mensagem: '🗑️ Parceiro removido com sucesso!' });
    } catch (e) {
        console.error('❌ Erro deletar parceiro:', e);
        res.status(500).json({ erro: 'Erro ao deletar parceiro: ' + e.message });
    }
});


// =========================================================
// MÁQUINAS / EQUIPAMENTOS PARA PRECIFICAÇÃO
// =========================================================

app.get('/api/maquinas', autenticar, somenteAdmin, async (req, res) => {
    try {
        const r = await db.query(`SELECT * FROM maquinas ORDER BY status ASC, nome ASC, id DESC`);
        res.json(r.rows);
    } catch (e) {
        console.error('❌ Erro máquinas:', e);
        res.status(500).json({ erro: 'Erro ao listar máquinas: ' + e.message });
    }
});

app.post('/api/maquinas', autenticar, somenteAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.nome) return res.status(400).json({ erro: 'Nome da máquina é obrigatório.' });
        const c = calcularCustosMaquina(body);
        const r = await db.query(`
            INSERT INTO maquinas (
                nome, modelo, tipo, valor_compra, vida_util_horas, potencia_kw, valor_kwh,
                custo_manutencao_hora, custo_depreciacao_hora, custo_energia_hora, custo_total_hora,
                custo_hora_manual, usar_custo_manual, status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [
                body.nome, body.modelo || null, body.tipo || 'OUTRA', parseMoeda(body.valor_compra), parseMoeda(body.vida_util_horas),
                parseMoeda(body.potencia_kw), parseMoeda(body.valor_kwh), parseMoeda(body.custo_manutencao_hora),
                c.custo_depreciacao_hora, c.custo_energia_hora, c.custo_total_hora, c.custo_hora_manual, c.usar_custo_manual, body.status || 'ATIVA'
            ]
        );
        await registrarAuditoria(req.user.id, `Cadastrou máquina ${body.nome}`);
        res.status(201).json(r.rows[0]);
    } catch (e) {
        console.error('❌ Erro cadastrar máquina:', e);
        res.status(500).json({ erro: 'Erro ao cadastrar máquina: ' + e.message });
    }
});

app.put('/api/maquinas/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const c = calcularCustosMaquina(body);
        const r = await db.query(`
            UPDATE maquinas SET
                nome = COALESCE($1, nome), modelo = $2, tipo = COALESCE($3, tipo),
                valor_compra = $4, vida_util_horas = $5, potencia_kw = $6, valor_kwh = $7,
                custo_manutencao_hora = $8, custo_depreciacao_hora = $9, custo_energia_hora = $10, custo_total_hora = $11,
                custo_hora_manual = $12, usar_custo_manual = $13, status = COALESCE($14, status), atualizado_em = CURRENT_TIMESTAMP
            WHERE id = $15 RETURNING *`,
            [
                body.nome || null, body.modelo || null, body.tipo || null, parseMoeda(body.valor_compra), parseMoeda(body.vida_util_horas),
                parseMoeda(body.potencia_kw), parseMoeda(body.valor_kwh), parseMoeda(body.custo_manutencao_hora),
                c.custo_depreciacao_hora, c.custo_energia_hora, c.custo_total_hora, c.custo_hora_manual, c.usar_custo_manual, body.status || null, req.params.id
            ]
        );
        if (r.rows.length === 0) return res.status(404).json({ erro: 'Máquina não encontrada.' });
        await registrarAuditoria(req.user.id, `Editou máquina ID ${req.params.id}`);
        res.json(r.rows[0]);
    } catch (e) {
        console.error('❌ Erro editar máquina:', e);
        res.status(500).json({ erro: 'Erro ao editar máquina: ' + e.message });
    }
});

app.delete('/api/maquinas/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM maquinas WHERE id = $1', [req.params.id]);
        await registrarAuditoria(req.user.id, `Excluiu máquina ID ${req.params.id}`);
        res.json({ mensagem: 'Máquina excluída.' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao excluir máquina: ' + e.message });
    }
});

// =========================================================
// PRODUTOS
// =========================================================

app.get('/api/produtos', autenticar, async (req, res) => {
    try {
        const queryComGaleria = `SELECT
                p.id, p.nome, p.descricao, p.categoria, p.status,
                COALESCE(
                    (SELECT pi.imagem_url
                     FROM produto_imagens pi
                     WHERE pi.produto_id = p.id
                     ORDER BY pi.principal DESC, pi.ordem ASC, pi.id ASC
                     LIMIT 1),
                    p.imagem_url
                ) AS imagem_url,
                COALESCE(
                    (SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', pi.id,
                            'url', pi.imagem_url,
                            'imagem_url', pi.imagem_url,
                            'ordem', pi.ordem,
                            'principal', pi.principal
                        ) ORDER BY pi.ordem ASC, pi.id ASC
                     )
                     FROM produto_imagens pi
                     WHERE pi.produto_id = p.id),
                    CASE
                        WHEN p.imagem_url IS NOT NULL AND p.imagem_url <> ''
                        THEN jsonb_build_array(jsonb_build_object('url', p.imagem_url, 'imagem_url', p.imagem_url, 'ordem', 1, 'principal', true))
                        ELSE '[]'::jsonb
                    END
                ) AS galeria,
                EXISTS (SELECT 1 FROM precificacoes pr WHERE pr.produto_id = p.id) AS precificado,
                v.id AS variacao_id, v.sku, v.variacao,
                v.preco_venda, v.preco_repasse, v.custo_producao, v.estoque_central
             FROM produtos p
             JOIN produto_variacoes v ON p.id = v.produto_id
             ORDER BY p.id DESC`;

        const querySemGaleria = `SELECT
                p.id, p.nome, p.descricao, p.categoria, p.status, p.imagem_url,
                CASE
                    WHEN p.imagem_url IS NOT NULL AND p.imagem_url <> ''
                    THEN jsonb_build_array(jsonb_build_object('url', p.imagem_url, 'imagem_url', p.imagem_url, 'ordem', 1, 'principal', true))
                    ELSE '[]'::jsonb
                END AS galeria,
                false AS precificado,
                v.id AS variacao_id, v.sku, v.variacao,
                v.preco_venda, v.preco_repasse, v.custo_producao, v.estoque_central
             FROM produtos p
             JOIN produto_variacoes v ON p.id = v.produto_id
             ORDER BY p.id DESC`;

        try {
            const p = await db.query(queryComGaleria);
            return res.json(p.rows);
        } catch (err) {
            if (String(err.message || '').includes('produto_imagens') || String(err.message || '').includes('precificacoes')) {
                console.warn('⚠️ Produto_imagens/precificacoes ainda não existe. Usando fallback de produtos:', err.message);
                const p = await db.query(querySemGaleria);
                return res.json(p.rows);
            }
            throw err;
        }
    } catch (e) {
        console.error('❌ Erro produtos:', e);
        res.status(500).json({ erro: 'Erro ao buscar produtos: ' + e.message });
    }
});

app.post('/api/produtos', autenticar, somenteAdmin, upload.fields([{ name: 'imagem', maxCount: 1 }, { name: 'imagens', maxCount: 10 }]), async (req, res) => {
    try {
        const { nome, categoria, descricao, variacao, sku, preco_venda, preco_repasse, custo_producao, estoque, status } = req.body;
        if (!nome || !variacao) return res.status(400).json({ erro: 'Nome e variação são obrigatórios.' });

        const imagensUrls = await uploadImagensProduto(arquivosProduto(req));
        const imagem_url = imagensUrls[0] || null;
        const precoVenda = parseMoeda(preco_venda);
        const precoRepasse = parseMoeda(preco_repasse);
        const custo = parseMoeda(custo_producao);
        const qtdEstoque = toInt(estoque, 0);

        let produtoId;
        await transacao(async (client) => {
            const nP = await client.query(
                `INSERT INTO produtos (nome, categoria, imagem_url, descricao, status)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id`,
                [nome, categoria || 'Impressão 3D', imagem_url, descricao || 'Peça 3D', status || 'ATIVO']
            );
            produtoId = nP.rows[0].id;

            const skuFinal = normalizarSku(sku) || gerarSkuAutomatico(nome, categoria || 'Impressão 3D', produtoId);
            const vNova = await client.query(
                `INSERT INTO produto_variacoes
                    (produto_id, sku, variacao, preco_venda, preco_repasse, custo_producao, estoque_central)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [produtoId, skuFinal, variacao, precoVenda, precoRepasse, custo, qtdEstoque]
            );

            await salvarPrecificacaoProduto(client, produtoId, vNova.rows[0].id, req.body, req.user.id);

            if (imagensUrls.length) {
                await salvarGaleriaProduto(client, produtoId, imagensUrls);
            }

            if (qtdEstoque > 0) {
                await registrarMovimentacao(client, {
                    produto_id: produtoId,
                    usuario_id: req.user.id,
                    tipo: 'ENTRADA_INICIAL_PRODUTO',
                    quantidade: qtdEstoque,
                    estoque_destino: 'CENTRAL',
                    observacao: `Cadastro inicial do produto ${nome}`
                });
            }
        });

        await registrarAuditoria(req.user.id, `Cadastrou produto ${nome}`);
        res.status(201).json({ mensagem: '✅ Produto cadastrado!', id: produtoId });
    } catch (e) {
        console.error('❌ Erro cadastro produto:', e);
        res.status(500).json({ erro: 'Erro no cadastro de produto: ' + e.message });
    }
});

app.put('/api/produtos/:id', autenticar, somenteAdmin, upload.fields([{ name: 'imagem', maxCount: 1 }, { name: 'imagens', maxCount: 10 }]), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, categoria, descricao, status, variacao, sku, preco_venda, preco_repasse, custo_producao, estoque_central, estoque } = req.body;
        const imagensUrls = await uploadImagensProduto(arquivosProduto(req));
        const imagem_url = imagensUrls[0] || null;
        const novoEstoque = estoque_central !== undefined ? estoque_central : estoque;

        await transacao(async (client) => {
            const produtoAtual = await client.query(
                `SELECT p.nome, p.imagem_url, v.id AS variacao_id, v.estoque_central
                 FROM produtos p
                 JOIN produto_variacoes v ON v.produto_id = p.id
                 WHERE p.id = $1
                 ORDER BY v.id ASC LIMIT 1`,
                [id]
            );

            if (produtoAtual.rows.length === 0) throw new Error('Produto não encontrado.');

            await client.query(
                `UPDATE produtos
                 SET nome = COALESCE($1, nome),
                     categoria = COALESCE($2, categoria),
                     descricao = COALESCE($3, descricao),
                     status = COALESCE($4, status),
                     imagem_url = COALESCE($5, imagem_url)
                 WHERE id = $6`,
                [nome || null, categoria || null, descricao || null, status || null, imagem_url || null, id]
            );

            if (imagensUrls.length) {
                await salvarGaleriaProduto(client, id, imagensUrls);
            }

            const variacaoId = produtoAtual.rows[0].variacao_id;
            const estoqueAnterior = toInt(produtoAtual.rows[0].estoque_central, 0);
            const estoqueNovo = novoEstoque !== undefined && novoEstoque !== '' ? toInt(novoEstoque, estoqueAnterior) : estoqueAnterior;

            await client.query(
                `UPDATE produto_variacoes
                 SET sku = COALESCE($1, sku),
                     variacao = COALESCE($2, variacao),
                     preco_venda = COALESCE($3, preco_venda),
                     preco_repasse = COALESCE($4, preco_repasse),
                     custo_producao = COALESCE($5, custo_producao),
                     estoque_central = COALESCE($6, estoque_central)
                 WHERE produto_id = $7`,
                [
                    sku !== undefined ? normalizarSku(sku) : null,
                    variacao || null,
                    preco_venda !== undefined && preco_venda !== '' ? parseMoeda(preco_venda) : null,
                    preco_repasse !== undefined && preco_repasse !== '' ? parseMoeda(preco_repasse) : null,
                    custo_producao !== undefined && custo_producao !== '' ? parseMoeda(custo_producao) : null,
                    estoqueNovo,
                    id
                ]
            );

            await salvarPrecificacaoProduto(client, id, variacaoId, req.body, req.user.id);

            if (estoqueNovo !== estoqueAnterior) {
                await registrarMovimentacao(client, {
                    produto_id: id,
                    variacao_id: variacaoId,
                    usuario_id: req.user.id,
                    tipo: 'AJUSTE_ESTOQUE_CENTRAL',
                    quantidade: estoqueNovo - estoqueAnterior,
                    estoque_origem: 'CENTRAL',
                    estoque_destino: 'CENTRAL',
                    observacao: `Ajuste manual: ${estoqueAnterior} → ${estoqueNovo}`
                });
            }
        });

        await registrarAuditoria(req.user.id, `Editou produto ID ${id}`);
        res.json({ mensagem: '✅ Produto atualizado com sucesso!' });
    } catch (e) {
        console.error('❌ Erro editar produto:', e);
        res.status(500).json({ erro: 'Erro ao atualizar produto: ' + e.message });
    }
});

app.patch('/api/produtos/estoque/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        const novoEstoque = toInt(req.body.novo_estoque, 0);
        await transacao(async (client) => {
            const atual = await client.query('SELECT id, estoque_central FROM produto_variacoes WHERE produto_id = $1 LIMIT 1', [req.params.id]);
            if (atual.rows.length === 0) throw new Error('Produto não encontrado.');
            const anterior = toInt(atual.rows[0].estoque_central, 0);
            await client.query('UPDATE produto_variacoes SET estoque_central = $1 WHERE produto_id = $2', [novoEstoque, req.params.id]);
            await registrarMovimentacao(client, {
                produto_id: req.params.id,
                variacao_id: atual.rows[0].id,
                usuario_id: req.user.id,
                tipo: 'AJUSTE_ESTOQUE_CENTRAL',
                quantidade: novoEstoque - anterior,
                estoque_origem: 'CENTRAL',
                estoque_destino: 'CENTRAL',
                observacao: `Ajuste rápido: ${anterior} → ${novoEstoque}`
            });
        });
        res.json({ mensagem: '✅ Estoque atualizado!' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro no ajuste de estoque: ' + e.message });
    }
});

app.delete('/api/produtos/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await transacao(async (client) => {
            const v = await client.query('SELECT id FROM produto_variacoes WHERE produto_id = $1', [id]);
            for (const row of v.rows) {
                await client.query('DELETE FROM consignacoes_estoque WHERE variacao_id = $1', [row.id]);
                await client.query('DELETE FROM vendas WHERE variacao_id = $1', [row.id]);
            }
            await client.query('DELETE FROM produto_variacoes WHERE produto_id = $1', [id]);
            await client.query('DELETE FROM produtos WHERE id = $1', [id]);
        });
        await registrarAuditoria(req.user.id, `Excluiu produto ID ${id}`);
        res.json({ mensagem: '✅ Peça removida!' });
    } catch (e) {
        console.error('❌ Erro deletar produto:', e);
        res.status(500).json({ erro: 'Erro ao deletar produto: ' + e.message });
    }
});


app.get('/api/produtos/:id/precificacoes', autenticar, async (req, res) => {
    try {
        const r = await db.query(
            `SELECT pr.*, u.nome AS usuario_nome
             FROM precificacoes pr
             LEFT JOIN usuarios u ON u.id = pr.usuario_id
             WHERE pr.produto_id = $1
             ORDER BY pr.id DESC`,
            [req.params.id]
        );
        res.json(r.rows);
    } catch (e) {
        console.error('❌ Erro precificações:', e);
        res.status(500).json({ erro: 'Erro ao buscar histórico de precificação: ' + e.message });
    }
});

app.get('/api/configuracoes-precificacao', autenticar, somenteAdmin, async (req, res) => {
    try {
        const r = await db.query('SELECT chave, valor, descricao FROM configuracoes_precificacao ORDER BY chave ASC');
        res.json(r.rows);
    } catch (e) {
        res.json([]);
    }
});


// =========================================================
// PAINEL DO PARCEIRO / CATÁLOGO / SOLICITAÇÕES / COTAÇÕES
// =========================================================

app.get('/api/minha-loja/resumo', autenticar, async (req, res) => {
    try {
        const parceiroId = req.user.perfil === 'PARCEIRO' ? req.user.parceiro_id : req.query.parceiro_id;
        if (!parceiroId) return res.status(400).json({ erro: 'parceiro_id é obrigatório.' });
        if (!garantirParceiroPermitido(req, parceiroId)) return res.status(403).json({ erro: 'Acesso negado para esta loja.' });

        const loja = await db.query('SELECT id, nome_loja, responsavel, telefone, status FROM parceiros WHERE id = $1', [parceiroId]);
        const estoque = await db.query(`
            SELECT
                COALESCE(SUM(c.quantidade_atual), 0) AS qtd_atual,
                COALESCE(SUM(c.quantidade_atual * COALESCE(ult.preco_repasse_unitario, pv.preco_repasse, 0)), 0) AS valor_consignado
            FROM consignacoes_estoque c
            JOIN produto_variacoes pv ON pv.id = c.variacao_id
            LEFT JOIN LATERAL (
                SELECT ri.preco_repasse_unitario
                FROM remessa_itens ri
                JOIN remessas r ON r.id = ri.remessa_id
                WHERE r.parceiro_id = c.parceiro_id
                  AND ri.variacao_id = c.variacao_id
                ORDER BY ri.id DESC
                LIMIT 1
            ) ult ON true
            WHERE c.parceiro_id = $1`, [parceiroId]
        );
        const vendas = await db.query(`
            SELECT COALESCE(SUM(valor_total), 0) AS total_vendas, COALESCE(COUNT(*), 0) AS total_registros
            FROM vendas
            WHERE parceiro_id = $1
              AND EXTRACT(MONTH FROM data_venda) = EXTRACT(MONTH FROM CURRENT_DATE)
              AND EXTRACT(YEAR FROM data_venda) = EXTRACT(YEAR FROM CURRENT_DATE)`, [parceiroId]
        );
        const abertas = await db.query(`
            SELECT
                (SELECT COUNT(*) FROM solicitacoes_produto WHERE parceiro_id = $1 AND status IN ('ABERTA','EM_ANALISE')) AS solicitacoes,
                (SELECT COUNT(*) FROM cotacoes_produto WHERE parceiro_id = $1 AND status IN ('ABERTA','EM_ANALISE')) AS cotacoes`, [parceiroId]
        ).catch(() => ({ rows: [{ solicitacoes: 0, cotacoes: 0 }] }));

        res.json({
            loja: loja.rows[0] || null,
            estoque: estoque.rows[0] || { qtd_atual: 0, valor_consignado: 0 },
            vendas: vendas.rows[0] || { total_vendas: 0, total_registros: 0 },
            pendencias: abertas.rows[0] || { solicitacoes: 0, cotacoes: 0 }
        });
    } catch (e) {
        console.error('❌ Erro resumo minha loja:', e);
        res.status(500).json({ erro: 'Erro ao carregar resumo da loja: ' + e.message });
    }
});

app.get('/api/parceiro/catalogo', autenticar, async (req, res) => {
    try {
        const parceiroId = req.user.perfil === 'PARCEIRO' ? req.user.parceiro_id : req.query.parceiro_id;
        if (!parceiroId) return res.status(400).json({ erro: 'parceiro_id é obrigatório.' });
        if (!garantirParceiroPermitido(req, parceiroId)) return res.status(403).json({ erro: 'Acesso negado para esta loja.' });
        const busca = `%${String(req.query.busca || '').trim()}%`;
        const apenasDisponiveis = String(req.query.disponivel || '').toLowerCase() === 'true';

        const result = await db.query(`
            SELECT
                p.id AS produto_id,
                pv.id AS variacao_id,
                p.nome,
                p.categoria,
                p.descricao,
                p.status,
                COALESCE((SELECT pi.imagem_url FROM produto_imagens pi WHERE pi.produto_id = p.id ORDER BY pi.principal DESC, pi.ordem ASC, pi.id ASC LIMIT 1), p.imagem_url) AS imagem_url,
                pv.sku,
                pv.variacao,
                pv.preco_venda,
                pv.preco_repasse,
                COALESCE(pv.estoque_central, 0) AS estoque_central,
                COALESCE(c.quantidade_atual, 0) AS quantidade_na_loja,
                COALESCE(c.quantidade_vendida, 0) AS quantidade_vendida_loja,
                CASE WHEN COALESCE(pv.estoque_central, 0) > 0 THEN true ELSE false END AS disponivel_central
            FROM produtos p
            JOIN produto_variacoes pv ON pv.produto_id = p.id
            LEFT JOIN consignacoes_estoque c ON c.variacao_id = pv.id AND c.parceiro_id = $1
            WHERE COALESCE(p.status, 'ATIVO') <> 'INATIVO'
              AND ($2 = '%%' OR p.nome ILIKE $2 OR COALESCE(pv.sku,'') ILIKE $2 OR COALESCE(pv.variacao,'') ILIKE $2 OR COALESCE(p.categoria,'') ILIKE $2)
              AND ($3::boolean = false OR COALESCE(pv.estoque_central, 0) > 0)
            ORDER BY p.nome ASC, pv.variacao ASC
            LIMIT 300`, [parceiroId, busca, apenasDisponiveis]
        );
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro catálogo parceiro:', e);
        res.status(500).json({ erro: 'Erro ao carregar catálogo: ' + e.message });
    }
});

app.post('/api/solicitacoes-produto', autenticar, async (req, res) => {
    try {
        const parceiroId = req.user.perfil === 'PARCEIRO' ? req.user.parceiro_id : req.body.parceiro_id;
        if (!parceiroId) return res.status(400).json({ erro: 'parceiro_id é obrigatório.' });
        if (!garantirParceiroPermitido(req, parceiroId)) return res.status(403).json({ erro: 'Acesso negado para esta loja.' });

        const produtoId = req.body.produto_id || null;
        const variacaoId = req.body.variacao_id || null;
        const quantidade = Math.max(1, toInt(req.body.quantidade, 1));
        const tipo = String(req.body.tipo_solicitacao || (produtoId ? 'REPOSICAO' : 'NOVO_MODELO')).toUpperCase();
        const observacao = req.body.observacao || '';
        const modeloDesejado = req.body.modelo_desejado || req.body.titulo || null;

        let snapshot = { nome: modeloDesejado, variacao: null, sku: null, imagem_url: null };
        if (produtoId) {
            const prod = await db.query(`
                SELECT p.nome, p.imagem_url, pv.variacao, pv.sku
                FROM produtos p
                LEFT JOIN produto_variacoes pv ON pv.produto_id = p.id AND ($2::integer IS NULL OR pv.id = $2)
                WHERE p.id = $1
                ORDER BY pv.id ASC
                LIMIT 1`, [produtoId, variacaoId]
            );
            if (prod.rows[0]) snapshot = prod.rows[0];
        }

        const codigo = gerarCodigo('SOL');
        const ins = await db.query(`
            INSERT INTO solicitacoes_produto (
                codigo, parceiro_id, usuario_id, produto_id, variacao_id,
                tipo_solicitacao, status, quantidade_solicitada,
                produto_nome_snapshot, variacao_snapshot, sku_snapshot, imagem_url_snapshot,
                modelo_desejado, observacao
            ) VALUES ($1,$2,$3,$4,$5,$6,'ABERTA',$7,$8,$9,$10,$11,$12,$13)
            RETURNING *`, [
                codigo, parceiroId, req.user.id, produtoId, variacaoId,
                tipo, quantidade, snapshot.nome, snapshot.variacao, snapshot.sku, snapshot.imagem_url,
                modeloDesejado, observacao
            ]
        );
        await registrarAuditoria(req.user.id, `Criou solicitação de produto ${codigo}`);
        res.status(201).json({ mensagem: 'Solicitação enviada para análise.', solicitacao: ins.rows[0] });
    } catch (e) {
        console.error('❌ Erro criar solicitação produto:', e);
        res.status(500).json({ erro: 'Erro ao enviar solicitação: ' + e.message });
    }
});

app.get('/api/solicitacoes-produto', autenticar, async (req, res) => {
    try {
        const params = [];
        let where = '';
        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            where = `WHERE s.parceiro_id = $${params.length}`;
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            where = `WHERE s.parceiro_id = $${params.length}`;
        }
        const r = await db.query(`
            SELECT s.*, p.nome_loja, u.nome AS usuario_nome,
                   TO_CHAR(s.criado_em, 'DD/MM/YYYY HH24:MI') AS criado_em_formatado
            FROM solicitacoes_produto s
            LEFT JOIN parceiros p ON p.id = s.parceiro_id
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            ${where}
            ORDER BY s.id DESC
            LIMIT 200`, params
        );
        res.json(r.rows);
    } catch (e) {
        console.error('❌ Erro listar solicitações produto:', e);
        res.status(500).json({ erro: 'Erro ao listar solicitações: ' + e.message });
    }
});

app.patch('/api/solicitacoes-produto/:id/status', autenticar, somenteAdmin, async (req, res) => {
    try {
        const status = String(req.body.status || '').toUpperCase();
        const resposta = req.body.resposta_admin || req.body.resposta || null;
        const permitidos = ['ABERTA','EM_ANALISE','APROVADA','RECUSADA','ATENDIDA','CANCELADA'];
        if (!permitidos.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
        const r = await db.query(`
            UPDATE solicitacoes_produto
            SET status = $1, resposta_admin = COALESCE($2, resposta_admin), atualizado_em = CURRENT_TIMESTAMP
            WHERE id = $3 RETURNING *`, [status, resposta, req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ erro: 'Solicitação não encontrada.' });
        await registrarAuditoria(req.user.id, `Atualizou solicitação de produto ${req.params.id} para ${status}`);
        res.json({ mensagem: 'Solicitação atualizada.', solicitacao: r.rows[0] });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao atualizar solicitação: ' + e.message });
    }
});

app.post('/api/cotacoes-produto', autenticar, upload.single('imagem'), async (req, res) => {
    try {
        const parceiroId = req.user.perfil === 'PARCEIRO' ? req.user.parceiro_id : req.body.parceiro_id;
        if (!parceiroId) return res.status(400).json({ erro: 'parceiro_id é obrigatório.' });
        if (!garantirParceiroPermitido(req, parceiroId)) return res.status(403).json({ erro: 'Acesso negado para esta loja.' });

        const titulo = req.body.titulo || req.body.nome_produto || 'Novo produto sob cotação';
        const descricao = req.body.descricao || '';
        const quantidade = Math.max(1, toInt(req.body.quantidade, 1));
        const prazoDesejado = req.body.prazo_desejado || null;
        const canal = req.body.canal || null;
        const codigo = gerarCodigo('COT');
        const imagemUrl = req.file ? await uploadImagemProduto(req.file) : null;

        const r = await db.query(`
            INSERT INTO cotacoes_produto (
                codigo, parceiro_id, usuario_id, titulo, descricao,
                quantidade_desejada, prazo_desejado, canal, imagem_url,
                status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ABERTA')
            RETURNING *`, [codigo, parceiroId, req.user.id, titulo, descricao, quantidade, prazoDesejado, canal, imagemUrl]
        );
        await registrarAuditoria(req.user.id, `Criou cotação de produto ${codigo}`);
        res.status(201).json({ mensagem: 'Cotação enviada para análise.', cotacao: r.rows[0] });
    } catch (e) {
        console.error('❌ Erro criar cotação produto:', e);
        res.status(500).json({ erro: 'Erro ao enviar cotação: ' + e.message });
    }
});

app.get('/api/cotacoes-produto', autenticar, async (req, res) => {
    try {
        const params = [];
        let where = '';
        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            where = `WHERE c.parceiro_id = $${params.length}`;
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            where = `WHERE c.parceiro_id = $${params.length}`;
        }
        const r = await db.query(`
            SELECT c.*, p.nome_loja, u.nome AS usuario_nome,
                   TO_CHAR(c.criado_em, 'DD/MM/YYYY HH24:MI') AS criado_em_formatado
            FROM cotacoes_produto c
            LEFT JOIN parceiros p ON p.id = c.parceiro_id
            LEFT JOIN usuarios u ON u.id = c.usuario_id
            ${where}
            ORDER BY c.id DESC
            LIMIT 200`, params
        );
        res.json(r.rows);
    } catch (e) {
        console.error('❌ Erro listar cotações produto:', e);
        res.status(500).json({ erro: 'Erro ao listar cotações: ' + e.message });
    }
});

app.patch('/api/cotacoes-produto/:id/status', autenticar, somenteAdmin, async (req, res) => {
    try {
        const status = String(req.body.status || '').toUpperCase();
        const resposta = req.body.resposta_admin || req.body.resposta || null;
        const valorEstimado = req.body.valor_estimado !== undefined && req.body.valor_estimado !== '' ? parseMoeda(req.body.valor_estimado) : null;
        const permitidos = ['ABERTA','EM_ANALISE','ORCADA','APROVADA','RECUSADA','CONVERTIDA_PRODUTO','CANCELADA'];
        if (!permitidos.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
        const r = await db.query(`
            UPDATE cotacoes_produto
            SET status = $1,
                resposta_admin = COALESCE($2, resposta_admin),
                valor_estimado = COALESCE($3, valor_estimado),
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = $4 RETURNING *`, [status, resposta, valorEstimado, req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ erro: 'Cotação não encontrada.' });
        await registrarAuditoria(req.user.id, `Atualizou cotação de produto ${req.params.id} para ${status}`);
        res.json({ mensagem: 'Cotação atualizada.', cotacao: r.rows[0] });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao atualizar cotação: ' + e.message });
    }
});



// =========================================================
// V4.3 - KANBAN DE SOLICITAÇÕES / ORÇAMENTOS
// =========================================================

const STATUS_KANBAN = ['ABERTA','SEPARACAO','DESENVOLVIMENTO','AGUARDANDO_APROVACAO','APROVADA','PRODUCAO','TRANSPORTE','CONCLUIDA','RECUSADA'];

function tabelaSolicitacaoPorTipo(tipo) {
    const t = String(tipo || '').toUpperCase();
    if (t === 'SOLICITACAO') return { tabela: 'solicitacoes_produto', origem: 'SOLICITACAO', campoQtd: 'quantidade_solicitada' };
    if (t === 'COTACAO') return { tabela: 'cotacoes_produto', origem: 'COTACAO', campoQtd: 'quantidade_desejada' };
    return null;
}

function normalizarStatusKanban(status) {
    const st = String(status || '').trim().toUpperCase()
        .replace(/[Ç]/g, 'C')
        .replace(/[ÃÁÀÂ]/g, 'A')
        .replace(/[ÉÊ]/g, 'E')
        .replace(/[Í]/g, 'I')
        .replace(/[ÓÔÕ]/g, 'O')
        .replace(/[Ú]/g, 'U')
        .replace(/[\s-]+/g, '_');
    const aliases = {
        ABERTAS: 'ABERTA',
        SEPARANDO: 'SEPARACAO',
        EM_ANALISE: 'ABERTA',
        DESENVOLVENDO: 'DESENVOLVIMENTO',
        ORCADA: 'AGUARDANDO_APROVACAO',
        AGUARDANDO_APROVACAO_DA_LOJA: 'AGUARDANDO_APROVACAO',
        PRODUZINDO: 'PRODUCAO',
        EM_PRODUCAO: 'PRODUCAO',
        EM_TRANSPORTE: 'TRANSPORTE',
        ATENDIDA: 'CONCLUIDA',
        CANCELADA: 'RECUSADA'
    };
    const final = aliases[st] || st || 'ABERTA';
    return STATUS_KANBAN.includes(final) ? final : 'ABERTA';
}

async function registrarHistoricoSolicitacao(client, dados) {
    try {
        await client.query(`
            INSERT INTO solicitacao_historico_status (
                origem_tipo, origem_id, status_anterior, status_novo,
                usuario_id, perfil_usuario, observacao
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
                dados.origem_tipo,
                dados.origem_id,
                dados.status_anterior || null,
                dados.status_novo || null,
                dados.usuario_id || null,
                dados.perfil_usuario || null,
                dados.observacao || null
            ]
        );
    } catch (e) {
        console.warn('⚠️ Histórico de solicitação não registrado:', e.message);
    }
}

async function buscarCardSolicitacao(clientOrDb, tipo, id) {
    const cfg = tabelaSolicitacaoPorTipo(tipo);
    if (!cfg) throw new Error('Tipo de solicitação inválido.');
    const executor = clientOrDb || db;
    const r = await executor.query(`SELECT * FROM ${cfg.tabela} WHERE id = $1`, [id]);
    if (!r.rows.length) throw new Error('Solicitação/cotação não encontrada.');
    return { cfg, row: r.rows[0] };
}

app.get('/api/solicitacoes-kanban', autenticar, async (req, res) => {
    try {
        const params = [];
        const filtroParceiroSol = [];
        const filtroParceiroCot = [];
        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            filtroParceiroSol.push(`s.parceiro_id = $${params.length}`);
            filtroParceiroCot.push(`c.parceiro_id = $${params.length}`);
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            filtroParceiroSol.push(`s.parceiro_id = $${params.length}`);
            filtroParceiroCot.push(`c.parceiro_id = $${params.length}`);
        }
        const whereSol = filtroParceiroSol.length ? `WHERE ${filtroParceiroSol.join(' AND ')}` : '';
        const whereCot = filtroParceiroCot.length ? `WHERE ${filtroParceiroCot.join(' AND ')}` : '';
        const r = await db.query(`
            SELECT * FROM (
                SELECT
                    'SOLICITACAO'::text AS tipo_origem,
                    s.id,
                    s.codigo,
                    s.parceiro_id,
                    p.nome_loja,
                    s.usuario_id,
                    u.nome AS usuario_nome,
                    s.produto_id,
                    s.variacao_id,
                    s.tipo_solicitacao,
                    COALESCE(s.status_fluxo, s.status, 'ABERTA') AS status_fluxo,
                    s.status,
                    COALESCE(s.prioridade, 'NORMAL') AS prioridade,
                    s.quantidade_solicitada,
                    NULL::integer AS quantidade_desejada,
                    s.produto_nome_snapshot,
                    s.variacao_snapshot,
                    s.sku_snapshot,
                    s.imagem_url_snapshot,
                    s.modelo_desejado AS titulo,
                    s.modelo_desejado,
                    s.observacao AS descricao,
                    s.observacao,
                    s.resposta_admin,
                    s.valor_orcado,
                    NULL::numeric AS valor_estimado,
                    s.prazo_estimado_dias,
                    s.data_prevista_entrega,
                    s.observacao_orcamento,
                    s.pdf_orcamento_url,
                    s.aprovado_pelo_parceiro,
                    s.data_aprovacao,
                    s.motivo_recusa,
                    s.comentario_interno,
                    s.comentario_loja,
                    s.ordem_kanban,
                    s.criado_em,
                    TO_CHAR(s.criado_em, 'DD/MM/YYYY HH24:MI') AS criado_em_formatado
                FROM solicitacoes_produto s
                LEFT JOIN parceiros p ON p.id = s.parceiro_id
                LEFT JOIN usuarios u ON u.id = s.usuario_id
                ${whereSol}

                UNION ALL

                SELECT
                    'COTACAO'::text AS tipo_origem,
                    c.id,
                    c.codigo,
                    c.parceiro_id,
                    p.nome_loja,
                    c.usuario_id,
                    u.nome AS usuario_nome,
                    NULL::integer AS produto_id,
                    NULL::integer AS variacao_id,
                    'COTACAO'::varchar AS tipo_solicitacao,
                    COALESCE(c.status_fluxo, c.status, 'ABERTA') AS status_fluxo,
                    c.status,
                    COALESCE(c.prioridade, 'NORMAL') AS prioridade,
                    NULL::integer AS quantidade_solicitada,
                    c.quantidade_desejada,
                    c.titulo AS produto_nome_snapshot,
                    NULL::varchar AS variacao_snapshot,
                    NULL::varchar AS sku_snapshot,
                    c.imagem_url AS imagem_url_snapshot,
                    c.titulo,
                    c.titulo AS modelo_desejado,
                    c.descricao,
                    c.descricao AS observacao,
                    c.resposta_admin,
                    c.valor_orcado,
                    c.valor_estimado,
                    c.prazo_estimado_dias,
                    c.data_prevista_entrega,
                    c.observacao_orcamento,
                    c.pdf_orcamento_url,
                    c.aprovado_pelo_parceiro,
                    c.data_aprovacao,
                    c.motivo_recusa,
                    c.comentario_interno,
                    c.comentario_loja,
                    c.ordem_kanban,
                    c.criado_em,
                    TO_CHAR(c.criado_em, 'DD/MM/YYYY HH24:MI') AS criado_em_formatado
                FROM cotacoes_produto c
                LEFT JOIN parceiros p ON p.id = c.parceiro_id
                LEFT JOIN usuarios u ON u.id = c.usuario_id
                ${whereCot}
            ) x
            ORDER BY x.ordem_kanban ASC NULLS LAST, x.criado_em DESC
            LIMIT 500`, params);
        res.json(r.rows);
    } catch (e) {
        console.error('❌ Erro listar Kanban solicitações:', e);
        res.status(500).json({ erro: 'Erro ao listar solicitações Kanban: ' + e.message });
    }
});

app.patch('/api/solicitacoes-kanban/:tipo/:id/status', autenticar, somenteAdmin, async (req, res) => {
    try {
        const cfg = tabelaSolicitacaoPorTipo(req.params.tipo);
        if (!cfg) return res.status(400).json({ erro: 'Tipo inválido.' });
        const novoStatus = normalizarStatusKanban(req.body.status_fluxo || req.body.status);
        const observacao = req.body.observacao || '';
        const prioridade = req.body.prioridade ? String(req.body.prioridade).toUpperCase() : null;
        const result = await transacao(async (client) => {
            const atual = await buscarCardSolicitacao(client, cfg.origem, req.params.id);
            const statusAnterior = atual.row.status_fluxo || atual.row.status || 'ABERTA';
            const r = await client.query(`
                UPDATE ${cfg.tabela}
                SET status_fluxo = $1,
                    status = $1,
                    prioridade = COALESCE($2, prioridade),
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = $3
                RETURNING *`, [novoStatus, prioridade, req.params.id]
            );
            await registrarHistoricoSolicitacao(client, {
                origem_tipo: cfg.origem,
                origem_id: req.params.id,
                status_anterior: statusAnterior,
                status_novo: novoStatus,
                usuario_id: req.user.id,
                perfil_usuario: req.user.perfil,
                observacao
            });
            return r.rows[0];
        });
        res.json({ mensagem: 'Status atualizado.', item: result });
    } catch (e) {
        console.error('❌ Erro mover Kanban:', e);
        res.status(500).json({ erro: 'Erro ao mover card: ' + e.message });
    }
});

app.patch('/api/solicitacoes-kanban/:tipo/:id/orcamento', autenticar, somenteAdmin, async (req, res) => {
    try {
        const cfg = tabelaSolicitacaoPorTipo(req.params.tipo);
        if (!cfg) return res.status(400).json({ erro: 'Tipo inválido.' });
        const valor = parseMoeda(req.body.valor_orcado ?? req.body.valor_estimado);
        const prazoDias = req.body.prazo_estimado_dias !== undefined && req.body.prazo_estimado_dias !== '' ? toInt(req.body.prazo_estimado_dias, 0) : null;
        const dataPrevista = req.body.data_prevista_entrega || null;
        const observacaoOrcamento = req.body.observacao_orcamento || req.body.resposta_admin || null;
        const comentarioInterno = req.body.comentario_interno || null;
        const prioridade = req.body.prioridade ? String(req.body.prioridade).toUpperCase() : 'NORMAL';
        const result = await transacao(async (client) => {
            const atual = await buscarCardSolicitacao(client, cfg.origem, req.params.id);
            const statusAnterior = atual.row.status_fluxo || atual.row.status || 'ABERTA';
            const r = await client.query(`
                UPDATE ${cfg.tabela}
                SET status_fluxo = 'AGUARDANDO_APROVACAO',
                    status = 'AGUARDANDO_APROVACAO',
                    valor_orcado = $1,
                    ${cfg.origem === 'COTACAO' ? 'valor_estimado = $1,' : ''}
                    prazo_estimado_dias = $2,
                    data_prevista_entrega = $3,
                    observacao_orcamento = $4,
                    resposta_admin = COALESCE($4, resposta_admin),
                    comentario_interno = $5,
                    prioridade = $6,
                    aprovado_pelo_parceiro = false,
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = $7
                RETURNING *`, [valor, prazoDias, dataPrevista, observacaoOrcamento, comentarioInterno, prioridade, req.params.id]
            );
            await registrarHistoricoSolicitacao(client, {
                origem_tipo: cfg.origem,
                origem_id: req.params.id,
                status_anterior: statusAnterior,
                status_novo: 'AGUARDANDO_APROVACAO',
                usuario_id: req.user.id,
                perfil_usuario: req.user.perfil,
                observacao: `Orçamento enviado. Valor: ${valor}. Prazo: ${prazoDias || '-'} dias. ${observacaoOrcamento || ''}`
            });
            return r.rows[0];
        });
        res.json({ mensagem: 'Orçamento enviado para aprovação da loja.', item: result });
    } catch (e) {
        console.error('❌ Erro orçamento Kanban:', e);
        res.status(500).json({ erro: 'Erro ao salvar orçamento: ' + e.message });
    }
});

app.post('/api/solicitacoes-kanban/:tipo/:id/aprovar', autenticar, async (req, res) => {
    try {
        const cfg = tabelaSolicitacaoPorTipo(req.params.tipo);
        if (!cfg) return res.status(400).json({ erro: 'Tipo inválido.' });
        const result = await transacao(async (client) => {
            const atual = await buscarCardSolicitacao(client, cfg.origem, req.params.id);
            if (!garantirParceiroPermitido(req, atual.row.parceiro_id)) throw new Error('Acesso negado para esta loja.');
            const statusAnterior = atual.row.status_fluxo || atual.row.status || 'ABERTA';
            if (statusAnterior !== 'AGUARDANDO_APROVACAO') throw new Error('Este orçamento ainda não está aguardando aprovação.');
            const r = await client.query(`
                UPDATE ${cfg.tabela}
                SET status_fluxo = 'APROVADA',
                    status = 'APROVADA',
                    aprovado_pelo_parceiro = true,
                    data_aprovacao = CURRENT_TIMESTAMP,
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *`, [req.params.id]
            );
            await registrarHistoricoSolicitacao(client, {
                origem_tipo: cfg.origem,
                origem_id: req.params.id,
                status_anterior: statusAnterior,
                status_novo: 'APROVADA',
                usuario_id: req.user.id,
                perfil_usuario: req.user.perfil,
                observacao: 'Orçamento aprovado pela loja/parceiro.'
            });
            return r.rows[0];
        });
        res.json({ mensagem: 'Orçamento aprovado.', item: result });
    } catch (e) {
        console.error('❌ Erro aprovar orçamento:', e);
        res.status(500).json({ erro: 'Erro ao aprovar orçamento: ' + e.message });
    }
});

app.post('/api/solicitacoes-kanban/:tipo/:id/recusar', autenticar, async (req, res) => {
    try {
        const cfg = tabelaSolicitacaoPorTipo(req.params.tipo);
        if (!cfg) return res.status(400).json({ erro: 'Tipo inválido.' });
        const motivo = req.body.motivo_recusa || 'Recusado pela loja/parceiro.';
        const result = await transacao(async (client) => {
            const atual = await buscarCardSolicitacao(client, cfg.origem, req.params.id);
            if (!garantirParceiroPermitido(req, atual.row.parceiro_id)) throw new Error('Acesso negado para esta loja.');
            const statusAnterior = atual.row.status_fluxo || atual.row.status || 'ABERTA';
            const r = await client.query(`
                UPDATE ${cfg.tabela}
                SET status_fluxo = 'RECUSADA',
                    status = 'RECUSADA',
                    aprovado_pelo_parceiro = false,
                    motivo_recusa = $1,
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING *`, [motivo, req.params.id]
            );
            await registrarHistoricoSolicitacao(client, {
                origem_tipo: cfg.origem,
                origem_id: req.params.id,
                status_anterior: statusAnterior,
                status_novo: 'RECUSADA',
                usuario_id: req.user.id,
                perfil_usuario: req.user.perfil,
                observacao: motivo
            });
            return r.rows[0];
        });
        res.json({ mensagem: 'Orçamento recusado.', item: result });
    } catch (e) {
        console.error('❌ Erro recusar orçamento:', e);
        res.status(500).json({ erro: 'Erro ao recusar orçamento: ' + e.message });
    }
});

app.get('/api/solicitacoes-kanban/:tipo/:id/historico', autenticar, async (req, res) => {
    try {
        const cfg = tabelaSolicitacaoPorTipo(req.params.tipo);
        if (!cfg) return res.status(400).json({ erro: 'Tipo inválido.' });
        const atual = await buscarCardSolicitacao(db, cfg.origem, req.params.id);
        if (!garantirParceiroPermitido(req, atual.row.parceiro_id)) return res.status(403).json({ erro: 'Acesso negado.' });
        const r = await db.query(`
            SELECT h.*, u.nome AS usuario_nome, TO_CHAR(h.criado_em, 'DD/MM/YYYY HH24:MI') AS criado_em_formatado
            FROM solicitacao_historico_status h
            LEFT JOIN usuarios u ON u.id = h.usuario_id
            WHERE h.origem_tipo = $1 AND h.origem_id = $2
            ORDER BY h.id DESC`, [cfg.origem, req.params.id]
        );
        res.json(r.rows);
    } catch (e) {
        console.error('❌ Erro histórico Kanban:', e);
        res.status(500).json({ erro: 'Erro ao buscar histórico: ' + e.message });
    }
});

app.post('/api/solicitacoes-kanban/:tipo/:id/gerar-producao', autenticar, somenteAdmin, async (req, res) => {
    try {
        const cfg = tabelaSolicitacaoPorTipo(req.params.tipo);
        if (!cfg) return res.status(400).json({ erro: 'Tipo inválido.' });
        const result = await transacao(async (client) => {
            const { row } = await buscarCardSolicitacao(client, cfg.origem, req.params.id);
            const statusAnterior = row.status_fluxo || row.status || 'ABERTA';
            const codigo = gerarCodigo('PROD');
            const produtoId = row.produto_id || null;
            const variacaoId = row.variacao_id || null;
            const qtd = toInt(row.quantidade_solicitada || row.quantidade_desejada, 1);
            const prod = await client.query(`
                INSERT INTO producoes (
                    codigo, produto_id, variacao_id, usuario_id,
                    produto_nome_snapshot, variacao_snapshot, sku_snapshot,
                    status, quantidade_planejada, quantidade_produzida,
                    observacao
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,'PLANEJADA',$8,0,$9)
                RETURNING *`, [
                    codigo, produtoId, variacaoId, req.user.id,
                    row.produto_nome_snapshot || row.titulo || row.modelo_desejado || 'Produto solicitado',
                    row.variacao_snapshot || null,
                    row.sku_snapshot || null,
                    qtd,
                    `Produção gerada a partir de ${cfg.origem} ${row.codigo || row.id}`
                ]
            );
            await client.query(`UPDATE ${cfg.tabela} SET status_fluxo='PRODUCAO', status='PRODUCAO', atualizado_em=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
            await registrarHistoricoSolicitacao(client, { origem_tipo: cfg.origem, origem_id: req.params.id, status_anterior: statusAnterior, status_novo: 'PRODUCAO', usuario_id: req.user.id, perfil_usuario: req.user.perfil, observacao: `Produção criada: ${codigo}` });
            return prod.rows[0];
        });
        res.status(201).json({ mensagem: 'Produção criada.', producao: result });
    } catch (e) {
        console.error('❌ Erro gerar produção:', e);
        res.status(500).json({ erro: 'Erro ao gerar produção: ' + e.message });
    }
});

app.post('/api/solicitacoes-kanban/:tipo/:id/gerar-remessa', autenticar, somenteAdmin, async (req, res) => {
    try {
        const cfg = tabelaSolicitacaoPorTipo(req.params.tipo);
        if (!cfg || cfg.origem !== 'SOLICITACAO') return res.status(400).json({ erro: 'Remessa automática é permitida para solicitações de reposição.' });
        const result = await transacao(async (client) => {
            const { row } = await buscarCardSolicitacao(client, cfg.origem, req.params.id);
            if (!row.produto_id || !row.variacao_id) throw new Error('Esta solicitação não possui produto existente vinculado.');
            const qtd = Math.max(1, toInt(row.quantidade_solicitada, 1));
            const v = await client.query('SELECT estoque_central, preco_repasse FROM produto_variacoes WHERE id=$1', [row.variacao_id]);
            if (!v.rows.length) throw new Error('Variação não encontrada.');
            if (Number(v.rows[0].estoque_central || 0) < qtd) throw new Error('Estoque central insuficiente para gerar remessa.');
            const codigo = gerarCodigo('REM');
            const rem = await client.query(`INSERT INTO remessas (codigo, parceiro_id, usuario_id, status, observacao) VALUES ($1,$2,$3,'ENVIADA',$4) RETURNING *`, [codigo, row.parceiro_id, req.user.id, `Remessa gerada a partir da solicitação ${row.codigo || row.id}`]);
            const remessaId = rem.rows[0].id;
            const preco = Number(v.rows[0].preco_repasse || 0);
            await client.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id=$2', [qtd, row.variacao_id]);
            const ex = await client.query('SELECT id FROM consignacoes_estoque WHERE parceiro_id=$1 AND variacao_id=$2', [row.parceiro_id, row.variacao_id]);
            if (ex.rows.length) await client.query('UPDATE consignacoes_estoque SET quantidade_atual=quantidade_atual+$1, quantidade_enviada=quantidade_enviada+$1 WHERE id=$2', [qtd, ex.rows[0].id]);
            else await client.query('INSERT INTO consignacoes_estoque (parceiro_id, variacao_id, quantidade_enviada, quantidade_atual) VALUES ($1,$2,$3,$3)', [row.parceiro_id, row.variacao_id, qtd]);
            await client.query(`INSERT INTO remessa_itens (remessa_id, produto_id, variacao_id, produto_nome_snapshot, variacao_snapshot, sku_snapshot, imagem_url_snapshot, quantidade, quantidade_enviada, preco_repasse_snapshot, preco_repasse_unitario, valor_total_original, valor_total_saldo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9,$10,$10)`, [remessaId, row.produto_id, row.variacao_id, row.produto_nome_snapshot, row.variacao_snapshot, row.sku_snapshot, row.imagem_url_snapshot, qtd, preco, qtd * preco]);
            await client.query(`UPDATE ${cfg.tabela} SET status_fluxo='TRANSPORTE', status='TRANSPORTE', atualizado_em=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
            await registrarHistoricoSolicitacao(client, { origem_tipo: cfg.origem, origem_id: req.params.id, status_anterior: row.status_fluxo || row.status, status_novo: 'TRANSPORTE', usuario_id: req.user.id, perfil_usuario: req.user.perfil, observacao: `Remessa criada: ${codigo}` });
            return rem.rows[0];
        });
        res.status(201).json({ mensagem: 'Remessa criada.', remessa: result });
    } catch (e) {
        console.error('❌ Erro gerar remessa:', e);
        res.status(500).json({ erro: 'Erro ao gerar remessa: ' + e.message });
    }
});

// =========================================================
// CONSIGNAÇÕES / REMESSAS
// =========================================================

app.get('/api/consignacoes/:parceiro_id', autenticar, async (req, res) => {
    try {
        const parceiroId = req.params.parceiro_id;
        if (!garantirParceiroPermitido(req, parceiroId)) {
            return res.status(403).json({ erro: 'Você só pode visualizar o estoque da sua loja.' });
        }

        const query = `
            WITH lotes AS (
                SELECT
                    r.parceiro_id,
                    ri.variacao_id,
                    SUM(GREATEST(COALESCE(ri.quantidade, ri.quantidade_enviada, 0) - COALESCE(ri.quantidade_estornada, 0), 0)) AS qtd_saldo_remessa,
                    SUM(
                        GREATEST(COALESCE(ri.quantidade, ri.quantidade_enviada, 0) - COALESCE(ri.quantidade_estornada, 0), 0)
                        * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                    ) AS valor_saldo_remessa
                FROM remessas r
                JOIN remessa_itens ri ON ri.remessa_id = r.id
                WHERE r.parceiro_id = $1
                  AND COALESCE(r.status, '') <> 'ESTORNADA'
                GROUP BY r.parceiro_id, ri.variacao_id
            )
            SELECT
                c.id,
                c.id AS consignacao_id,
                p.id AS produto_id,
                p.nome AS produto_nome,
                p.imagem_url,
                v.id AS variacao_id,
                v.sku,
                v.variacao,
                v.preco_venda,
                ROUND(COALESCE(l.valor_saldo_remessa / NULLIF(l.qtd_saldo_remessa, 0), v.preco_repasse, 0)::numeric, 2) AS preco_repasse,
                v.preco_repasse AS preco_repasse_padrao,
                c.quantidade_enviada,
                c.quantidade_vendida,
                c.quantidade_atual,
                ROUND((c.quantidade_atual * COALESCE(l.valor_saldo_remessa / NULLIF(l.qtd_saldo_remessa, 0), v.preco_repasse, 0))::numeric, 2) AS valor_consignado_atual,
                c.data_ultimo_envio
            FROM consignacoes_estoque c
            JOIN produto_variacoes v ON c.variacao_id = v.id
            JOIN produtos p ON v.produto_id = p.id
            LEFT JOIN lotes l ON l.parceiro_id = c.parceiro_id AND l.variacao_id = c.variacao_id
            WHERE c.parceiro_id = $1
              AND c.quantidade_atual > 0
            ORDER BY p.nome ASC`;

        const d = await db.query(query, [parceiroId]);
        res.json(d.rows);
    } catch (e) {
        console.error('❌ Erro buscar consignações:', e);
        res.status(500).json({ erro: 'Erro ao buscar estoque.' });
    }
});

app.post('/api/consignacoes', autenticar, somenteAdmin, async (req, res) => {
    try {
        // Compatibilidade com telas antigas: transforma envio unitário em lote.
        const { parceiro_id, produto_id, quantidade, preco_repasse_manual, observacao } = req.body;
        req.body = {
            parceiro_id,
            observacao: observacao || '',
            itens: [{ produto_id, quantidade, preco_repasse_manual }]
        };

        // Reaproveita a mesma lógica segura da rota em lote chamando a função local.
        return processarConsignacoesLote(req, res);
    } catch (e) {
        console.error('❌ Erro remessa unitária:', e);
        res.status(500).json({ erro: 'Erro ao processar remessa.' });
    }
});

async function processarConsignacoesLote(req, res) {
    try {
        const { parceiro_id, itens, observacao } = req.body;
        const parceiroId = toInt(parceiro_id, 0);

        if (!parceiroId) return res.status(400).json({ erro: 'Selecione uma loja válida.' });
        if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ erro: 'Lista de produtos vazia.' });

        const resultado = await transacao(async (client) => {
            const loja = await client.query('SELECT id, nome_loja FROM parceiros WHERE id = $1', [parceiroId]);
            if (loja.rows.length === 0) throw new Error('Loja parceira não encontrada.');

            const codigo = gerarCodigo('REM');
            const remessa = await client.query(
                `INSERT INTO remessas (codigo, parceiro_id, usuario_id, status, observacao, status_assinatura)
                 VALUES ($1, $2, $3, 'ENVIADA', $4, 'PENDENTE')
                 RETURNING id, codigo`,
                [codigo, parceiroId, req.user.id, observacao || null]
            );

            const remessaId = remessa.rows[0].id;
            const itensRegistrados = [];

            for (const item of itens) {
                const produtoId = toInt(item.produto_id, 0);
                const qtd = toInt(item.quantidade, 0);
                if (!produtoId) throw new Error('Produto inválido no lote.');
                if (qtd <= 0) throw new Error('Quantidade inválida no lote.');

                const info = await client.query(
                    `SELECT
                        p.id AS produto_id,
                        p.nome,
                        p.imagem_url,
                        v.id AS variacao_id,
                        v.sku,
                        v.variacao,
                        v.estoque_central,
                        v.preco_repasse,
                        v.preco_venda
                     FROM produtos p
                     JOIN produto_variacoes v ON v.produto_id = p.id
                     WHERE p.id = $1
                     ORDER BY v.id ASC
                     LIMIT 1`,
                    [produtoId]
                );

                if (info.rows.length === 0) throw new Error(`Produto ID ${produtoId} não encontrado.`);

                const produto = info.rows[0];
                const estoqueCentral = toInt(produto.estoque_central, 0);
                if (estoqueCentral < qtd) {
                    throw new Error(`Estoque insuficiente para ${produto.nome}. Disponível: ${estoqueCentral}.`);
                }

                // Correção principal V3.5:
                // O valor personalizado da remessa é calculado no JavaScript,
                // evitando erro PostgreSQL: operator is not unique: unknown * unknown.
                const precoManual = item.preco_repasse_manual ?? item.precoConsignacao ?? item.preco_repasse_personalizado ?? item.preco_repasse;
                const precoConsignacao = parseMoeda(precoManual !== undefined && precoManual !== '' ? precoManual : produto.preco_repasse);
                const precoVenda = parseMoeda(produto.preco_venda);
                const valorTotalOriginal = money(qtd * precoConsignacao);
                const valorTotalSaldo = valorTotalOriginal;

                await client.query(
                    `UPDATE produto_variacoes
                     SET estoque_central = estoque_central - $1
                     WHERE id = $2`,
                    [qtd, produto.variacao_id]
                );

                const ex = await client.query(
                    'SELECT id FROM consignacoes_estoque WHERE parceiro_id = $1 AND variacao_id = $2',
                    [parceiroId, produto.variacao_id]
                );

                if (ex.rows.length > 0) {
                    await client.query(
                        `UPDATE consignacoes_estoque
                         SET quantidade_atual = quantidade_atual + $1,
                             quantidade_enviada = COALESCE(quantidade_enviada, 0) + $1,
                             data_ultimo_envio = CURRENT_TIMESTAMP
                         WHERE id = $2`,
                        [qtd, ex.rows[0].id]
                    );
                } else {
                    await client.query(
                        `INSERT INTO consignacoes_estoque
                            (parceiro_id, variacao_id, quantidade_enviada, quantidade_atual, quantidade_vendida)
                         VALUES ($1, $2, $3, $3, 0)`,
                        [parceiroId, produto.variacao_id, qtd]
                    );
                }

                await client.query(
                    `INSERT INTO remessa_itens (
                        remessa_id,
                        produto_id,
                        variacao_id,
                        produto_nome_snapshot,
                        variacao_snapshot,
                        sku_snapshot,
                        imagem_url_snapshot,
                        quantidade,
                        quantidade_enviada,
                        quantidade_estornada,
                        preco_repasse_snapshot,
                        preco_venda_snapshot,
                        preco_repasse_unitario,
                        valor_total_original,
                        valor_total_estornado,
                        valor_total_saldo
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7,
                        $8, $8, 0,
                        $9, $10, $9,
                        $11, 0, $12
                    )`,
                    [
                        remessaId,
                        produto.produto_id,
                        produto.variacao_id,
                        produto.nome,
                        produto.variacao,
                        produto.sku || null,
                        produto.imagem_url || null,
                        qtd,
                        precoConsignacao,
                        precoVenda,
                        valorTotalOriginal,
                        valorTotalSaldo
                    ]
                );

                await registrarMovimentacao(client, {
                    produto_id: produto.produto_id,
                    variacao_id: produto.variacao_id,
                    parceiro_id: parceiroId,
                    usuario_id: req.user.id,
                    tipo: 'REMESSA_ENVIADA',
                    quantidade: qtd,
                    estoque_origem: 'CENTRAL',
                    estoque_destino: `PARCEIRO_${parceiroId}`,
                    referencia_tipo: 'REMESSA',
                    referencia_id: remessaId,
                    observacao: `Remessa ${codigo} enviada para ${loja.rows[0].nome_loja}. Valor consignação unit.: R$ ${precoConsignacao.toFixed(2)}`
                });

                itensRegistrados.push({
                    produto_id: produto.produto_id,
                    nome: produto.nome,
                    variacao: produto.variacao,
                    quantidade: qtd,
                    preco_repasse_manual: precoConsignacao,
                    total: valorTotalOriginal
                });
            }

            return { id: remessaId, codigo, itens: itensRegistrados };
        });

        await registrarAuditoria(req.user.id, `Criou remessa ${resultado.codigo} para parceiro ID ${parceiroId}`);
        res.status(201).json({ mensagem: '📦 Remessa em lote enviada!', remessa: resultado });
    } catch (e) {
        console.error('❌ Erro remessa lote:', e);
        res.status(400).json({ erro: e.message || 'Erro ao processar remessa.' });
    }
}

app.post('/api/consignacoes/lote', autenticar, somenteAdmin, processarConsignacoesLote);

app.put('/api/consignacoes/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const novaQuantidade = toInt(req.body.nova_quantidade, 0);

        await transacao(async (client) => {
            const rem = await client.query('SELECT variacao_id, quantidade_atual FROM consignacoes_estoque WHERE id = $1', [id]);
            if (rem.rows.length === 0) throw new Error('Remessa/estoque não encontrado.');

            const { variacao_id, quantidade_atual } = rem.rows[0];
            const diferenca = novaQuantidade - toInt(quantidade_atual, 0);

            if (diferenca > 0) {
                const centro = await client.query('SELECT estoque_central FROM produto_variacoes WHERE id = $1', [variacao_id]);
                if (toInt(centro.rows[0].estoque_central, 0) < diferenca) throw new Error('Estoque central insuficiente!');
            }

            await client.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [diferenca, variacao_id]);
            await client.query('UPDATE consignacoes_estoque SET quantidade_atual = $1 WHERE id = $2', [novaQuantidade, id]);
        });

        res.json({ mensagem: '✅ Quantidade ajustada!' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro no ajuste: ' + e.message });
    }
});

app.delete('/api/consignacoes/:id', autenticar, somenteAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await transacao(async (client) => {
            const rem = await client.query('SELECT variacao_id, quantidade_atual FROM consignacoes_estoque WHERE id = $1', [id]);
            if (rem.rows.length === 0) throw new Error('Estoque consignado não encontrado.');
            await client.query('UPDATE produto_variacoes SET estoque_central = estoque_central + $1 WHERE id = $2', [rem.rows[0].quantidade_atual, rem.rows[0].variacao_id]);
            await client.query('DELETE FROM consignacoes_estoque WHERE id = $1', [id]);
        });
        res.json({ mensagem: '🗑️ Remessa devolvida!' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao excluir: ' + e.message });
    }
});

// Histórico real de remessas
app.get('/api/remessas', autenticar, async (req, res) => {
    try {
        const filtroParceiro = req.user.perfil === 'PARCEIRO'
            ? req.user.parceiro_id
            : (req.query.parceiro_id || req.query.parceiroId || null);

        const params = [];
        let where = '';
        if (filtroParceiro) {
            params.push(Number(filtroParceiro));
            where = `WHERE r.parceiro_id = $${params.length}`;
        }

        const sql = `
            SELECT
                r.id, r.codigo, r.parceiro_id, p.nome_loja,
                r.usuario_id, u.nome AS usuario_nome,
                r.status, r.observacao, r.data_envio, r.data_estorno, r.motivo_estorno,
                TO_CHAR(r.data_envio, 'DD/MM/YYYY HH24:MI') AS data_formatada,
                r.status_assinatura, r.assinada_por, r.documento_assinatura, r.data_assinatura,
                COUNT(ri.id) AS total_itens,
                COALESCE(SUM(COALESCE(ri.quantidade, ri.quantidade_enviada, 0)), 0) AS total_quantidade,
                COALESCE(SUM(COALESCE(ri.quantidade_estornada, 0)), 0) AS total_estornado,
                COALESCE(SUM(COALESCE(ri.valor_total_original,
                    COALESCE(ri.quantidade, ri.quantidade_enviada, 0) * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                )), 0) AS valor_total_original,
                COALESCE(SUM(COALESCE(ri.valor_total_estornado,
                    COALESCE(ri.quantidade_estornada, 0) * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                )), 0) AS valor_total_estornado,
                COALESCE(SUM(COALESCE(ri.valor_total_saldo,
                    (COALESCE(ri.quantidade, ri.quantidade_enviada, 0) - COALESCE(ri.quantidade_estornada, 0)) * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                )), 0) AS valor_total_saldo,
                COALESCE(SUM(COALESCE(ri.valor_total_original,
                    COALESCE(ri.quantidade, ri.quantidade_enviada, 0) * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                )), 0) AS valor_total,
                COALESCE(SUM(COALESCE(ri.valor_total_saldo,
                    (COALESCE(ri.quantidade, ri.quantidade_enviada, 0) - COALESCE(ri.quantidade_estornada, 0)) * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                )), 0) AS valor_saldo
            FROM remessas r
            LEFT JOIN parceiros p ON p.id = r.parceiro_id
            LEFT JOIN usuarios u ON u.id = r.usuario_id
            LEFT JOIN remessa_itens ri ON ri.remessa_id = r.id
            ${where}
            GROUP BY r.id, p.nome_loja, u.nome
            ORDER BY r.data_envio DESC, r.id DESC`;

        const result = await db.query(sql, params);
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro ao listar remessas:', e);
        res.status(500).json({ erro: 'Erro ao listar remessas.' });
    }
});

app.get('/api/remessas/:id', autenticar, async (req, res) => {
    try {
        const id = req.params.id;
        const r = await db.query(
            `SELECT r.*, p.nome_loja, p.responsavel, p.telefone, p.cnpj_cpf, u.nome AS usuario_nome
             FROM remessas r
             LEFT JOIN parceiros p ON p.id = r.parceiro_id
             LEFT JOIN usuarios u ON u.id = r.usuario_id
             WHERE r.id = $1`,
            [id]
        );

        if (r.rows.length === 0) return res.status(404).json({ erro: 'Remessa não encontrada.' });
        const remessa = r.rows[0];
        if (!garantirParceiroPermitido(req, remessa.parceiro_id)) return res.status(403).json({ erro: 'Acesso negado.' });

        const itens = await db.query(
            `SELECT
                ri.*,
                COALESCE(ri.produto_nome_snapshot, p.nome, '-') AS produto_nome,
                COALESCE(ri.variacao_snapshot, v.variacao, '') AS variacao,
                COALESCE(ri.sku_snapshot, v.sku, '') AS sku,
                COALESCE(ri.imagem_url_snapshot, p.imagem_url) AS imagem_url,
                COALESCE(ri.quantidade, ri.quantidade_enviada, 0) AS quantidade,
                COALESCE(ri.quantidade_enviada, ri.quantidade, 0) AS quantidade_enviada,
                COALESCE(ri.quantidade_estornada, 0) AS quantidade_estornada,
                COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0) AS preco_repasse_snapshot,
                COALESCE(ri.preco_repasse_unitario, ri.preco_repasse_snapshot, 0) AS preco_repasse_unitario,
                COALESCE(ri.valor_total_original,
                    COALESCE(ri.quantidade, ri.quantidade_enviada, 0) * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                ) AS valor_total_original,
                COALESCE(ri.valor_total_estornado,
                    COALESCE(ri.quantidade_estornada, 0) * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                ) AS valor_total_estornado,
                COALESCE(ri.valor_total_saldo,
                    (COALESCE(ri.quantidade, ri.quantidade_enviada, 0) - COALESCE(ri.quantidade_estornada, 0)) * COALESCE(ri.preco_repasse_snapshot, ri.preco_repasse_unitario, 0)
                ) AS valor_saldo
             FROM remessa_itens ri
             LEFT JOIN produtos p ON p.id = ri.produto_id
             LEFT JOIN produto_variacoes v ON v.id = ri.variacao_id
             WHERE ri.remessa_id = $1
             ORDER BY ri.id ASC`,
            [id]
        );

        const assinatura = await db.query(
            `SELECT * FROM remessa_assinaturas WHERE remessa_id = $1 ORDER BY data_assinatura DESC LIMIT 1`,
            [id]
        );

        res.json({ remessa, itens: itens.rows, assinatura: assinatura.rows[0] || null });
    } catch (e) {
        console.error('❌ Erro detalhe remessa:', e);
        res.status(500).json({ erro: 'Erro ao buscar remessa.' });
    }
});

app.post('/api/remessas/:id/assinar', autenticar, async (req, res) => {
    try {
        const id = req.params.id;
        const { nome_responsavel, documento_responsavel, assinatura_base64 } = req.body;
        if (!nome_responsavel || !assinatura_base64) return res.status(400).json({ erro: 'Nome e assinatura são obrigatórios.' });

        await transacao(async (client) => {
            const r = await client.query('SELECT id, parceiro_id FROM remessas WHERE id = $1', [id]);
            if (r.rows.length === 0) throw new Error('Remessa não encontrada.');
            if (!garantirParceiroPermitido(req, r.rows[0].parceiro_id)) throw new Error('Acesso negado para assinar esta remessa.');

            await client.query(
                `INSERT INTO remessa_assinaturas
                    (remessa_id, parceiro_id, usuario_id, nome_responsavel, documento_responsavel, assinatura_base64, ip_assinatura, user_agent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    id,
                    r.rows[0].parceiro_id,
                    req.user.id,
                    nome_responsavel,
                    documento_responsavel || null,
                    assinatura_base64,
                    req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
                    req.headers['user-agent'] || null
                ]
            );

            await client.query(
                `UPDATE remessas
                 SET status_assinatura = 'ASSINADA',
                     assinada_por = $1,
                     documento_assinatura = $2,
                     data_assinatura = CURRENT_TIMESTAMP,
                     atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [nome_responsavel, documento_responsavel || null, id]
            );
        });

        await registrarAuditoria(req.user.id, `Assinou recebimento da remessa ID ${id}`);
        res.json({ mensagem: '✅ Recebimento assinado com sucesso!' });
    } catch (e) {
        console.error('❌ Erro assinatura remessa:', e);
        res.status(400).json({ erro: e.message || 'Erro ao assinar remessa.' });
    }
});

app.post('/api/remessas/:id/estornar', autenticar, somenteAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { motivo } = req.body;

        const resultado = await transacao(async (client) => {
            const r = await client.query('SELECT * FROM remessas WHERE id = $1', [id]);
            if (r.rows.length === 0) throw new Error('Remessa não encontrada.');
            const remessa = r.rows[0];

            const itens = await client.query('SELECT * FROM remessa_itens WHERE remessa_id = $1 ORDER BY id ASC', [id]);
            let totalEstornadoAgora = 0;
            let valorEstornadoAgora = 0;

            for (const item of itens.rows) {
                const quantidadeOriginal = toInt(item.quantidade || item.quantidade_enviada, 0);
                const quantidadeJaEstornada = toInt(item.quantidade_estornada, 0);
                const saldoItem = quantidadeOriginal - quantidadeJaEstornada;
                if (saldoItem <= 0) continue;

                const estoqueLoja = await client.query(
                    'SELECT id, quantidade_atual FROM consignacoes_estoque WHERE parceiro_id = $1 AND variacao_id = $2',
                    [remessa.parceiro_id, item.variacao_id]
                );

                if (estoqueLoja.rows.length === 0) continue;
                const disponivelLoja = toInt(estoqueLoja.rows[0].quantidade_atual, 0);
                const qtdEstornar = Math.min(saldoItem, disponivelLoja);
                if (qtdEstornar <= 0) continue;

                const preco = parseMoeda(item.preco_repasse_snapshot || item.preco_repasse_unitario || 0);
                const novaQtdEstornada = quantidadeJaEstornada + qtdEstornar;
                const valorTotalEstornado = money(novaQtdEstornada * preco);
                const valorTotalSaldo = money((quantidadeOriginal - novaQtdEstornada) * preco);

                await client.query(
                    `UPDATE consignacoes_estoque
                     SET quantidade_atual = quantidade_atual - $1
                     WHERE id = $2`,
                    [qtdEstornar, estoqueLoja.rows[0].id]
                );

                await client.query(
                    `UPDATE produto_variacoes
                     SET estoque_central = estoque_central + $1
                     WHERE id = $2`,
                    [qtdEstornar, item.variacao_id]
                );

                await client.query(
                    `UPDATE remessa_itens
                     SET quantidade_estornada = $1,
                         valor_total_estornado = $2,
                         valor_total_saldo = $3
                     WHERE id = $4`,
                    [novaQtdEstornada, valorTotalEstornado, valorTotalSaldo, item.id]
                );

                totalEstornadoAgora += qtdEstornar;
                valorEstornadoAgora += money(qtdEstornar * preco);

                await registrarMovimentacao(client, {
                    produto_id: item.produto_id,
                    variacao_id: item.variacao_id,
                    parceiro_id: remessa.parceiro_id,
                    usuario_id: req.user.id,
                    tipo: 'ESTORNO_REMESSA',
                    quantidade: qtdEstornar,
                    estoque_origem: `PARCEIRO_${remessa.parceiro_id}`,
                    estoque_destino: 'CENTRAL',
                    referencia_tipo: 'REMESSA',
                    referencia_id: remessa.id,
                    observacao: motivo || `Estorno da remessa ${remessa.codigo}`
                });
            }

            const total = await client.query(
                `SELECT
                    COALESCE(SUM(quantidade), 0) AS qtd,
                    COALESCE(SUM(quantidade_estornada), 0) AS est
                 FROM remessa_itens WHERE remessa_id = $1`,
                [id]
            );

            const status = Number(total.rows[0].est) >= Number(total.rows[0].qtd) ? 'ESTORNADA' : 'ESTORNADA_PARCIAL';
            await client.query(
                `UPDATE remessas
                 SET status = $1,
                     data_estorno = CURRENT_TIMESTAMP,
                     motivo_estorno = $2,
                     atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [status, motivo || null, id]
            );

            return { totalEstornadoAgora, valorEstornadoAgora: money(valorEstornadoAgora), status };
        });

        await registrarAuditoria(req.user.id, `Estornou remessa ID ${id}`);
        res.json({ mensagem: '✅ Estorno processado.', resultado });
    } catch (e) {
        console.error('❌ Erro estornar remessa:', e);
        res.status(400).json({ erro: e.message || 'Erro ao estornar remessa.' });
    }
});

// =========================================================
// VENDAS
// =========================================================

app.post('/api/vendas', autenticar, async (req, res) => {
    try {
        const { produto_id, quantidade, parceiro_id, valor_final, valor_total_manual, valor_final_manual } = req.body;
        const qtd = toInt(quantidade, 0);
        if (!produto_id || qtd <= 0) return res.status(400).json({ erro: 'Produto e quantidade são obrigatórios.' });

        await transacao(async (client) => {
            const info = await client.query(
                `SELECT v.id, v.preco_venda, v.preco_repasse, v.estoque_central, p.id AS produto_id, p.nome
                 FROM produto_variacoes v
                 JOIN produtos p ON p.id = v.produto_id
                 WHERE v.produto_id = $1
                 LIMIT 1`,
                [produto_id]
            );
            if (info.rows.length === 0) throw new Error('Produto não encontrado.');
            const v = info.rows[0];

            const perfil = normalizarPerfil(req.user.perfil);
            const pIdFinal = perfil === 'PARCEIRO' ? req.user.parceiro_id : (parceiro_id || null);
            let valorVenda = 0;

            if (pIdFinal) {
                if (!garantirParceiroPermitido(req, pIdFinal) && perfil !== 'ADMIN') throw new Error('Acesso negado para esta loja.');

                const estLoja = await client.query(
                    'SELECT id, quantidade_atual FROM consignacoes_estoque WHERE parceiro_id = $1 AND variacao_id = $2',
                    [pIdFinal, v.id]
                );

                if (estLoja.rows.length === 0 || toInt(estLoja.rows[0].quantidade_atual, 0) < qtd) {
                    throw new Error('Estoque insuficiente na loja parceira!');
                }

                await client.query(
                    `UPDATE consignacoes_estoque
                     SET quantidade_atual = quantidade_atual - $1,
                         quantidade_vendida = COALESCE(quantidade_vendida, 0) + $1
                     WHERE id = $2`,
                    [qtd, estLoja.rows[0].id]
                );

                valorVenda = money(parseMoeda(v.preco_repasse) * qtd);
            } else {
                if (toInt(v.estoque_central, 0) < qtd) throw new Error('Estoque central insuficiente!');
                await client.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [qtd, v.id]);

                const manual = valor_final_manual ?? valor_total_manual ?? valor_final;
                const valorManual = parseMoeda(manual);
                valorVenda = valorManual > 0 ? money(valorManual) : money(parseMoeda(v.preco_venda) * qtd);
            }

            const venda = await client.query(
                `INSERT INTO vendas (parceiro_id, usuario_id, variacao_id, quantidade, valor_total)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id`,
                [pIdFinal || null, req.user.id, v.id, qtd, valorVenda]
            );

            await registrarMovimentacao(client, {
                produto_id: v.produto_id,
                variacao_id: v.id,
                parceiro_id: pIdFinal || null,
                usuario_id: req.user.id,
                tipo: 'VENDA',
                quantidade: qtd,
                estoque_origem: pIdFinal ? `PARCEIRO_${pIdFinal}` : 'CENTRAL',
                referencia_tipo: 'VENDA',
                referencia_id: venda.rows[0].id,
                observacao: `Venda de ${qtd} un. de ${v.nome}. Valor registrado: R$ ${valorVenda.toFixed(2)}`
            });
        });

        res.status(201).json({ mensagem: '✅ Venda realizada com sucesso!' });
    } catch (e) {
        console.error('❌ Erro venda:', e);
        res.status(400).json({ erro: e.message || 'Erro ao processar venda.' });
    }
});

app.get('/api/vendas', autenticar, async (req, res) => {
    try {
        const params = [];
        let where = '';

        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            where = `WHERE v.parceiro_id = $${params.length}`;
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            where = `WHERE v.parceiro_id = $${params.length}`;
        }

        const query = `
            SELECT
                v.id, v.parceiro_id, v.usuario_id, v.variacao_id,
                v.quantidade, v.valor_total, v.status,
                TO_CHAR(v.data_venda, 'DD/MM/YYYY HH24:MI') AS data_formatada,
                p.nome AS produto_nome, p.imagem_url,
                var.variacao,
                COALESCE(parc.nome_loja, 'VENDA DIRETA') AS loja
            FROM vendas v
            JOIN produto_variacoes var ON v.variacao_id = var.id
            JOIN produtos p ON var.produto_id = p.id
            LEFT JOIN parceiros parc ON v.parceiro_id = parc.id
            ${where}
            ORDER BY v.id DESC
            LIMIT 100`;

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro buscar vendas:', e);
        res.status(500).json({ erro: 'Erro ao buscar extrato.' });
    }
});

app.delete('/api/vendas/:id', autenticar, async (req, res) => {
    try {
        const { id } = req.params;
        await transacao(async (client) => {
            const vRes = await client.query('SELECT * FROM vendas WHERE id = $1', [id]);
            if (vRes.rows.length === 0) throw new Error('Venda não encontrada.');
            const venda = vRes.rows[0];

            if (req.user.perfil === 'PARCEIRO' && Number(venda.parceiro_id) !== Number(req.user.parceiro_id)) {
                throw new Error('Você só pode estornar vendas da sua loja.');
            }

            if (venda.parceiro_id) {
                await client.query(
                    `UPDATE consignacoes_estoque
                     SET quantidade_atual = quantidade_atual + $1,
                         quantidade_vendida = GREATEST(COALESCE(quantidade_vendida, 0) - $1, 0)
                     WHERE parceiro_id = $2 AND variacao_id = $3`,
                    [venda.quantidade, venda.parceiro_id, venda.variacao_id]
                );
            } else {
                await client.query('UPDATE produto_variacoes SET estoque_central = estoque_central + $1 WHERE id = $2', [venda.quantidade, venda.variacao_id]);
            }

            await client.query('DELETE FROM vendas WHERE id = $1', [id]);

            await registrarMovimentacao(client, {
                variacao_id: venda.variacao_id,
                parceiro_id: venda.parceiro_id || null,
                usuario_id: req.user.id,
                tipo: 'ESTORNO_VENDA',
                quantidade: venda.quantidade,
                estoque_destino: venda.parceiro_id ? `PARCEIRO_${venda.parceiro_id}` : 'CENTRAL',
                referencia_tipo: 'VENDA',
                referencia_id: id,
                observacao: `Estorno de venda ID ${id}`
            });
        });

        res.json({ mensagem: '✅ Venda estornada!' });
    } catch (e) {
        console.error('❌ Erro cancelar venda:', e);
        res.status(400).json({ erro: e.message || 'Erro ao cancelar venda.' });
    }
});

// =========================================================
// FINANCEIRO
// =========================================================

app.get('/api/financeiro/repasses', autenticar, async (req, res) => {
    try {
        const params = [];
        let where = '';
        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            where = `WHERE f.parceiro_id = $${params.length}`;
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            where = `WHERE f.parceiro_id = $${params.length}`;
        }

        const query = `
            SELECT
                f.*,
                p.nome_loja,
                u.nome AS usuario_fechamento_nome
            FROM financeiro_repasses f
            LEFT JOIN parceiros p ON p.id = f.parceiro_id
            LEFT JOIN usuarios u ON u.id = f.usuario_fechamento_id
            ${where}
            ORDER BY f.mes_referencia DESC, f.id DESC`;

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro ao listar repasses:', e);
        res.status(500).json({ erro: 'Erro ao listar repasses: ' + e.message });
    }
});

app.get('/api/financeiro/resumo', autenticar, async (req, res) => {
    try {
        const { inicio, fim, ref } = inicioFimMes(req.query.mes_referencia);
        const params = [inicio, fim];
        let filtroParceiro = '';

        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            filtroParceiro = `AND v.parceiro_id = $${params.length}`;
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            filtroParceiro = `AND v.parceiro_id = $${params.length}`;
        }

        const result = await db.query(
            `SELECT
                COALESCE(parc.id, 0) AS parceiro_id,
                COALESCE(parc.nome_loja, 'VENDA DIRETA') AS nome_loja,
                COUNT(v.id) AS total_vendas,
                COALESCE(SUM(v.quantidade), 0) AS quantidade_vendida,
                COALESCE(SUM(v.valor_total), 0) AS valor_total
             FROM vendas v
             LEFT JOIN parceiros parc ON parc.id = v.parceiro_id
             WHERE v.data_venda >= $1::date
               AND v.data_venda < $2::date
               ${filtroParceiro}
             GROUP BY parc.id, parc.nome_loja
             ORDER BY valor_total DESC`,
            params
        );

        res.json({ mes_referencia: ref, resumo: result.rows });
    } catch (e) {
        console.error('❌ Erro resumo financeiro:', e);
        res.status(500).json({ erro: 'Erro ao gerar resumo financeiro.' });
    }
});

app.post('/api/financeiro/fechar', autenticar, somenteAdmin, async (req, res) => {
    try {
        const parceiroId = toInt(req.body.parceiro_id, 0);
        const { inicio, fim, ref } = inicioFimMes(req.body.mes_referencia);
        if (!parceiroId) return res.status(400).json({ erro: 'Selecione uma loja para fechar.' });

        const resultado = await transacao(async (client) => {
            const vendas = await client.query(
                `SELECT
                    COUNT(v.id) AS total_vendas,
                    COALESCE(SUM(v.quantidade), 0) AS quantidade_vendida,
                    COALESCE(SUM(v.valor_total), 0) AS valor_total
                 FROM vendas v
                 WHERE v.parceiro_id = $1
                   AND v.data_venda >= $2::date
                   AND v.data_venda < $3::date`,
                [parceiroId, inicio, fim]
            );

            const quantidadeVendida = toInt(vendas.rows[0].quantidade_vendida, 0);
            const valorTotalVendido = money(vendas.rows[0].valor_total);
            const valorLiquidoReceber = valorTotalVendido;
            const codigo = gerarCodigo('REP');

            const existente = await client.query(
                'SELECT id, status_pagamento FROM financeiro_repasses WHERE parceiro_id = $1 AND mes_referencia = $2',
                [parceiroId, ref]
            );

            if (existente.rows.length > 0 && existente.rows[0].status_pagamento === 'PAGO') {
                throw new Error('Este fechamento já foi marcado como PAGO. Reabra manualmente antes de alterar.');
            }

            let fechamentoId;
            if (existente.rows.length > 0) {
                const upd = await client.query(
                    `UPDATE financeiro_repasses
                     SET valor_total_vendido = $1,
                         valor_comissao_parceiro = 0,
                         valor_liquido_receber = $2,
                         quantidade_vendida = $3,
                         periodo_inicio = $4,
                         periodo_fim = ($5::date - INTERVAL '1 day')::date,
                         data_fechamento = CURRENT_TIMESTAMP,
                         usuario_fechamento_id = $6,
                         codigo_fechamento = COALESCE(codigo_fechamento, $7),
                         status_pagamento = 'PENDENTE',
                         atualizado_em = CURRENT_TIMESTAMP
                     WHERE id = $8
                     RETURNING id`,
                    [valorTotalVendido, valorLiquidoReceber, quantidadeVendida, inicio, fim, req.user.id, codigo, existente.rows[0].id]
                );
                fechamentoId = upd.rows[0].id;
            } else {
                const ins = await client.query(
                    `INSERT INTO financeiro_repasses
                        (parceiro_id, mes_referencia, valor_total_vendido, valor_comissao_parceiro,
                         valor_liquido_receber, status_pagamento, quantidade_vendida, periodo_inicio, periodo_fim,
                         data_fechamento, usuario_fechamento_id, codigo_fechamento)
                     VALUES ($1,$2,$3,0,$4,'PENDENTE',$5,$6,($7::date - INTERVAL '1 day')::date,CURRENT_TIMESTAMP,$8,$9)
                     RETURNING id`,
                    [parceiroId, ref, valorTotalVendido, valorLiquidoReceber, quantidadeVendida, inicio, fim, req.user.id, codigo]
                );
                fechamentoId = ins.rows[0].id;
            }

            return { id: fechamentoId, mes_referencia: ref, quantidade_vendida: quantidadeVendida, valor_liquido_receber: valorLiquidoReceber };
        });

        await registrarAuditoria(req.user.id, `Gerou fechamento financeiro ${resultado.mes_referencia} do parceiro ${parceiroId}`);
        res.status(201).json({ mensagem: '✅ Fechamento financeiro gerado!', fechamento: resultado });
    } catch (e) {
        console.error('❌ Erro fechar financeiro:', e);
        res.status(400).json({ erro: e.message || 'Erro ao fechar financeiro.' });
    }
});

app.put('/api/financeiro/repasses/:id/pagar', autenticar, somenteAdmin, async (req, res) => {
    try {
        await db.query(
            `UPDATE financeiro_repasses
             SET status_pagamento = 'PAGO', data_pagamento = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [req.params.id]
        );
        await registrarAuditoria(req.user.id, `Marcou repasse ID ${req.params.id} como PAGO`);
        res.json({ mensagem: '✅ Repasse marcado como pago.' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao marcar repasse como pago.' });
    }
});

// =========================================================

// =========================================================
// PRODUÇÃO / ENTRADA DE ESTOQUE CENTRAL
// =========================================================

app.get('/api/producoes', autenticar, somenteAdmin, async (req, res) => {
    try {
        const r = await db.query(`
            SELECT pr.*, 
                   TO_CHAR(pr.data_producao, 'DD/MM/YYYY HH24:MI') AS data_formatada,
                   p.nome AS produto_nome, p.imagem_url,
                   v.variacao, v.sku,
                   m.nome AS maquina_nome,
                   u.nome AS usuario_nome
            FROM producoes pr
            LEFT JOIN produtos p ON p.id = pr.produto_id
            LEFT JOIN produto_variacoes v ON v.id = pr.variacao_id
            LEFT JOIN maquinas m ON m.id = pr.maquina_id
            LEFT JOIN usuarios u ON u.id = pr.usuario_id
            ORDER BY pr.id DESC
            LIMIT 200
        `);
        res.json(r.rows);
    } catch (e) {
        console.error('❌ Erro produções:', e);
        res.status(500).json({ erro: 'Erro ao listar produções: ' + e.message });
    }
});

app.post('/api/producoes', autenticar, somenteAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const produtoId = toInt(body.produto_id, 0);
        const variacaoId = toInt(body.variacao_id, 0);
        const quantidadeProduzida = toInt(body.quantidade_produzida, 0);
        const status = String(body.status || 'FINALIZADA').toUpperCase();
        if (!produtoId || !variacaoId) return res.status(400).json({ erro: 'Produto e variação são obrigatórios.' });
        if (quantidadeProduzida <= 0 && status === 'FINALIZADA') return res.status(400).json({ erro: 'Quantidade produzida precisa ser maior que zero para finalizar.' });

        let producaoId;
        await transacao(async (client) => {
            const produto = await client.query(`
                SELECT p.nome, v.variacao, v.estoque_central
                FROM produtos p
                JOIN produto_variacoes v ON v.produto_id = p.id
                WHERE p.id = $1 AND v.id = $2
                LIMIT 1
            `, [produtoId, variacaoId]);
            if (produto.rows.length === 0) throw new Error('Produto/variação não encontrado.');

            let maquina = null;
            const maquinaId = body.maquina_id ? toInt(body.maquina_id, 0) : null;
            if (maquinaId) {
                const maq = await client.query('SELECT id, nome, custo_total_hora FROM maquinas WHERE id = $1', [maquinaId]);
                maquina = maq.rows[0] || null;
            }

            const codigo = gerarCodigo('PROD');
            const estoqueLancado = status === 'FINALIZADA';
            const dataProducao = body.data_producao ? new Date(body.data_producao) : new Date();

            const ins = await client.query(`
                INSERT INTO producoes (
                    codigo, produto_id, variacao_id, maquina_id, maquina_nome_snapshot, usuario_id,
                    status, quantidade_planejada, quantidade_produzida, quantidade_perdida, unidade,
                    peso_gramas, valor_kg_material, tempo_maquina_horas, custo_hora_maquina,
                    custo_material, custo_maquina, custo_energia, custo_mao_obra, custo_embalagem,
                    custo_acessorios, custo_perdas, custo_extra, custo_total, custo_unitario,
                    data_producao, estoque_lancado, observacao
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,
                    $7,$8,$9,$10,$11,
                    $12,$13,$14,$15,
                    $16,$17,$18,$19,$20,
                    $21,$22,$23,$24,$25,
                    $26,$27,$28
                ) RETURNING id
            `, [
                codigo, produtoId, variacaoId, maquina?.id || null, maquina?.nome || null, req.user.id,
                status, toInt(body.quantidade_planejada, 0), quantidadeProduzida, toInt(body.quantidade_perdida, 0), body.unidade || 'UNIDADE',
                parseMoeda(body.peso_gramas), parseMoeda(body.valor_kg_material), parseMoeda(body.tempo_maquina_horas), parseMoeda(body.custo_hora_maquina || maquina?.custo_total_hora),
                parseMoeda(body.custo_material), parseMoeda(body.custo_maquina), parseMoeda(body.custo_energia), parseMoeda(body.custo_mao_obra), parseMoeda(body.custo_embalagem),
                parseMoeda(body.custo_acessorios), parseMoeda(body.custo_perdas), parseMoeda(body.custo_extra), parseMoeda(body.custo_total), parseMoeda(body.custo_unitario),
                dataProducao, estoqueLancado, body.observacao || null
            ]);
            producaoId = ins.rows[0].id;

            if (estoqueLancado) {
                await client.query('UPDATE produto_variacoes SET estoque_central = estoque_central + $1 WHERE id = $2', [quantidadeProduzida, variacaoId]);
                await registrarMovimentacao(client, {
                    produto_id: produtoId,
                    variacao_id: variacaoId,
                    usuario_id: req.user.id,
                    tipo: 'ENTRADA_PRODUCAO',
                    quantidade: quantidadeProduzida,
                    estoque_destino: 'CENTRAL',
                    referencia_tipo: 'PRODUCAO',
                    referencia_id: producaoId,
                    observacao: `Entrada por produção ${codigo}`
                });
            }
        });

        await registrarAuditoria(req.user.id, `Registrou produção ID ${producaoId}`);
        res.status(201).json({ mensagem: 'Produção registrada com sucesso.', id: producaoId });
    } catch (e) {
        console.error('❌ Erro cadastrar produção:', e);
        res.status(500).json({ erro: 'Erro ao registrar produção: ' + e.message });
    }
});

app.put('/api/producoes/:id/finalizar', autenticar, somenteAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        await transacao(async (client) => {
            const r = await client.query('SELECT * FROM producoes WHERE id = $1 FOR UPDATE', [id]);
            if (r.rows.length === 0) throw new Error('Produção não encontrada.');
            const p = r.rows[0];
            if (p.status === 'CANCELADA') throw new Error('Produção cancelada não pode ser finalizada.');
            if (p.estoque_lancado) throw new Error('Estoque desta produção já foi lançado.');
            const qtd = toInt(p.quantidade_produzida, 0);
            if (qtd <= 0) throw new Error('Quantidade produzida precisa ser maior que zero.');
            await client.query(`UPDATE producoes SET status = 'FINALIZADA', estoque_lancado = true, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
            await client.query('UPDATE produto_variacoes SET estoque_central = estoque_central + $1 WHERE id = $2', [qtd, p.variacao_id]);
            await registrarMovimentacao(client, {
                produto_id: p.produto_id,
                variacao_id: p.variacao_id,
                usuario_id: req.user.id,
                tipo: 'ENTRADA_PRODUCAO',
                quantidade: qtd,
                estoque_destino: 'CENTRAL',
                referencia_tipo: 'PRODUCAO',
                referencia_id: id,
                observacao: `Finalização da produção ${p.codigo || id}`
            });
        });
        await registrarAuditoria(req.user.id, `Finalizou produção ID ${id}`);
        res.json({ mensagem: 'Produção finalizada e estoque lançado.' });
    } catch (e) {
        res.status(400).json({ erro: 'Erro ao finalizar produção: ' + e.message });
    }
});

app.put('/api/producoes/:id/cancelar', autenticar, somenteAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const motivo = req.body?.motivo || '';
        await transacao(async (client) => {
            const r = await client.query('SELECT * FROM producoes WHERE id = $1 FOR UPDATE', [id]);
            if (r.rows.length === 0) throw new Error('Produção não encontrada.');
            const p = r.rows[0];
            if (p.status === 'CANCELADA') throw new Error('Produção já está cancelada.');
            const qtd = toInt(p.quantidade_produzida, 0);
            if (p.estoque_lancado && qtd > 0) {
                const est = await client.query('SELECT estoque_central FROM produto_variacoes WHERE id = $1', [p.variacao_id]);
                const atual = toInt(est.rows[0]?.estoque_central, 0);
                if (atual < qtd) throw new Error('Não é possível cancelar: estoque central atual é menor que a quantidade lançada.');
                await client.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [qtd, p.variacao_id]);
                await registrarMovimentacao(client, {
                    produto_id: p.produto_id,
                    variacao_id: p.variacao_id,
                    usuario_id: req.user.id,
                    tipo: 'ESTORNO_PRODUCAO',
                    quantidade: -qtd,
                    estoque_origem: 'CENTRAL',
                    referencia_tipo: 'PRODUCAO',
                    referencia_id: id,
                    observacao: `Cancelamento da produção ${p.codigo || id}. ${motivo}`
                });
            }
            await client.query(`UPDATE producoes SET status = 'CANCELADA', motivo_cancelamento = $2, estoque_lancado = false, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1`, [id, motivo]);
        });
        await registrarAuditoria(req.user.id, `Cancelou produção ID ${id}`);
        res.json({ mensagem: 'Produção cancelada.' });
    } catch (e) {
        res.status(400).json({ erro: 'Erro ao cancelar produção: ' + e.message });
    }
});


// =========================================================
// FINANCEIRO V3 - ROTAS DE COMPATIBILIDADE DA TELA FINANCEIRO
// =========================================================

app.get('/api/financeiro/v3/resumo', autenticar, async (req, res) => {
    try {
        const periodo = req.query.periodo || req.query.mes_referencia;
        const { inicio, fim, ref } = inicioFimMes(periodo);
        const params = [inicio, fim, ref];
        let filtroParceiro = '';

        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            filtroParceiro = `AND v.parceiro_id = $${params.length}`;
        } else if (String(req.query.parceiro_id) === '0') {
            filtroParceiro = `AND v.parceiro_id IS NULL`;
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            filtroParceiro = `AND v.parceiro_id = $${params.length}`;
        }

        const lojas = await db.query(`
            WITH vendas_base AS (
                SELECT v.id, v.parceiro_id, v.variacao_id, v.quantidade, v.valor_total,
                       COALESCE(pv.preco_repasse, 0) AS preco_repasse
                FROM vendas v
                LEFT JOIN produto_variacoes pv ON pv.id = v.variacao_id
                WHERE v.data_venda >= $1::date
                  AND v.data_venda < $2::date
                  ${filtroParceiro}
            )
            SELECT
                COALESCE(parc.id, 0) AS parceiro_id,
                COALESCE(parc.nome_loja, 'VENDA DIRETA') AS nome_loja,
                parc.responsavel,
                COUNT(vb.id) AS total_vendas,
                COALESCE(SUM(vb.quantidade), 0) AS total_pecas,
                COALESCE(SUM(vb.valor_total), 0) AS valor_total_vendido,
                COALESCE(SUM(vb.quantidade * vb.preco_repasse), 0) AS valor_liquido_receber,
                COALESCE(SUM(vb.valor_total), 0) - COALESCE(SUM(vb.quantidade * vb.preco_repasse), 0) AS valor_comissao_parceiro,
                fr.status_pagamento AS status_fechamento
            FROM vendas_base vb
            LEFT JOIN parceiros parc ON parc.id = vb.parceiro_id
            LEFT JOIN financeiro_repasses fr
              ON fr.mes_referencia = $3
             AND ((parc.id IS NULL AND fr.parceiro_id IS NULL) OR fr.parceiro_id = parc.id)
            GROUP BY parc.id, parc.nome_loja, parc.responsavel, fr.status_pagamento
            ORDER BY valor_total_vendido DESC`, params);

        const itensParams = [inicio, fim];
        let filtroItens = '';
        if (req.user.perfil === 'PARCEIRO') { itensParams.push(req.user.parceiro_id); filtroItens = `AND v.parceiro_id = $${itensParams.length}`; }
        else if (String(req.query.parceiro_id) === '0') { filtroItens = `AND v.parceiro_id IS NULL`; }
        else if (req.query.parceiro_id) { itensParams.push(req.query.parceiro_id); filtroItens = `AND v.parceiro_id = $${itensParams.length}`; }

        const itens = await db.query(`
            SELECT COALESCE(parc.id, 0) AS parceiro_id,
                   COALESCE(parc.nome_loja, 'VENDA DIRETA') AS nome_loja,
                   p.nome AS produto_nome, pv.variacao,
                   COALESCE(pv.preco_repasse, 0) AS preco_repasse,
                   COALESCE(SUM(v.quantidade), 0) AS quantidade,
                   COALESCE(SUM(v.valor_total), 0) AS total_vendido,
                   COALESCE(SUM(v.quantidade * COALESCE(pv.preco_repasse, 0)), 0) AS total_repasse
            FROM vendas v
            LEFT JOIN parceiros parc ON parc.id = v.parceiro_id
            LEFT JOIN produto_variacoes pv ON pv.id = v.variacao_id
            LEFT JOIN produtos p ON p.id = pv.produto_id
            WHERE v.data_venda >= $1::date
              AND v.data_venda < $2::date
              ${filtroItens}
            GROUP BY parc.id, parc.nome_loja, p.nome, pv.variacao, pv.preco_repasse
            ORDER BY nome_loja, produto_nome`, itensParams);

        const totalVendido = lojas.rows.reduce((soma, l) => soma + Number(l.valor_total_vendido || 0), 0);
        const totalLiquido = lojas.rows.reduce((soma, l) => soma + Number(l.valor_liquido_receber || 0), 0);
        const totalMargem = lojas.rows.reduce((soma, l) => soma + Number(l.valor_comissao_parceiro || 0), 0);
        const totalPendente = lojas.rows.filter(l => String(l.status_fechamento || '').toUpperCase() !== 'PAGO').reduce((soma, l) => soma + Number(l.valor_liquido_receber || 0), 0);

        res.json({ periodo: ref, resumo: { total_vendido: totalVendido, total_liquido: totalLiquido, total_margem: totalMargem, total_pendente: totalPendente }, lojas: lojas.rows, itens: itens.rows });
    } catch (e) {
        console.error('❌ Erro financeiro v3 resumo:', e);
        res.status(500).json({ erro: 'Erro ao gerar resumo financeiro: ' + e.message });
    }
});

app.get('/api/financeiro/v3/repasses', autenticar, async (req, res) => {
    try {
        const periodo = req.query.periodo || req.query.mes_referencia;
        const { ref } = inicioFimMes(periodo);
        const params = [];
        const filtros = [];
        if (ref) { params.push(ref); filtros.push(`f.mes_referencia = $${params.length}`); }
        if (req.user.perfil === 'PARCEIRO') { params.push(req.user.parceiro_id); filtros.push(`f.parceiro_id = $${params.length}`); }
        else if (String(req.query.parceiro_id) === '0') { filtros.push('f.parceiro_id IS NULL'); }
        else if (req.query.parceiro_id) { params.push(req.query.parceiro_id); filtros.push(`f.parceiro_id = $${params.length}`); }
        const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
        const r = await db.query(`
            SELECT f.*, COALESCE(p.nome_loja, 'VENDA DIRETA') AS nome_loja,
                   TO_CHAR(COALESCE(f.atualizado_em, f.criado_em, CURRENT_TIMESTAMP), 'DD/MM/YYYY HH24:MI') AS atualizado_em_formatado
            FROM financeiro_repasses f
            LEFT JOIN parceiros p ON p.id = f.parceiro_id
            ${where}
            ORDER BY f.mes_referencia DESC, f.id DESC`, params);
        res.json(r.rows);
    } catch (e) {
        console.error('❌ Erro financeiro v3 repasses:', e);
        res.status(500).json({ erro: 'Erro ao listar repasses: ' + e.message });
    }
});

app.post('/api/financeiro/v3/repasses/gerar', autenticar, somenteAdmin, async (req, res) => {
    try {
        const periodo = req.body.periodo || req.body.mes_referencia;
        const { inicio, fim, ref } = inicioFimMes(periodo);
        const informouParceiro = Object.prototype.hasOwnProperty.call(req.body, 'parceiro_id') && req.body.parceiro_id !== '' && req.body.parceiro_id !== null && req.body.parceiro_id !== undefined;
        const parceiroId = informouParceiro ? toInt(req.body.parceiro_id, 0) : null;
        let parceiros;
        if (informouParceiro) parceiros = parceiroId > 0 ? [{ id: parceiroId }] : [{ id: null }];
        else parceiros = (await db.query('SELECT DISTINCT parceiro_id AS id FROM vendas WHERE data_venda >= $1::date AND data_venda < $2::date', [inicio, fim])).rows;

        let gerados = 0;
        for (const parceiro of parceiros) {
            const vendaDireta = parceiro.id === null || parceiro.id === undefined || Number(parceiro.id) === 0;
            const pid = vendaDireta ? null : toInt(parceiro.id, 0);
            await transacao(async (client) => {
                const whereParceiro = vendaDireta ? 'v.parceiro_id IS NULL' : 'v.parceiro_id = $1';
                const vendasParams = vendaDireta ? [inicio, fim] : [pid, inicio, fim];
                const vendas = await client.query(`
                    SELECT COUNT(v.id) AS total_vendas,
                           COALESCE(SUM(v.quantidade), 0) AS quantidade_vendida,
                           COALESCE(SUM(v.valor_total), 0) AS valor_total_vendido,
                           COALESCE(SUM(v.quantidade * COALESCE(pv.preco_repasse, 0)), 0) AS valor_liquido_receber
                    FROM vendas v
                    LEFT JOIN produto_variacoes pv ON pv.id = v.variacao_id
                    WHERE ${whereParceiro}
                      AND v.data_venda >= $${vendaDireta ? 1 : 2}::date
                      AND v.data_venda < $${vendaDireta ? 2 : 3}::date`, vendasParams);
                const row = vendas.rows[0] || {};
                const valorTotal = Number(row.valor_total_vendido || 0);
                const valorLiquido = Number(row.valor_liquido_receber || 0);
                const qtd = Number(row.quantidade_vendida || 0);
                if (valorTotal <= 0 && qtd <= 0) return;
                const codigo = vendaDireta ? `FIN-${ref.replace('-', '')}-DIRETA` : `FIN-${ref.replace('-', '')}-${pid}`;
                const existe = vendaDireta
                    ? await client.query('SELECT id, status_pagamento FROM financeiro_repasses WHERE parceiro_id IS NULL AND mes_referencia = $1', [ref])
                    : await client.query('SELECT id, status_pagamento FROM financeiro_repasses WHERE parceiro_id = $1 AND mes_referencia = $2', [pid, ref]);
                if (existe.rows.length) {
                    if (String(existe.rows[0].status_pagamento || '').toUpperCase() === 'PAGO') return;
                    await client.query(`UPDATE financeiro_repasses
                        SET valor_total_vendido=$1, valor_comissao_parceiro=$2, valor_liquido_receber=$3, quantidade_vendida=$4,
                            periodo_inicio=$5, periodo_fim=($6::date - INTERVAL '1 day')::date, atualizado_em=CURRENT_TIMESTAMP
                        WHERE id=$7`, [valorTotal, valorTotal - valorLiquido, valorLiquido, qtd, inicio, fim, existe.rows[0].id]);
                } else {
                    await client.query(`INSERT INTO financeiro_repasses
                        (parceiro_id, mes_referencia, valor_total_vendido, valor_comissao_parceiro, valor_liquido_receber,
                         status_pagamento, quantidade_vendida, periodo_inicio, periodo_fim, data_fechamento, usuario_fechamento_id, codigo_fechamento)
                        VALUES ($1,$2,$3,$4,$5,'PENDENTE',$6,$7,($8::date - INTERVAL '1 day')::date,CURRENT_TIMESTAMP,$9,$10)`,
                        [pid, ref, valorTotal, valorTotal - valorLiquido, valorLiquido, qtd, inicio, fim, req.user.id, codigo]);
                }
                gerados += 1;
            });
        }
        await registrarAuditoria(req.user.id, `Gerou ${gerados} fechamento(s) financeiro(s) do período ${ref}`);
        res.status(201).json({ mensagem: `✅ ${gerados} fechamento(s) gerado(s).` });
    } catch (e) {
        console.error('❌ Erro financeiro v3 gerar:', e);
        res.status(400).json({ erro: e.message || 'Erro ao gerar fechamento.' });
    }
});

app.patch('/api/financeiro/v3/repasses/:id/status', autenticar, somenteAdmin, async (req, res) => {
    try {
        const status = String(req.body.status_pagamento || '').toUpperCase();
        if (!['PENDENTE', 'PAGO', 'CANCELADO'].includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
        await db.query(`UPDATE financeiro_repasses SET status_pagamento = $1::varchar, data_pagamento = CASE WHEN $1::text = 'PAGO' THEN CURRENT_TIMESTAMP ELSE data_pagamento END, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2`, [status, req.params.id]);
        await registrarAuditoria(req.user.id, `Alterou status do repasse ID ${req.params.id} para ${status}`);
        res.json({ mensagem: 'Status do repasse atualizado.' });
    } catch (e) {
        console.error('❌ Erro financeiro v3 status:', e);
        res.status(500).json({ erro: 'Erro ao atualizar status.' });
    }
});

app.get('/api/financeiro/v3/repasses/:id', autenticar, async (req, res) => {
    try {
        const rep = await db.query("SELECT f.*, COALESCE(p.nome_loja, 'VENDA DIRETA') AS nome_loja FROM financeiro_repasses f LEFT JOIN parceiros p ON p.id = f.parceiro_id WHERE f.id = $1", [req.params.id]);
        if (!rep.rows.length) return res.status(404).json({ erro: 'Repasse não encontrado.' });
        const r = rep.rows[0];
        if (req.user.perfil === 'PARCEIRO' && Number(r.parceiro_id) !== Number(req.user.parceiro_id)) return res.status(403).json({ erro: 'Acesso negado.' });
        const { inicio, fim } = inicioFimMes(r.mes_referencia);
        const vendaDireta = !r.parceiro_id;
        const itens = await db.query(`
            SELECT p.nome AS produto_nome, pv.variacao,
                   COALESCE(SUM(v.quantidade), 0) AS quantidade,
                   COALESCE(pv.preco_repasse, 0) AS preco_repasse,
                   COALESCE(SUM(v.valor_total), 0) AS total_vendido,
                   COALESCE(SUM(v.quantidade * COALESCE(pv.preco_repasse, 0)), 0) AS total_repasse
            FROM vendas v
            LEFT JOIN produto_variacoes pv ON pv.id = v.variacao_id
            LEFT JOIN produtos p ON p.id = pv.produto_id
            WHERE ${vendaDireta ? 'v.parceiro_id IS NULL' : 'v.parceiro_id = $1'}
              AND v.data_venda >= $${vendaDireta ? 1 : 2}::date
              AND v.data_venda < $${vendaDireta ? 2 : 3}::date
            GROUP BY p.nome, pv.variacao, pv.preco_repasse
            ORDER BY p.nome`, vendaDireta ? [inicio, fim] : [r.parceiro_id, inicio, fim]);
        res.json({ repasse: r, itens: itens.rows });
    } catch (e) {
        console.error('❌ Erro financeiro v3 detalhe:', e);
        res.status(500).json({ erro: 'Erro ao buscar detalhe do repasse.' });
    }
});

// =========================================================
// AUDITORIA - COMPATIBILIDADE /api/logs
// =========================================================

app.get('/api/logs', autenticar, somenteAdmin, async (req, res) => {
    try {
        const logs = await db.query(
            `SELECT l.id,
                    l.acao,
                    TO_CHAR(COALESCE(l.data_hora, CURRENT_TIMESTAMP), 'DD/MM/YYYY HH24:MI') AS data_formatada,
                    COALESCE(u.nome, 'Sistema') AS usuario
             FROM logs_auditoria l
             LEFT JOIN usuarios u ON u.id = l.usuario_id
             ORDER BY l.id DESC
             LIMIT 250`
        );
        res.json(logs.rows);
    } catch (e) {
        console.error('❌ Erro /api/logs:', e);
        res.status(500).json({ erro: 'Erro ao buscar logs: ' + e.message });
    }
});


// DASHBOARD / RELATÓRIOS / HISTÓRICOS
// =========================================================

app.get('/api/dashboard', autenticar, async (req, res) => {
    try {
        if (req.user.perfil === 'PARCEIRO') {
            const pId = req.user.parceiro_id;
            const vMes = await db.query(
                `SELECT COUNT(*) AS total_pedidos, COALESCE(SUM(valor_total), 0) AS receita_total
                 FROM vendas
                 WHERE parceiro_id = $1
                   AND EXTRACT(MONTH FROM data_venda) = EXTRACT(MONTH FROM CURRENT_DATE)
                   AND EXTRACT(YEAR FROM data_venda) = EXTRACT(YEAR FROM CURRENT_DATE)`,
                [pId]
            );
            const estoque = await db.query(
                `SELECT COALESCE(SUM(quantidade_atual), 0) AS total_produtos
                 FROM consignacoes_estoque WHERE parceiro_id = $1`,
                [pId]
            );
            const ranking = await db.query(
                `SELECT p.nome, SUM(v.quantidade) AS total_vendido
                 FROM vendas v
                 JOIN produto_variacoes var ON v.variacao_id = var.id
                 JOIN produtos p ON var.produto_id = p.id
                 WHERE v.parceiro_id = $1
                 GROUP BY p.nome
                 ORDER BY total_vendido DESC
                 LIMIT 5`,
                [pId]
            );
            return res.json({
                pedidos_mes: vMes.rows[0].total_pedidos,
                receita_mes: vMes.rows[0].receita_total,
                patrimonio: { quantidade: estoque.rows[0].total_produtos, valor: 0 },
                parceiros_estoque: [],
                estoque_lista: [],
                ranking: ranking.rows
            });
        }

        const vMes = await db.query(
            `SELECT COUNT(*) AS total_pedidos, COALESCE(SUM(valor_total), 0) AS receita_total
             FROM vendas
             WHERE EXTRACT(MONTH FROM data_venda) = EXTRACT(MONTH FROM CURRENT_DATE)
               AND EXTRACT(YEAR FROM data_venda) = EXTRACT(YEAR FROM CURRENT_DATE)`
        );
        // Estoque patrimonial do ADMIN/PERSONALIZE.
        // Importante na V5 Multi Catálogo: produtos cadastrados por lojas parceiras
        // não podem entrar no valor de estoque do admin.
        const estoquePatrimonio = await db.query(
            `SELECT 
                    COALESCE(SUM(COALESCE(v.estoque_central, 0)), 0) AS qtd_total_central,
                    COALESCE(SUM(COALESCE(v.estoque_central, 0) * COALESCE(v.custo_producao, 0)), 0) AS valor_total_custo,
                    COALESCE(SUM(COALESCE(v.estoque_central, 0) * COALESCE(v.preco_venda, 0)), 0) AS valor_total_venda
             FROM produto_variacoes v
             JOIN produtos p ON p.id = v.produto_id
             WHERE COALESCE(p.dono_tipo, 'ADMIN') = 'ADMIN'
               AND p.parceiro_id IS NULL
               AND COALESCE(p.produto_global, true) = true`
        );
        const estoquePorParceiro = await db.query(
            `SELECT p.nome_loja, COALESCE(SUM(c.quantidade_atual), 0) AS total_produtos
             FROM parceiros p
             LEFT JOIN consignacoes_estoque c ON p.id = c.parceiro_id
             GROUP BY p.nome_loja
             ORDER BY total_produtos DESC`
        );
        const eBaixo = await db.query(
            `SELECT p.nome, v.estoque_central, v.variacao
             FROM produto_variacoes v
             JOIN produtos p ON p.id = v.produto_id
             WHERE COALESCE(v.estoque_central, 0) < 5
               AND COALESCE(p.dono_tipo, 'ADMIN') = 'ADMIN'
               AND p.parceiro_id IS NULL
               AND COALESCE(p.produto_global, true) = true
             ORDER BY v.estoque_central ASC
             LIMIT 6`
        );
        const rank = await db.query(
            `SELECT p.nome, SUM(v.quantidade) AS total_vendido
             FROM vendas v
             JOIN produto_variacoes var ON v.variacao_id = var.id
             JOIN produtos p ON var.produto_id = p.id
             GROUP BY p.nome
             ORDER BY total_vendido DESC
             LIMIT 6`
        );

        res.json({
            pedidos_mes: vMes.rows[0].total_pedidos,
            receita_mes: vMes.rows[0].receita_total,
            patrimonio: {
                quantidade: estoquePatrimonio.rows[0].qtd_total_central,
                valor: estoquePatrimonio.rows[0].valor_total_custo,
                valor_venda: estoquePatrimonio.rows[0].valor_total_venda
            },
            parceiros_estoque: estoquePorParceiro.rows,
            estoque_lista: eBaixo.rows,
            ranking: rank.rows
        });
    } catch (e) {
        console.error('❌ Erro dashboard:', e);
        res.status(500).json({ erro: 'Erro no dashboard.' });
    }
});

app.get('/api/grafico-vendas', autenticar, async (req, res) => {
    try {
        const params = [];
        let filtro = '';
        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            filtro = `AND parceiro_id = $${params.length}`;
        }

        const d = await db.query(
            `SELECT TO_CHAR(data_venda, 'DD/MM') AS dia, SUM(valor_total) AS total
             FROM vendas
             WHERE data_venda >= CURRENT_DATE - INTERVAL '7 days'
             ${filtro}
             GROUP BY dia
             ORDER BY MIN(data_venda) ASC`,
            params
        );
        res.json(d.rows);
    } catch (e) {
        res.status(500).json({ erro: 'Erro no gráfico.' });
    }
});

app.get('/api/movimentacoes', autenticar, async (req, res) => {
    try {
        const params = [];
        let where = '';
        if (req.user.perfil === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            where = `WHERE m.parceiro_id = $${params.length}`;
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            where = `WHERE m.parceiro_id = $${params.length}`;
        }

        const result = await db.query(
            `SELECT
                m.*,
                p.nome AS produto_nome,
                v.variacao,
                parc.nome_loja,
                u.nome AS usuario_nome
             FROM movimentacoes_estoque m
             LEFT JOIN produtos p ON p.id = m.produto_id
             LEFT JOIN produto_variacoes v ON v.id = m.variacao_id
             LEFT JOIN parceiros parc ON parc.id = m.parceiro_id
             LEFT JOIN usuarios u ON u.id = m.usuario_id
             ${where}
             ORDER BY m.data_hora DESC
             LIMIT 200`,
            params
        );
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro movimentações:', e);
        res.status(500).json({ erro: 'Erro ao buscar movimentações.' });
    }
});

app.get('/api/auditoria', autenticar, somenteAdmin, async (req, res) => {
    try {
        const logs = await db.query(
            `SELECT l.*, u.nome AS usuario_nome, u.usuario
             FROM logs_auditoria l
             LEFT JOIN usuarios u ON u.id = l.usuario_id
             ORDER BY l.data_hora DESC
             LIMIT 200`
        );
        res.json(logs.rows);
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao buscar auditoria.' });
    }
});


// =========================================================
// V5.0 - MULTI CATÁLOGO / SAAS
// =========================================================

app.get('/catalogo/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/catalogo-publico.html'));
});

function slugifyCatalogo(value) {
    return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 70) || `loja-${Date.now()}`;
}

async function garantirSlugCatalogo(parceiroId, nomeLoja) {
    const atual = await db.query('SELECT slug_catalogo FROM parceiros WHERE id = $1', [parceiroId]);
    if (atual.rows[0]?.slug_catalogo) return atual.rows[0].slug_catalogo;

    const base = slugifyCatalogo(nomeLoja || `loja-${parceiroId}`);
    let slug = base;
    let i = 1;

    while (true) {
        const existe = await db.query('SELECT id FROM parceiros WHERE slug_catalogo = $1 AND id <> $2', [slug, parceiroId]);
        if (existe.rows.length === 0) break;
        i += 1;
        slug = `${base}-${i}`;
    }

    await db.query('UPDATE parceiros SET slug_catalogo = $1 WHERE id = $2', [slug, parceiroId]);
    return slug;
}

function telefoneWhatsappLimpo(value) {
    return String(value || '').replace(/\D/g, '');
}


async function uploadCatalogoArquivo(file) {
    if (!file) return null;
    return await uploadImagemProduto(file);
}


function catalogoDefaultBanners(row = {}) {
    return {
        banner_desktop_1_url: row.banner_desktop_1_url || row.banner_desktop_url || row.banner_url || null,
        banner_desktop_2_url: row.banner_desktop_2_url || null,
        banner_desktop_3_url: row.banner_desktop_3_url || null,
        banner_tablet_1_url: row.banner_tablet_1_url || row.banner_tablet_url || row.banner_desktop_1_url || row.banner_desktop_url || row.banner_url || null,
        banner_tablet_2_url: row.banner_tablet_2_url || null,
        banner_tablet_3_url: row.banner_tablet_3_url || null,
        banner_mobile_1_url: row.banner_mobile_1_url || row.banner_mobile_url || row.banner_tablet_1_url || row.banner_tablet_url || row.banner_desktop_1_url || row.banner_desktop_url || row.banner_url || null,
        banner_mobile_2_url: row.banner_mobile_2_url || null,
        banner_mobile_3_url: row.banner_mobile_3_url || null
    };
}

function catalogoPublicPayload(row = {}, defaults = {}) {
    const banners = catalogoDefaultBanners(row);
    return {
        ...row,
        ...banners,
        cor_tema: row.cor_tema || defaults.cor_tema || '#2563eb',
        cor_titulo: row.cor_titulo || row.cor_tema || defaults.cor_titulo || defaults.cor_tema || '#2563eb',
        cor_preco: row.cor_preco || defaults.cor_preco || '#16a34a',
        cor_botao: row.cor_botao || row.cor_tema || defaults.cor_botao || defaults.cor_tema || '#2563eb',
        footer_contato: row.footer_contato || defaults.footer_contato || '',
        footer_localizacao: row.footer_localizacao || defaults.footer_localizacao || '',
        footer_pagamentos: row.footer_pagamentos || defaults.footer_pagamentos || 'Pix, dinheiro e cartão',
        footer_copyright: row.footer_copyright || defaults.footer_copyright || `© ${new Date().getFullYear()} ${row.nome_loja || defaults.nome_loja || 'PERSONALIZE'}`
    };
}

async function buscarConfigCatalogoAdmin(req) {
    try {
        const r = await db.query('SELECT * FROM catalogo_admin_config WHERE id = 1');
        if (r.rows.length) {
            const row = catalogoPublicPayload(r.rows[0], { nome_loja: 'PERSONALIZE', cor_tema: '#2563eb' });
            return {
                tipo: 'ADMIN',
                slug_catalogo: 'personalize',
                catalogo_ativo: true,
                nome_loja: row.nome_loja || 'PERSONALIZE',
                whatsapp_catalogo: row.whatsapp_catalogo || '',
                instagram_catalogo: row.instagram_catalogo || '',
                descricao_catalogo: row.descricao_catalogo || 'Catálogo oficial PERSONALIZE',
                logo_url: row.logo_url || null,
                ...catalogoDefaultBanners(row),
                banner_url: row.banner_desktop_1_url || row.banner_desktop_url || null,
                banner_desktop_url: row.banner_desktop_1_url || row.banner_desktop_url || null,
                banner_tablet_url: row.banner_tablet_1_url || row.banner_tablet_url || null,
                banner_mobile_url: row.banner_mobile_1_url || row.banner_mobile_url || null,
                cor_tema: row.cor_tema || '#2563eb',
                cor_titulo: row.cor_titulo || row.cor_tema || '#2563eb',
                cor_preco: row.cor_preco || '#16a34a',
                cor_botao: row.cor_botao || row.cor_tema || '#2563eb',
                footer_contato: row.footer_contato || '',
                footer_localizacao: row.footer_localizacao || '',
                footer_pagamentos: row.footer_pagamentos || 'Pix, dinheiro e cartão',
                footer_copyright: row.footer_copyright || `© ${new Date().getFullYear()} PERSONALIZE`,
                link_publico: `${req.protocol}://${req.get('host')}/catalogo/personalize`
            };
        }
    } catch (_) {}
    return {
        tipo: 'ADMIN', slug_catalogo: 'personalize', catalogo_ativo: true,
        nome_loja: 'PERSONALIZE', descricao_catalogo: 'Catálogo oficial PERSONALIZE',
        cor_tema: '#2563eb', cor_titulo: '#2563eb', cor_preco: '#16a34a', cor_botao: '#2563eb',
        footer_pagamentos: 'Pix, dinheiro e cartão', footer_copyright: `© ${new Date().getFullYear()} PERSONALIZE`,
        link_publico: `${req.protocol}://${req.get('host')}/catalogo/personalize`
    };
}

async function buscarConfigCatalogoParceiro(parceiroId) {
    const result = await db.query(
        `SELECT
            id, nome_loja, responsavel, telefone, status,
            slug_catalogo, catalogo_ativo, whatsapp_catalogo, instagram_catalogo,
            logo_url, banner_url, banner_desktop_url, banner_tablet_url, banner_mobile_url,
            banner_desktop_1_url, banner_desktop_2_url, banner_desktop_3_url,
            banner_tablet_1_url, banner_tablet_2_url, banner_tablet_3_url,
            banner_mobile_1_url, banner_mobile_2_url, banner_mobile_3_url,
            cor_tema, cor_titulo, cor_preco, cor_botao,
            descricao_catalogo, footer_contato, footer_localizacao, footer_pagamentos, footer_copyright,
            catalogo_teste_inicio, catalogo_teste_fim, catalogo_plano_status
         FROM parceiros
         WHERE id = $1`,
        [parceiroId]
    );
    if (!result.rows.length) return null;
    const row = catalogoPublicPayload(result.rows[0], {});
    row.slug_catalogo = row.slug_catalogo || await garantirSlugCatalogo(parceiroId, row.nome_loja);
    return row;
}
app.get('/api/catalogo-config', autenticar, async (req, res) => {
    try {
        if (normalizarPerfil(req.user.perfil) === 'ADMIN') {
            return res.json(await buscarConfigCatalogoAdmin(req));
        }

        const parceiroId = req.user.parceiro_id;
        if (!parceiroId) return res.status(400).json({ erro: 'Usuário parceiro sem loja vinculada.' });

        const cfg = await buscarConfigCatalogoParceiro(parceiroId);
        if (!cfg) return res.status(404).json({ erro: 'Loja não encontrada.' });

        res.json({
            ...cfg,
            link_publico: `${req.protocol}://${req.get('host')}/catalogo/${cfg.slug_catalogo}`
        });
    } catch (e) {
        console.error('❌ Erro config catálogo:', e);
        res.status(500).json({ erro: 'Erro ao buscar configuração do catálogo: ' + e.message });
    }
});


app.put('/api/catalogo-config', autenticar, upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
    { name: 'banner_desktop', maxCount: 1 },
    { name: 'banner_tablet', maxCount: 1 },
    { name: 'banner_mobile', maxCount: 1 },
    { name: 'banner_desktop_1', maxCount: 1 },
    { name: 'banner_desktop_2', maxCount: 1 },
    { name: 'banner_desktop_3', maxCount: 1 },
    { name: 'banner_tablet_1', maxCount: 1 },
    { name: 'banner_tablet_2', maxCount: 1 },
    { name: 'banner_tablet_3', maxCount: 1 },
    { name: 'banner_mobile_1', maxCount: 1 },
    { name: 'banner_mobile_2', maxCount: 1 },
    { name: 'banner_mobile_3', maxCount: 1 }
]), async (req, res) => {
    try {
        const perfil = normalizarPerfil(req.user.perfil);
        const files = req.files || {};
        const getUpload = async (name) => files[name]?.[0] ? await uploadCatalogoArquivo(files[name][0]) : null;
        const logoUrl = await getUpload('logo');
        const up = {
            banner_desktop_1_url: await getUpload('banner_desktop_1') || await getUpload('banner_desktop') || await getUpload('banner'),
            banner_desktop_2_url: await getUpload('banner_desktop_2'),
            banner_desktop_3_url: await getUpload('banner_desktop_3'),
            banner_tablet_1_url: await getUpload('banner_tablet_1') || await getUpload('banner_tablet'),
            banner_tablet_2_url: await getUpload('banner_tablet_2'),
            banner_tablet_3_url: await getUpload('banner_tablet_3'),
            banner_mobile_1_url: await getUpload('banner_mobile_1') || await getUpload('banner_mobile'),
            banner_mobile_2_url: await getUpload('banner_mobile_2'),
            banner_mobile_3_url: await getUpload('banner_mobile_3')
        };
        const remove = (name) => String(req.body[`remover_${name}`] || '').toLowerCase() === 'true';
        const resetar = String(req.body.resetar || '').toLowerCase() === 'true';
        const bodyVal = (name) => req.body[name] === undefined ? null : req.body[name];

        if (perfil === 'ADMIN') {
            await db.query(`INSERT INTO catalogo_admin_config (id, nome_loja, atualizado_em) VALUES (1, 'PERSONALIZE', CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING`);
            await db.query(`
                UPDATE catalogo_admin_config SET
                    whatsapp_catalogo = COALESCE($1, whatsapp_catalogo),
                    instagram_catalogo = COALESCE($2, instagram_catalogo),
                    descricao_catalogo = COALESCE($3, descricao_catalogo),
                    cor_tema = COALESCE($4, cor_tema),
                    cor_titulo = COALESCE($5, cor_titulo),
                    cor_preco = COALESCE($6, cor_preco),
                    cor_botao = COALESCE($7, cor_botao),
                    footer_contato = COALESCE($8, footer_contato),
                    footer_localizacao = COALESCE($9, footer_localizacao),
                    footer_pagamentos = COALESCE($10, footer_pagamentos),
                    footer_copyright = COALESCE($11, footer_copyright),
                    logo_url = CASE WHEN $12::boolean OR $13::boolean THEN NULL ELSE COALESCE($14, logo_url) END,
                    banner_desktop_1_url = CASE WHEN $12::boolean OR $15::boolean THEN NULL ELSE COALESCE($16, banner_desktop_1_url) END,
                    banner_desktop_2_url = CASE WHEN $12::boolean OR $17::boolean THEN NULL ELSE COALESCE($18, banner_desktop_2_url) END,
                    banner_desktop_3_url = CASE WHEN $12::boolean OR $19::boolean THEN NULL ELSE COALESCE($20, banner_desktop_3_url) END,
                    banner_tablet_1_url = CASE WHEN $12::boolean OR $21::boolean THEN NULL ELSE COALESCE($22, banner_tablet_1_url) END,
                    banner_tablet_2_url = CASE WHEN $12::boolean OR $23::boolean THEN NULL ELSE COALESCE($24, banner_tablet_2_url) END,
                    banner_tablet_3_url = CASE WHEN $12::boolean OR $25::boolean THEN NULL ELSE COALESCE($26, banner_tablet_3_url) END,
                    banner_mobile_1_url = CASE WHEN $12::boolean OR $27::boolean THEN NULL ELSE COALESCE($28, banner_mobile_1_url) END,
                    banner_mobile_2_url = CASE WHEN $12::boolean OR $29::boolean THEN NULL ELSE COALESCE($30, banner_mobile_2_url) END,
                    banner_mobile_3_url = CASE WHEN $12::boolean OR $31::boolean THEN NULL ELSE COALESCE($32, banner_mobile_3_url) END,
                    banner_desktop_url = CASE WHEN $12::boolean OR $15::boolean THEN NULL ELSE COALESCE($16, banner_desktop_url) END,
                    banner_tablet_url = CASE WHEN $12::boolean OR $21::boolean THEN NULL ELSE COALESCE($22, banner_tablet_url) END,
                    banner_mobile_url = CASE WHEN $12::boolean OR $27::boolean THEN NULL ELSE COALESCE($28, banner_mobile_url) END,
                    atualizado_em = CURRENT_TIMESTAMP
                WHERE id = 1`, [
                    bodyVal('whatsapp_catalogo'), bodyVal('instagram_catalogo'), bodyVal('descricao_catalogo'), bodyVal('cor_tema'),
                    bodyVal('cor_titulo'), bodyVal('cor_preco'), bodyVal('cor_botao'),
                    bodyVal('footer_contato'), bodyVal('footer_localizacao'), bodyVal('footer_pagamentos'), bodyVal('footer_copyright'),
                    resetar, remove('logo'), logoUrl,
                    remove('banner_desktop_1'), up.banner_desktop_1_url, remove('banner_desktop_2'), up.banner_desktop_2_url, remove('banner_desktop_3'), up.banner_desktop_3_url,
                    remove('banner_tablet_1'), up.banner_tablet_1_url, remove('banner_tablet_2'), up.banner_tablet_2_url, remove('banner_tablet_3'), up.banner_tablet_3_url,
                    remove('banner_mobile_1'), up.banner_mobile_1_url, remove('banner_mobile_2'), up.banner_mobile_2_url, remove('banner_mobile_3'), up.banner_mobile_3_url
                ]);
            return res.json({ mensagem: resetar ? 'Catálogo oficial resetado.' : 'Catálogo oficial atualizado.', slug_catalogo: 'personalize' });
        }

        if (perfil !== 'PARCEIRO') return res.status(403).json({ erro: 'Perfil sem permissão para editar catálogo.' });
        const parceiroId = req.user.parceiro_id;
        if (!parceiroId) return res.status(400).json({ erro: 'Usuário parceiro sem loja vinculada.' });
        const atual = await db.query('SELECT nome_loja FROM parceiros WHERE id = $1', [parceiroId]);
        if (!atual.rows.length) return res.status(404).json({ erro: 'Loja não encontrada.' });
        const slug = slugifyCatalogo(req.body.slug_catalogo || atual.rows[0].nome_loja);
        const existeSlug = await db.query('SELECT id FROM parceiros WHERE slug_catalogo = $1 AND id <> $2', [slug, parceiroId]);
        if (existeSlug.rows.length) return res.status(400).json({ erro: 'Este link de catálogo já está em uso.' });

        await db.query(
            `UPDATE parceiros SET
                 slug_catalogo = $1,
                 whatsapp_catalogo = COALESCE($2, whatsapp_catalogo),
                 instagram_catalogo = COALESCE($3, instagram_catalogo),
                 descricao_catalogo = COALESCE($4, descricao_catalogo),
                 cor_tema = COALESCE($5, cor_tema),
                 cor_titulo = COALESCE($6, cor_titulo),
                 cor_preco = COALESCE($7, cor_preco),
                 cor_botao = COALESCE($8, cor_botao),
                 footer_contato = COALESCE($9, footer_contato),
                 footer_localizacao = COALESCE($10, footer_localizacao),
                 footer_pagamentos = COALESCE($11, footer_pagamentos),
                 footer_copyright = COALESCE($12, footer_copyright),
                 logo_url = CASE WHEN $13::boolean OR $14::boolean THEN NULL ELSE COALESCE($15, logo_url) END,
                 banner_url = CASE WHEN $13::boolean OR $16::boolean THEN NULL ELSE COALESCE($17, banner_url) END,
                 banner_desktop_url = CASE WHEN $13::boolean OR $16::boolean THEN NULL ELSE COALESCE($17, banner_desktop_url) END,
                 banner_desktop_1_url = CASE WHEN $13::boolean OR $16::boolean THEN NULL ELSE COALESCE($17, banner_desktop_1_url) END,
                 banner_desktop_2_url = CASE WHEN $13::boolean OR $18::boolean THEN NULL ELSE COALESCE($19, banner_desktop_2_url) END,
                 banner_desktop_3_url = CASE WHEN $13::boolean OR $20::boolean THEN NULL ELSE COALESCE($21, banner_desktop_3_url) END,
                 banner_tablet_url = CASE WHEN $13::boolean OR $22::boolean THEN NULL ELSE COALESCE($23, banner_tablet_url) END,
                 banner_tablet_1_url = CASE WHEN $13::boolean OR $22::boolean THEN NULL ELSE COALESCE($23, banner_tablet_1_url) END,
                 banner_tablet_2_url = CASE WHEN $13::boolean OR $24::boolean THEN NULL ELSE COALESCE($25, banner_tablet_2_url) END,
                 banner_tablet_3_url = CASE WHEN $13::boolean OR $26::boolean THEN NULL ELSE COALESCE($27, banner_tablet_3_url) END,
                 banner_mobile_url = CASE WHEN $13::boolean OR $28::boolean THEN NULL ELSE COALESCE($29, banner_mobile_url) END,
                 banner_mobile_1_url = CASE WHEN $13::boolean OR $28::boolean THEN NULL ELSE COALESCE($29, banner_mobile_1_url) END,
                 banner_mobile_2_url = CASE WHEN $13::boolean OR $30::boolean THEN NULL ELSE COALESCE($31, banner_mobile_2_url) END,
                 banner_mobile_3_url = CASE WHEN $13::boolean OR $32::boolean THEN NULL ELSE COALESCE($33, banner_mobile_3_url) END,
                 catalogo_ativo = COALESCE($34, catalogo_ativo)
             WHERE id = $35`,
            [
                slug, bodyVal('whatsapp_catalogo'), bodyVal('instagram_catalogo'), bodyVal('descricao_catalogo'), bodyVal('cor_tema'),
                bodyVal('cor_titulo'), bodyVal('cor_preco'), bodyVal('cor_botao'), bodyVal('footer_contato'), bodyVal('footer_localizacao'), bodyVal('footer_pagamentos'), bodyVal('footer_copyright'),
                resetar, remove('logo'), logoUrl,
                remove('banner_desktop_1'), up.banner_desktop_1_url, remove('banner_desktop_2'), up.banner_desktop_2_url, remove('banner_desktop_3'), up.banner_desktop_3_url,
                remove('banner_tablet_1'), up.banner_tablet_1_url, remove('banner_tablet_2'), up.banner_tablet_2_url, remove('banner_tablet_3'), up.banner_tablet_3_url,
                remove('banner_mobile_1'), up.banner_mobile_1_url, remove('banner_mobile_2'), up.banner_mobile_2_url, remove('banner_mobile_3'), up.banner_mobile_3_url,
                req.body.catalogo_ativo === undefined ? null : String(req.body.catalogo_ativo) === 'true', parceiroId
            ]
        );
        await registrarAuditoria(req.user.id, resetar ? `Resetou configuração do catálogo da loja ${parceiroId}` : `Atualizou configuração do catálogo da loja ${parceiroId}`);
        res.json({ mensagem: resetar ? 'Catálogo resetado.' : 'Catálogo atualizado com sucesso.', slug_catalogo: slug });
    } catch (e) {
        console.error('❌ Erro editar catálogo:', e);
        res.status(500).json({ erro: 'Erro ao atualizar catálogo: ' + e.message });
    }
});
app.get('/api/meus-produtos', autenticar, async (req, res) => {
    try {
        if (normalizarPerfil(req.user.perfil) !== 'PARCEIRO') {
            return res.status(403).json({ erro: 'Acesso permitido somente para loja parceira.' });
        }

        const parceiroId = req.user.parceiro_id;
        const result = await db.query(
            `SELECT
                p.id, p.nome, p.descricao, p.categoria, p.status,
                p.dono_tipo, p.parceiro_id, p.produto_global, p.visivel_catalogo,
                COALESCE(
                    (SELECT pi.imagem_url FROM produto_imagens pi WHERE pi.produto_id = p.id ORDER BY pi.principal DESC, pi.ordem ASC, pi.id ASC LIMIT 1),
                    p.imagem_url
                ) AS imagem_url,
                COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object('url', pi.imagem_url, 'imagem_url', pi.imagem_url, 'ordem', pi.ordem, 'principal', pi.principal) ORDER BY pi.ordem, pi.id)
                     FROM produto_imagens pi WHERE pi.produto_id = p.id),
                    '[]'::jsonb
                ) AS galeria,
                v.id AS variacao_id, v.sku, v.variacao, v.preco_venda, v.preco_repasse, v.preco_catalogo, v.custo_producao, v.estoque_central
             FROM produtos p
             JOIN produto_variacoes v ON v.produto_id = p.id
             WHERE p.parceiro_id = $1 AND COALESCE(p.dono_tipo, 'ADMIN') = 'PARCEIRO'
             ORDER BY p.id DESC`,
            [parceiroId]
        );
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro meus produtos:', e);
        res.status(500).json({ erro: 'Erro ao buscar seus produtos: ' + e.message });
    }
});

app.post('/api/meus-produtos', autenticar, upload.fields([{ name: 'imagem', maxCount: 1 }, { name: 'imagens', maxCount: 10 }]), async (req, res) => {
    try {
        if (normalizarPerfil(req.user.perfil) !== 'PARCEIRO') {
            return res.status(403).json({ erro: 'Somente loja parceira pode cadastrar produto próprio.' });
        }

        const parceiroId = req.user.parceiro_id;
        if (!parceiroId) return res.status(400).json({ erro: 'Usuário parceiro sem loja vinculada.' });

        const { nome, categoria, descricao, variacao, sku, preco_venda, estoque, status, visivel_catalogo } = req.body;
        if (!nome) return res.status(400).json({ erro: 'Nome do produto é obrigatório.' });

        const imagensUrls = await uploadImagensProduto(arquivosProduto(req));
        const imagem_url = imagensUrls[0] || null;
        const precoVenda = parseMoeda(preco_venda);
        const qtdEstoque = toInt(estoque, 0);

        let produtoId;
        await transacao(async (client) => {
            const prod = await client.query(
                `INSERT INTO produtos (
                    nome, categoria, descricao, imagem_url, status,
                    dono_tipo, parceiro_id, produto_global, visivel_catalogo, origem_produto
                 ) VALUES ($1,$2,$3,$4,$5,'PARCEIRO',$6,false,$7,'LOJA')
                 RETURNING id`,
                [nome, categoria || 'Produtos da Loja', descricao || '', imagem_url, status || 'ATIVO', parceiroId, String(visivel_catalogo ?? 'true') !== 'false']
            );
            produtoId = prod.rows[0].id;

            const skuFinal = normalizarSku(sku) || gerarSkuAutomatico(nome, categoria || 'LOJA', produtoId);
            await client.query(
                `INSERT INTO produto_variacoes (produto_id, sku, variacao, preco_venda, preco_repasse, preco_catalogo, custo_producao, estoque_central)
                 VALUES ($1,$2,$3,$4,0,$4,0,$5)`,
                [produtoId, skuFinal, variacao || 'Único', precoVenda, qtdEstoque]
            );

            if (imagensUrls.length) await salvarGaleriaProduto(client, produtoId, imagensUrls);
        });

        res.status(201).json({ mensagem: 'Produto da loja cadastrado com sucesso.', id: produtoId });
    } catch (e) {
        console.error('❌ Erro cadastrar produto da loja:', e);
        res.status(500).json({ erro: 'Erro ao cadastrar produto da loja: ' + e.message });
    }
});

app.put('/api/meus-produtos/:id', autenticar, upload.fields([{ name: 'imagem', maxCount: 1 }, { name: 'imagens', maxCount: 10 }]), async (req, res) => {
    try {
        if (normalizarPerfil(req.user.perfil) !== 'PARCEIRO') return res.status(403).json({ erro: 'Somente loja parceira.' });
        const parceiroId = req.user.parceiro_id;
        const id = req.params.id;

        const pertence = await db.query('SELECT id FROM produtos WHERE id = $1 AND parceiro_id = $2 AND dono_tipo = $3', [id, parceiroId, 'PARCEIRO']);
        if (!pertence.rows.length) return res.status(404).json({ erro: 'Produto não encontrado no catálogo da sua loja.' });

        const imagensUrls = await uploadImagensProduto(arquivosProduto(req));
        const imagem_url = imagensUrls[0] || null;

        await transacao(async (client) => {
            await client.query(
                `UPDATE produtos
                 SET nome = COALESCE($1, nome),
                     categoria = COALESCE($2, categoria),
                     descricao = COALESCE($3, descricao),
                     status = COALESCE($4, status),
                     visivel_catalogo = COALESCE($5, visivel_catalogo),
                     imagem_url = COALESCE($6, imagem_url)
                 WHERE id = $7 AND parceiro_id = $8`,
                [
                    req.body.nome || null,
                    req.body.categoria || null,
                    req.body.descricao || null,
                    req.body.status || null,
                    req.body.visivel_catalogo === undefined ? null : String(req.body.visivel_catalogo) === 'true',
                    imagem_url,
                    id,
                    parceiroId
                ]
            );

            await client.query(
                `UPDATE produto_variacoes
                 SET sku = COALESCE($1, sku),
                     variacao = COALESCE($2, variacao),
                     preco_venda = COALESCE($3, preco_venda),
                     preco_catalogo = COALESCE($3, preco_catalogo),
                     estoque_central = COALESCE($4, estoque_central)
                 WHERE produto_id = $5`,
                [
                    req.body.sku !== undefined && req.body.sku !== '' ? normalizarSku(req.body.sku) : null,
                    req.body.variacao || null,
                    req.body.preco_venda !== undefined && req.body.preco_venda !== '' ? parseMoeda(req.body.preco_venda) : null,
                    req.body.estoque !== undefined && req.body.estoque !== '' ? toInt(req.body.estoque, 0) : null,
                    id
                ]
            );

            if (imagensUrls.length) await salvarGaleriaProduto(client, id, imagensUrls);
        });

        res.json({ mensagem: 'Produto da loja atualizado.' });
    } catch (e) {
        console.error('❌ Erro editar produto da loja:', e);
        res.status(500).json({ erro: 'Erro ao atualizar produto da loja: ' + e.message });
    }
});

app.delete('/api/meus-produtos/:id', autenticar, async (req, res) => {
    try {
        if (normalizarPerfil(req.user.perfil) !== 'PARCEIRO') return res.status(403).json({ erro: 'Somente loja parceira.' });
        const parceiroId = req.user.parceiro_id;
        const id = req.params.id;
        const result = await db.query(`
            UPDATE produtos
            SET status = 'LIXEIRA', visivel_catalogo = false, excluido_em = CURRENT_TIMESTAMP, excluir_permanente_em = CURRENT_TIMESTAMP + INTERVAL '60 days'
            WHERE id = $1 AND parceiro_id = $2 AND dono_tipo = 'PARCEIRO'
            RETURNING id`, [id, parceiroId]);
        if (!result.rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
        await registrarAuditoria(req.user.id, `Moveu produto próprio ${id} para lixeira por 60 dias`);
        res.json({ mensagem: 'Produto enviado para a lixeira por 60 dias.' });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao remover produto: ' + e.message });
    }
});

app.patch('/api/meus-produtos/:id/restaurar', autenticar, async (req, res) => {
    try {
        if (normalizarPerfil(req.user.perfil) !== 'PARCEIRO') return res.status(403).json({ erro: 'Somente loja parceira.' });
        const result = await db.query(`
            UPDATE produtos
            SET status = 'ATIVO', visivel_catalogo = true, excluido_em = NULL, excluir_permanente_em = NULL
            WHERE id = $1 AND parceiro_id = $2 AND dono_tipo = 'PARCEIRO'
            RETURNING id`, [req.params.id, req.user.parceiro_id]);
        if (!result.rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
        await registrarAuditoria(req.user.id, `Restaurou produto próprio ${req.params.id}`);
        res.json({ mensagem: 'Produto restaurado.' });
    } catch (e) { res.status(500).json({ erro: 'Erro ao restaurar produto: ' + e.message }); }
});

app.delete('/api/meus-produtos/:id/permanente', autenticar, async (req, res) => {
    try {
        if (normalizarPerfil(req.user.perfil) !== 'PARCEIRO') return res.status(403).json({ erro: 'Somente loja parceira.' });
        const result = await db.query(`DELETE FROM produtos WHERE id = $1 AND parceiro_id = $2 AND dono_tipo = 'PARCEIRO' AND status = 'LIXEIRA' RETURNING id`, [req.params.id, req.user.parceiro_id]);
        if (!result.rows.length) return res.status(404).json({ erro: 'Produto não encontrado na lixeira.' });
        await registrarAuditoria(req.user.id, `Excluiu permanentemente produto próprio ${req.params.id}`);
        res.json({ mensagem: 'Produto excluído permanentemente.' });
    } catch (e) { res.status(500).json({ erro: 'Erro ao excluir permanentemente: ' + e.message }); }
});


app.get('/api/catalogo-publico/:slug', async (req, res) => {
    try {
        const slug = slugifyCatalogo(req.params.slug);
        let loja = null;
        let parceiroId = null;
        let isAdminCatalogo = slug === 'personalize' || slug === 'admin';

        if (isAdminCatalogo) {
            loja = await buscarConfigCatalogoAdmin(req);
        } else {
            const lojaRes = await db.query(
                `SELECT id, nome_loja, responsavel, telefone, status, slug_catalogo, catalogo_ativo,
                        whatsapp_catalogo, instagram_catalogo, logo_url, banner_url, banner_desktop_url,
                        banner_tablet_url, banner_mobile_url,
                        banner_desktop_1_url, banner_desktop_2_url, banner_desktop_3_url,
                        banner_tablet_1_url, banner_tablet_2_url, banner_tablet_3_url,
                        banner_mobile_1_url, banner_mobile_2_url, banner_mobile_3_url,
                        cor_tema, cor_titulo, cor_preco, cor_botao,
                        descricao_catalogo, footer_contato, footer_localizacao, footer_pagamentos, footer_copyright,
                        catalogo_teste_inicio, catalogo_teste_fim, catalogo_plano_status
                 FROM parceiros
                 WHERE slug_catalogo = $1`,
                [slug]
            );
            if (!lojaRes.rows.length) return res.status(404).json({ erro: 'Catálogo não encontrado.' });
            loja = catalogoPublicPayload(lojaRes.rows[0], {});
            parceiroId = loja.id;
            const assinaturaLoja = await db.query('SELECT status, fim_teste, proxima_cobranca FROM assinaturas_catalogo WHERE parceiro_id = $1 ORDER BY id DESC LIMIT 1', [parceiroId]).catch(() => ({ rows: [] }));
            const stAss = String(assinaturaLoja.rows[0]?.status || loja.catalogo_plano_status || 'TESTE_GRATIS').toUpperCase();
            if (loja.catalogo_ativo === false || ['BLOQUEADA','CANCELADA'].includes(stAss)) return res.status(403).json({ erro: 'Catálogo indisponível no momento.' });
        }

        const params = [];
        let where;
        if (isAdminCatalogo) {
            where = `COALESCE(p.dono_tipo, 'ADMIN') = 'ADMIN' AND COALESCE(p.produto_global, true) = true`;
        } else {
            params.push(parceiroId);
            where = `(
                (COALESCE(p.dono_tipo, 'ADMIN') = 'ADMIN' AND COALESCE(p.produto_global, true) = true)
                OR
                (p.dono_tipo = 'PARCEIRO' AND p.parceiro_id = $1)
            )`;
        }

        const produtos = await db.query(
            `SELECT
                p.id, p.nome, p.descricao, p.categoria, p.dono_tipo, p.parceiro_id, p.origem_produto,
                COALESCE((imgs.imagens->>0), p.imagem_url) AS imagem_url,
                COALESCE(imgs.imagens, '[]'::json) AS imagens,
                v.id AS variacao_id, v.variacao,
                CASE
                    WHEN p.dono_tipo = 'PARCEIRO' THEN v.preco_venda
                    ELSE COALESCE(v.preco_catalogo, v.preco_venda)
                END AS preco_publico,
                CASE WHEN p.dono_tipo = 'PARCEIRO' THEN 'LOJA' ELSE 'PERSONALIZE' END AS origem_publica
             FROM produtos p
             JOIN produto_variacoes v ON v.produto_id = p.id
             LEFT JOIN LATERAL (
                SELECT json_agg(pi.imagem_url ORDER BY pi.principal DESC, pi.ordem ASC, pi.id ASC) AS imagens
                FROM produto_imagens pi
                WHERE pi.produto_id = p.id
             ) imgs ON true
             WHERE ${where}
               AND COALESCE(p.status, 'ATIVO') = 'ATIVO'
               AND COALESCE(p.visivel_catalogo, true) = true
               AND COALESCE(p.aprovado_admin, true) = true
             ORDER BY CASE WHEN COALESCE(p.dono_tipo, 'ADMIN') = 'ADMIN' THEN 0 ELSE 1 END, p.nome ASC`,
            params
        );

        res.json({ loja, tipo_catalogo: isAdminCatalogo ? 'ADMIN' : 'PARCEIRO', produtos: produtos.rows });
    } catch (e) {
        console.error('❌ Erro catálogo público:', e);
        res.status(500).json({ erro: 'Erro ao carregar catálogo: ' + e.message });
    }
});

app.post('/api/catalogo-publico/:slug/leads', async (req, res) => {
    const client = await db.connect();
    try {
        const slug = slugifyCatalogo(req.params.slug);
        const isAdminCatalogo = slug === 'personalize' || slug === 'admin';
        let parceiroId = null;
        let loja = null;
        if (!isAdminCatalogo) {
            const lojaRes = await client.query('SELECT id, nome_loja, whatsapp_catalogo, telefone FROM parceiros WHERE slug_catalogo = $1', [slug]);
            if (!lojaRes.rows.length) return res.status(404).json({ erro: 'Catálogo não encontrado.' });
            loja = lojaRes.rows[0];
            parceiroId = loja.id;
        } else {
            const adm = await buscarConfigCatalogoAdmin(req);
            loja = adm;
        }
        const itens = Array.isArray(req.body.itens) && req.body.itens.length ? req.body.itens : [{ produto_id: req.body.produto_id, variacao_id: req.body.variacao_id, quantidade: req.body.quantidade }];
        if (!itens.length) return res.status(400).json({ erro: 'Nenhum item informado.' });
        const codigo = `LEAD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-5)}`;
        await client.query('BEGIN');
        let subtotal = 0;
        const snapshots = [];
        for (const item of itens) {
            const produtoId = toInt(item.produto_id, 0);
            const variacaoId = item.variacao_id ? toInt(item.variacao_id, 0) : null;
            const produto = await client.query(
                `SELECT p.id, p.nome, p.dono_tipo, p.parceiro_id, v.id AS variacao_id, v.variacao,
                        CASE WHEN p.dono_tipo = 'PARCEIRO' THEN v.preco_venda ELSE COALESCE(v.preco_catalogo, v.preco_venda) END AS preco_publico
                 FROM produtos p
                 JOIN produto_variacoes v ON v.produto_id = p.id
                 WHERE p.id = $1 AND ($2::integer IS NULL OR v.id = $2)
                 LIMIT 1`,
                [produtoId, variacaoId]
            );
            if (!produto.rows.length) throw new Error('Produto não encontrado.');
            const p = produto.rows[0];
            const quantidade = Math.max(1, toInt(item.quantidade, 1));
            const valor = parseMoeda(p.preco_publico);
            subtotal += valor * quantidade;
            snapshots.push({ ...p, quantidade, valor });
        }
        const primeiro = snapshots[0];
        const resumo = snapshots.map(i => `${i.quantidade}x ${i.nome}${i.variacao ? ' - ' + i.variacao : ''}`).join(' | ');
        const pedido = await client.query(
            `INSERT INTO catalogo_pedidos (
                codigo, parceiro_id, produto_id, variacao_id, origem_produto,
                cliente_nome, cliente_whatsapp, cliente_email, quantidade, observacao,
                produto_nome_snapshot, variacao_snapshot, valor_unitario_snapshot, status, subtotal, total_itens
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'NOVO',$14,$15) RETURNING *`,
            [codigo, parceiroId, primeiro.id, primeiro.variacao_id, primeiro.dono_tipo === 'PARCEIRO' ? 'LOJA' : 'PERSONALIZE',
             req.body.cliente_nome || '', telefoneWhatsappLimpo(req.body.cliente_whatsapp || ''), req.body.cliente_email || '',
             snapshots.reduce((s, i) => s + i.quantidade, 0), `${req.body.observacao || ''}\n\nItens: ${resumo}`.trim(),
             snapshots.length > 1 ? 'Pedido com múltiplos itens' : primeiro.nome, snapshots.length > 1 ? resumo : primeiro.variacao,
             snapshots.length > 1 ? subtotal : primeiro.valor, subtotal, snapshots.length]
        );
        for (const item of snapshots) {
            await client.query(
                `INSERT INTO catalogo_pedido_itens (
                    pedido_id, produto_id, variacao_id, origem_produto, produto_nome_snapshot, variacao_snapshot,
                    quantidade, valor_unitario_snapshot, valor_total_snapshot
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [pedido.rows[0].id, item.id, item.variacao_id, item.dono_tipo === 'PARCEIRO' ? 'LOJA' : 'PERSONALIZE', item.nome, item.variacao, item.quantidade, item.valor, item.valor * item.quantidade]
            );
        }
        await client.query('COMMIT');
        res.status(201).json({ mensagem: 'Pedido enviado com sucesso.', lead: pedido.rows[0], itens: snapshots, whatsapp_destino: loja ? telefoneWhatsappLimpo(loja.whatsapp_catalogo || loja.telefone) : '' });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ Erro salvar lead catálogo:', e);
        res.status(500).json({ erro: 'Erro ao enviar pedido: ' + e.message });
    } finally { client.release(); }
});

app.post('/api/catalogo-publico/:slug/footer-leads', async (req, res) => {
    try {
        const slug = slugifyCatalogo(req.params.slug);
        const isAdminCatalogo = slug === 'personalize' || slug === 'admin';
        let parceiroId = null;
        let loja = null;
        if (!isAdminCatalogo) {
            const lojaRes = await db.query('SELECT id, nome_loja, whatsapp_catalogo, telefone FROM parceiros WHERE slug_catalogo = $1', [slug]);
            if (!lojaRes.rows.length) return res.status(404).json({ erro: 'Catálogo não encontrado.' });
            loja = lojaRes.rows[0];
            parceiroId = loja.id;
        } else {
            loja = await buscarConfigCatalogoAdmin(req);
        }

        const clienteNome = String(req.body.cliente_nome || '').trim();
        const clienteWhats = telefoneWhatsappLimpo(req.body.cliente_whatsapp || '');
        const clienteEmail = String(req.body.cliente_email || '').trim();
        const observacao = String(req.body.observacao || '').trim();
        if (!clienteNome || !clienteWhats) return res.status(400).json({ erro: 'Informe nome e WhatsApp.' });

        const codigo = `FOOTER-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-5)}`;
        const result = await db.query(
            `INSERT INTO catalogo_pedidos (
                codigo, parceiro_id, origem_produto, cliente_nome, cliente_whatsapp, cliente_email,
                quantidade, observacao, produto_nome_snapshot, variacao_snapshot,
                valor_unitario_snapshot, status, subtotal, total_itens, lead_origem, assunto_lead
             ) VALUES ($1,$2,'FOOTER',$3,$4,$5,1,$6,'Contato pelo footer','Lead de contato',0,'NOVO',0,0,'FOOTER',$7)
             RETURNING *`,
            [codigo, parceiroId, clienteNome, clienteWhats, clienteEmail, observacao, 'Contato pelo footer']
        );

        res.status(201).json({
            mensagem: 'Lead de contato enviado com sucesso.',
            lead: result.rows[0],
            whatsapp_destino: loja ? telefoneWhatsappLimpo(loja.whatsapp_catalogo || loja.telefone || loja.footer_contato || '') : ''
        });
    } catch (e) {
        console.error('❌ Erro salvar lead footer:', e);
        res.status(500).json({ erro: 'Erro ao enviar contato do footer: ' + e.message });
    }
});

app.post('/api/catalogo-publico/:slug/cotacoes', upload.single('arquivo'), async (req, res) => {
    try {
        const slug = slugifyCatalogo(req.params.slug);
        const isAdminCatalogo = slug === 'personalize' || slug === 'admin';
        let parceiroId = null;
        let loja = null;
        if (!isAdminCatalogo) {
            const lojaRes = await db.query('SELECT id, nome_loja, whatsapp_catalogo, telefone FROM parceiros WHERE slug_catalogo = $1', [slug]);
            if (!lojaRes.rows.length) return res.status(404).json({ erro: 'Catálogo não encontrado.' });
            loja = lojaRes.rows[0];
            parceiroId = loja.id;
        }
        const imagemUrl = req.file ? await uploadCatalogoArquivo(req.file) : null;
        const codigo = `COT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-5)}`;
        await db.query(
            `INSERT INTO cotacoes_produto (codigo, parceiro_id, titulo, descricao, quantidade_desejada, imagem_url, status, status_fluxo, canal, criado_em)
             VALUES ($1,$2,$3,$4,$5,$6,'ABERTA','ABERTA','CATALOGO_PUBLICO',CURRENT_TIMESTAMP)`,
            [codigo, parceiroId, req.body.titulo || 'Produto personalizado', req.body.descricao || '', toInt(req.body.quantidade_desejada, 1), imagemUrl]
        );
        res.status(201).json({ mensagem: 'Cotação enviada com sucesso.', codigo, whatsapp_destino: loja ? telefoneWhatsappLimpo(loja.whatsapp_catalogo || loja.telefone) : '' });
    } catch (e) {
        console.error('❌ Erro cotação catálogo:', e);
        res.status(500).json({ erro: 'Erro ao enviar cotação: ' + e.message });
    }
});


app.get('/api/catalogo-pedidos', autenticar, async (req, res) => {
    try {
        const params = [];
        let where = '';
        if (normalizarPerfil(req.user.perfil) === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            where = 'WHERE cp.parceiro_id = $1';
        } else if (req.query.parceiro_id) {
            params.push(req.query.parceiro_id);
            where = 'WHERE cp.parceiro_id = $1';
        }

        const result = await db.query(
            `SELECT cp.*, parc.nome_loja,
                    COALESCE(json_agg(json_build_object(
                        'id', cpi.id,
                        'produto_id', cpi.produto_id,
                        'variacao_id', cpi.variacao_id,
                        'produto_nome', cpi.produto_nome_snapshot,
                        'variacao', cpi.variacao_snapshot,
                        'quantidade', cpi.quantidade,
                        'valor_unitario', cpi.valor_unitario_snapshot,
                        'valor_total', cpi.valor_total_snapshot,
                        'origem_produto', cpi.origem_produto
                    ) ORDER BY cpi.id) FILTER (WHERE cpi.id IS NOT NULL), '[]') AS itens
             FROM catalogo_pedidos cp
             LEFT JOIN parceiros parc ON parc.id = cp.parceiro_id
             LEFT JOIN catalogo_pedido_itens cpi ON cpi.pedido_id = cp.id
             ${where}
             GROUP BY cp.id, parc.nome_loja
             ORDER BY cp.criado_em DESC
             LIMIT 300`,
            params
        );
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro listar pedidos catálogo:', e);
        res.status(500).json({ erro: 'Erro ao listar leads/pedidos: ' + e.message });
    }
});
app.patch('/api/catalogo-pedidos/:id/status', autenticar, async (req, res) => {
    try {
        const id = req.params.id;
        const status = String(req.body.status || 'EM_ATENDIMENTO').toUpperCase();
        const params = [status, id];
        let where = 'id = $2';

        if (normalizarPerfil(req.user.perfil) === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            where += ' AND parceiro_id = $3';
        }

        const result = await db.query(
            `UPDATE catalogo_pedidos SET status = $1, atualizado_em = CURRENT_TIMESTAMP WHERE ${where} RETURNING *`,
            params
        );

        if (!result.rows.length) return res.status(404).json({ erro: 'Lead/pedido não encontrado.' });
        res.json({ mensagem: 'Status atualizado.', pedido: result.rows[0] });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao atualizar pedido: ' + e.message });
    }
});

app.get('/api/dashboard/crescimento', autenticar, somenteAdmin, async (req, res) => {
    try {
        const vendas = await db.query(
            `SELECT TO_CHAR(data_venda, 'MM/YYYY') AS mes, COALESCE(SUM(valor_total),0) AS total, COUNT(*) AS qtd
             FROM vendas
             WHERE data_venda >= CURRENT_DATE - INTERVAL '6 months'
             GROUP BY TO_CHAR(data_venda, 'MM/YYYY'), DATE_TRUNC('month', data_venda)
             ORDER BY DATE_TRUNC('month', data_venda)`
        );

        const parceiros = await db.query(
            `SELECT TO_CHAR(criado_em, 'MM/YYYY') AS mes, COUNT(*) AS total
             FROM parceiros
             WHERE criado_em >= CURRENT_DATE - INTERVAL '6 months'
             GROUP BY TO_CHAR(criado_em, 'MM/YYYY'), DATE_TRUNC('month', criado_em)
             ORDER BY DATE_TRUNC('month', criado_em)`
        );

        const leads = await db.query(
            `SELECT TO_CHAR(criado_em, 'MM/YYYY') AS mes, COUNT(*) AS total
             FROM catalogo_pedidos
             WHERE criado_em >= CURRENT_DATE - INTERVAL '6 months'
             GROUP BY TO_CHAR(criado_em, 'MM/YYYY'), DATE_TRUNC('month', criado_em)
             ORDER BY DATE_TRUNC('month', criado_em)`
        ).catch(() => ({ rows: [] }));

        res.json({ vendas: vendas.rows, parceiros: parceiros.rows, leads: leads.rows });
    } catch (e) {
        console.error('❌ Erro crescimento dashboard:', e);
        res.status(500).json({ erro: 'Erro ao buscar crescimento.' });
    }
});


// =========================================================
// KEEP ALIVE / FALLBACK
// =========================================================


// =========================================================
// ASSINATURAS DO CATÁLOGO - V5.3
// =========================================================

async function garantirAssinaturaParceiro(client, parceiroId) {
    const existe = await client.query('SELECT * FROM assinaturas_catalogo WHERE parceiro_id = $1 ORDER BY id DESC LIMIT 1', [parceiroId]);
    if (existe.rows.length) return existe.rows[0];
    const parceiro = await client.query('SELECT id, catalogo_teste_inicio, catalogo_teste_fim, catalogo_plano_status, catalogo_valor_mensal FROM parceiros WHERE id = $1', [parceiroId]);
    const p = parceiro.rows[0] || {};
    const criada = await client.query(
        `INSERT INTO assinaturas_catalogo (parceiro_id, status, inicio_teste, fim_teste, valor_mensal, proxima_cobranca)
         VALUES ($1, COALESCE($2,'TESTE_GRATIS'), COALESCE($3,CURRENT_DATE), COALESCE($4,(CURRENT_DATE + INTERVAL '3 months')::date), COALESCE($5,0), COALESCE($4,(CURRENT_DATE + INTERVAL '3 months')::date))
         RETURNING *`,
        [parceiroId, p.catalogo_plano_status, p.catalogo_teste_inicio, p.catalogo_teste_fim, p.catalogo_valor_mensal]
    );
    return criada.rows[0];
}

function assinaturaDiasRestantes(assinatura) {
    const base = assinatura.proxima_cobranca || assinatura.fim_teste;
    if (!base) return null;
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const fim = new Date(base); fim.setHours(0,0,0,0);
    return Math.ceil((fim - hoje) / 86400000);
}

app.get('/api/assinaturas/minha', autenticar, async (req, res) => {
    try {
        if (normalizarPerfil(req.user.perfil) !== 'PARCEIRO') return res.status(403).json({ erro: 'Acesso permitido somente para loja parceira.' });
        const parceiroId = req.user.parceiro_id;
        const assinatura = await garantirAssinaturaParceiro(db, parceiroId);
        const cobrancas = await db.query(
            `SELECT * FROM cobrancas_catalogo WHERE parceiro_id = $1 ORDER BY criado_em DESC LIMIT 12`,
            [parceiroId]
        ).catch(() => ({ rows: [] }));
        res.json({ assinatura: { ...assinatura, dias_restantes: assinaturaDiasRestantes(assinatura) }, cobrancas: cobrancas.rows });
    } catch (e) {
        console.error('❌ Erro minha assinatura:', e);
        res.status(500).json({ erro: 'Erro ao carregar assinatura: ' + e.message });
    }
});

app.get('/api/assinaturas/admin', autenticar, somenteAdmin, async (req, res) => {
    try {
        // garante assinatura para todos os parceiros existentes
        const parceiros = await db.query('SELECT id FROM parceiros ORDER BY id');
        for (const p of parceiros.rows) await garantirAssinaturaParceiro(db, p.id);
        const result = await db.query(
            `SELECT a.*, p.nome_loja, p.responsavel, p.telefone, p.catalogo_ativo,
                    GREATEST(0, (COALESCE(a.proxima_cobranca, a.fim_teste)::date - CURRENT_DATE))::int AS dias_restantes,
                    COALESCE(c.pendentes, 0) AS cobrancas_pendentes,
                    COALESCE(c.valor_pendente, 0) AS valor_pendente
             FROM assinaturas_catalogo a
             JOIN parceiros p ON p.id = a.parceiro_id
             LEFT JOIN LATERAL (
                SELECT COUNT(*) AS pendentes, SUM(valor)::numeric(10,2) AS valor_pendente
                FROM cobrancas_catalogo cc
                WHERE cc.parceiro_id = a.parceiro_id AND cc.status = 'PENDENTE'
             ) c ON true
             ORDER BY p.nome_loja ASC`
        );
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro assinaturas admin:', e);
        res.status(500).json({ erro: 'Erro ao listar assinaturas: ' + e.message });
    }
});

app.post('/api/assinaturas/:id/status', autenticar, somenteAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const status = String(req.body.status || '').toUpperCase();
        const permitidos = ['TESTE_GRATIS','ATIVA','PENDENTE','BLOQUEADA','CANCELADA'];
        if (!permitidos.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
        const result = await db.query(
            `UPDATE assinaturas_catalogo
             SET status = $1::varchar,
                 observacao = COALESCE($2, observacao),
                 valor_mensal = COALESCE($3, valor_mensal),
                 proxima_cobranca = COALESCE($4, proxima_cobranca),
                 atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $5
             RETURNING *`,
            [status, req.body.observacao || null, req.body.valor_mensal !== undefined && req.body.valor_mensal !== '' ? parseMoeda(req.body.valor_mensal) : null, req.body.proxima_cobranca || null, id]
        );
        if (!result.rows.length) return res.status(404).json({ erro: 'Assinatura não encontrada.' });
        await db.query(
            `UPDATE parceiros SET catalogo_plano_status = $1::varchar, catalogo_ativo = CASE WHEN $1::varchar IN ('BLOQUEADA','CANCELADA') THEN false ELSE true END WHERE id = $2`,
            [status, result.rows[0].parceiro_id]
        );
        await registrarAuditoria(req.user.id, `Alterou assinatura ${id} para ${status}`);
        res.json({ mensagem: 'Status da assinatura atualizado.', assinatura: result.rows[0] });
    } catch (e) {
        console.error('❌ Erro atualizar assinatura:', e);
        res.status(500).json({ erro: 'Erro ao atualizar assinatura: ' + e.message });
    }
});

app.post('/api/assinaturas/gerar-cobrancas', autenticar, somenteAdmin, async (req, res) => {
    try {
        const valorPadrao = req.body.valor_mensal !== undefined && req.body.valor_mensal !== '' ? parseMoeda(req.body.valor_mensal) : null;
        const ref = req.body.mes_referencia || new Date().toISOString().slice(0,7);
        const assinaturas = await db.query(
            `SELECT a.*, p.nome_loja
             FROM assinaturas_catalogo a
             JOIN parceiros p ON p.id = a.parceiro_id
             WHERE a.status IN ('TESTE_GRATIS','ATIVA','PENDENTE')
               AND COALESCE(a.proxima_cobranca, a.fim_teste)::date <= CURRENT_DATE`
        );
        let geradas = 0;
        for (const a of assinaturas.rows) {
            const valor = valorPadrao !== null ? valorPadrao : parseMoeda(a.valor_mensal || 0);
            const codigo = `COB-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${a.parceiro_id}`;
            const ins = await db.query(
                `INSERT INTO cobrancas_catalogo (codigo, assinatura_id, parceiro_id, mes_referencia, valor, status, vencimento, observacao)
                 SELECT $1,$2,$3,$4,$5,'PENDENTE',CURRENT_DATE + INTERVAL '7 days',$6
                 WHERE NOT EXISTS (
                    SELECT 1 FROM cobrancas_catalogo WHERE parceiro_id = $3 AND mes_referencia = $4 AND status IN ('PENDENTE','PAGO')
                 ) RETURNING id`,
                [codigo, a.id, a.parceiro_id, ref, valor, `Cobrança de assinatura do catálogo - ${ref}`]
            );
            if (ins.rows.length) {
                geradas += 1;
                await db.query(`UPDATE assinaturas_catalogo SET status = 'PENDENTE', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1`, [a.id]);
                await db.query(`UPDATE parceiros SET catalogo_plano_status = 'PENDENTE' WHERE id = $1`, [a.parceiro_id]);
            }
        }
        await registrarAuditoria(req.user.id, `Gerou ${geradas} cobrança(s) de assinatura do catálogo`);
        res.json({ mensagem: `Geradas ${geradas} cobrança(s).`, geradas });
    } catch (e) {
        console.error('❌ Erro gerar cobranças catálogo:', e);
        res.status(500).json({ erro: 'Erro ao gerar cobranças: ' + e.message });
    }
});

app.get('/api/assinaturas/cobrancas', autenticar, async (req, res) => {
    try {
        const params = [];
        let where = '';
        if (normalizarPerfil(req.user.perfil) === 'PARCEIRO') {
            params.push(req.user.parceiro_id);
            where = 'WHERE cc.parceiro_id = $1';
        }
        const result = await db.query(
            `SELECT cc.*, p.nome_loja
             FROM cobrancas_catalogo cc
             LEFT JOIN parceiros p ON p.id = cc.parceiro_id
             ${where}
             ORDER BY cc.criado_em DESC`,
            params
        );
        res.json(result.rows);
    } catch (e) {
        console.error('❌ Erro cobranças catálogo:', e);
        res.status(500).json({ erro: 'Erro ao listar cobranças: ' + e.message });
    }
});

app.post('/api/assinaturas/cobrancas/:id/pagar', autenticar, somenteAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const cobranca = await db.query(`UPDATE cobrancas_catalogo SET status = 'PAGO', data_pagamento = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`, [id]);
        if (!cobranca.rows.length) return res.status(404).json({ erro: 'Cobrança não encontrada.' });
        const c = cobranca.rows[0];
        await db.query(
            `UPDATE assinaturas_catalogo
             SET status = 'ATIVA', proxima_cobranca = (CURRENT_DATE + INTERVAL '1 month')::date, atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [c.assinatura_id]
        );
        await db.query(`UPDATE parceiros SET catalogo_plano_status = 'ATIVA', catalogo_ativo = true, catalogo_proxima_cobranca = (CURRENT_DATE + INTERVAL '1 month')::date WHERE id = $1`, [c.parceiro_id]);
        await registrarAuditoria(req.user.id, `Marcou cobrança de catálogo ${id} como paga`);
        res.json({ mensagem: 'Cobrança marcada como paga.' });
    } catch (e) {
        console.error('❌ Erro pagar cobrança catálogo:', e);
        res.status(500).json({ erro: 'Erro ao marcar cobrança como paga: ' + e.message });
    }
});

app.post('/api/assinaturas/sincronizar-status', autenticar, somenteAdmin, async (req, res) => {
    try {
        const vencidas = await db.query(
            `UPDATE assinaturas_catalogo a
             SET status = 'PENDENTE', atualizado_em = CURRENT_TIMESTAMP
             WHERE a.status = 'TESTE_GRATIS'
               AND COALESCE(a.fim_teste, CURRENT_DATE)::date < CURRENT_DATE
             RETURNING parceiro_id`
        );
        if (vencidas.rows.length) {
            await db.query(`UPDATE parceiros SET catalogo_plano_status = 'PENDENTE' WHERE id = ANY($1::int[])`, [vencidas.rows.map(r => r.parceiro_id)]);
        }
        res.json({ mensagem: 'Status sincronizados.', vencidas: vencidas.rows.length });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao sincronizar status: ' + e.message });
    }
});

app.get('/api/ping', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.status(200).send('Pong! Render e Supabase estão acordados. 🚀');
    } catch (e) {
        res.status(500).send('Erro ao acordar o banco.');
    }
});

app.use('/api', (req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada.' });
});

app.listen(PORT, () => console.log(`🔥 PERSONALIZE Hub Online: http://localhost:${PORT}`));
