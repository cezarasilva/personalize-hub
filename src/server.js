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
    try {
        const executor = clientOrDb || db;
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
    } catch (err) {
        console.warn('⚠️ Falha ao registrar movimentação:', err.message);
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

    try {
        await client.query('DELETE FROM produto_imagens WHERE produto_id = $1', [produtoId]);

        for (let i = 0; i < imagens.length; i++) {
            await client.query(
                `INSERT INTO produto_imagens (produto_id, imagem_url, ordem, principal)
                 VALUES ($1, $2, $3, $4)`,
                [produtoId, imagens[i], i + 1, i === 0]
            );
        }
    } catch (err) {
        if (String(err.message || '').includes('produto_imagens')) {
            console.warn('⚠️ Tabela produto_imagens não existe. Salvando apenas imagem principal em produtos.imagem_url. Rode o SQL V3.8 para galeria completa.');
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

    try {
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
    } catch (err) {
        console.warn('⚠️ Falha ao salvar histórico de precificação:', err.message);
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

            const skuFinal = sku || gerarSkuAutomatico(nome, categoria || 'Impressão 3D', produtoId);
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
                    sku || null,
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
        const estoquePatrimonio = await db.query(
            `SELECT COALESCE(SUM(estoque_central), 0) AS qtd_total_central,
                    COALESCE(SUM(estoque_central * custo_producao), 0) AS valor_total_custo
             FROM produto_variacoes`
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
             WHERE v.estoque_central < 5
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
                valor: estoquePatrimonio.rows[0].valor_total_custo
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
// KEEP ALIVE / FALLBACK
// =========================================================

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
