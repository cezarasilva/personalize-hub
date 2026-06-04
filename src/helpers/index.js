const db = require('../config/db');
const { supabase } = require('../config/supabase');

// ---- Currency / Number ----

function parseMoeda(valor) {
    if (valor === null || valor === undefined || valor === '') return 0;
    if (typeof valor === 'number') return Number.isFinite(valor) ? Number(valor.toFixed(2)) : 0;
    let texto = String(valor).replace(/R\$/gi, '').replace(/\s/g, '').trim();
    if (!texto) return 0;
    const temVirgula = texto.includes(',');
    const temPonto = texto.includes('.');
    if (temVirgula && temPonto) {
        const ul = texto.lastIndexOf(',');
        const up = texto.lastIndexOf('.');
        texto = ul > up ? texto.replace(/\./g, '').replace(',', '.') : texto.replace(/,/g, '');
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

// ---- Machine Cost Calculator ----

function calcularCustosMaquina(dados = {}) {
    const valorCompra    = parseMoeda(dados.valor_compra);
    const vidaUtilHoras  = parseMoeda(dados.vida_util_horas);
    const potenciaKw     = parseMoeda(dados.potencia_kw);
    const valorKwh       = parseMoeda(dados.valor_kwh);
    const manutencao     = parseMoeda(dados.custo_manutencao_hora);
    const custoHoraManual = parseMoeda(dados.custo_hora_manual);
    const usarManual = dados.usar_custo_manual === true || String(dados.usar_custo_manual).toLowerCase() === 'true';
    const depreciacao = vidaUtilHoras > 0 ? valorCompra / vidaUtilHoras : 0;
    const energia = potenciaKw * valorKwh;
    const calculado = depreciacao + energia + manutencao;
    const total = usarManual && custoHoraManual > 0 ? custoHoraManual : calculado;
    return {
        custo_depreciacao_hora: Number(depreciacao.toFixed(4)),
        custo_energia_hora:     Number(energia.toFixed(4)),
        custo_total_hora:       Number(total.toFixed(4)),
        custo_hora_manual:      custoHoraManual,
        usar_custo_manual:      usarManual
    };
}

// ---- Code Generator ----

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

// ---- Date Helpers ----

function inicioFimMes(mesReferencia) {
    let ano, mes;
    const texto = String(mesReferencia || '').trim();
    if (/^\d{4}-\d{2}$/.test(texto)) {
        [ano, mes] = texto.split('-').map(Number);
    } else if (/^\d{2}\/\d{4}$/.test(texto)) {
        const p = texto.split('/').map(Number);
        mes = p[0]; ano = p[1];
    } else if (/^\d{4}\/\d{2}$/.test(texto)) {
        [ano, mes] = texto.split('/').map(Number);
    } else {
        const hoje = new Date();
        ano = hoje.getFullYear(); mes = hoje.getMonth() + 1;
    }
    const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const pm = mes === 12 ? 1 : mes + 1;
    const pa = mes === 12 ? ano + 1 : ano;
    const fim = `${pa}-${String(pm).padStart(2, '0')}-01`;
    const ref = `${ano}-${String(mes).padStart(2, '0')}`;
    return { inicio, fim, ref };
}

// ---- User / Profile ----

function normalizarPerfil(perfil) {
    return String(perfil || '').trim().toUpperCase();
}

function garantirParceiroPermitido(req, parceiroId) {
    if (!req.user) return false;
    if (normalizarPerfil(req.user.perfil) === 'ADMIN') return true;
    return Number(req.user.parceiro_id) === Number(parceiroId);
}

// ---- SKU ----

function gerarSkuAutomatico(nome, categoria, produtoId) {
    const limpar = (texto, fallback) => {
        const s = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        return (s.slice(0, 3) || fallback);
    };
    return `${limpar(categoria, 'PRD')}-${limpar(nome, 'PRO')}-${String(produtoId || Date.now()).padStart(4, '0')}`;
}

function normalizarSku(valor) {
    const sku = String(valor || '').trim();
    return sku ? sku : null;
}

// ---- Phone / Slug / Text ----

function telefoneWhatsappLimpo(telefone) {
    return String(telefone || '').replace(/\D/g, '');
}

function slugifyCatalogo(texto) {
    return String(texto || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

function sanitizarTexto(html) {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/data:[^;'"]+;[^"' ]*/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
}

// ---- Database Helpers ----

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
        await db.query('INSERT INTO logs_auditoria (usuario_id, acao) VALUES ($1, $2)', [usuarioId || null, acao]);
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
                dados.produto_id || null, dados.variacao_id || null,
                dados.parceiro_id || null, dados.usuario_id || null,
                dados.tipo, toInt(dados.quantidade, 0),
                dados.estoque_origem || null, dados.estoque_destino || null,
                dados.referencia_tipo || null, dados.referencia_id || null,
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

// ---- Image Upload ----

async function uploadImagemProduto(file) {
    if (!file) return null;
    if (!supabase) throw new Error('Supabase Storage não configurado. Verifique SUPABASE_URL e SUPABASE_KEY.');
    const nomeSeguro = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '');
    const nomeArq = `${Date.now()}_${nomeSeguro}`;
    const { error } = await supabase.storage.from('produtos').upload(nomeArq, file.buffer, { contentType: file.mimetype, upsert: false });
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
                `INSERT INTO produto_imagens (produto_id, imagem_url, ordem, principal) VALUES ($1,$2,$3,$4)`,
                [produtoId, imagens[i], i + 1, i === 0]
            );
        }
        await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
        try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch (_) {}
        try { await client.query(`RELEASE SAVEPOINT ${sp}`); } catch (_) {}
        if (String(err.message || '').includes('produto_imagens')) {
            console.warn('⚠️ Tabela produto_imagens não existe. Salvando apenas imagem principal.');
        } else { throw err; }
    }
    await client.query('UPDATE produtos SET imagem_url = $1 WHERE id = $2', [imagens[0], produtoId]);
    return imagens[0];
}

// ---- Pricing ----

async function salvarPrecificacaoProduto(client, produtoId, variacaoId, body, usuarioId) {
    const precificado = String(body.precificado || '').toLowerCase() === 'true' || String(body.precificado || '').toLowerCase() === 'sim';
    if (!precificado) return;
    const dados = {
        peso_gramas: parseMoeda(body.peso_gramas), valor_kg_material: parseMoeda(body.valor_kg_material),
        quantidade_produzida: Math.max(1, toInt(body.quantidade_produzida, 1)),
        unidade_precificacao: body.unidade_precificacao || 'UNIDADE',
        maquina_id: body.maquina_id ? toInt(body.maquina_id, 0) : null,
        maquina_nome_snapshot: body.maquina_nome_snapshot || null,
        tempo_maquina_horas: parseMoeda(body.tempo_maquina_horas), valor_hora_maquina: parseMoeda(body.valor_hora_maquina),
        custo_material: parseMoeda(body.custo_material), custo_maquina: parseMoeda(body.custo_maquina),
        custo_energia: parseMoeda(body.custo_energia), custo_mao_obra: parseMoeda(body.custo_mao_obra),
        custo_embalagem: parseMoeda(body.custo_embalagem), custo_acessorios: parseMoeda(body.custo_acessorios),
        custo_perdas: parseMoeda(body.custo_perdas), custo_extra: parseMoeda(body.custo_extra),
        custo_total: parseMoeda(body.custo_total || body.custo_producao),
        custo_total_producao: parseMoeda(body.custo_total_producao || body.custo_total || body.custo_producao),
        custo_unitario: parseMoeda(body.custo_unitario || body.custo_producao),
        custo_hora_maquina: parseMoeda(body.custo_hora_maquina || body.valor_hora_maquina),
        custo_total_maquina: parseMoeda(body.custo_total_maquina || body.custo_maquina),
        margem_percentual: parseMoeda(body.margem_percentual), taxa_canal_percentual: parseMoeda(body.taxa_canal_percentual),
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
                produto_id,variacao_id,usuario_id,tipo_precificacao,canal_venda,
                peso_gramas,valor_kg_material,quantidade_produzida,unidade_precificacao,
                maquina_id,maquina_nome_snapshot,tempo_maquina_horas,valor_hora_maquina,custo_hora_maquina,custo_total_maquina,
                custo_material,custo_maquina,custo_energia,custo_mao_obra,
                custo_embalagem,custo_acessorios,custo_perdas,custo_extra,
                custo_total,custo_total_producao,custo_unitario,
                margem_percentual,taxa_canal_percentual,taxa_canal_fixa,
                preco_sugerido,preco_sugerido_unitario,preco_venda_final,preco_final_unitario,preco_total_lote,preco_repasse_final
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)`,
            [
                produtoId,variacaoId||null,usuarioId||null,dados.tipo_precificacao,dados.canal_venda,
                dados.peso_gramas,dados.valor_kg_material,dados.quantidade_produzida,dados.unidade_precificacao,
                dados.maquina_id,dados.maquina_nome_snapshot,dados.tempo_maquina_horas,dados.valor_hora_maquina,dados.custo_hora_maquina,dados.custo_total_maquina,
                dados.custo_material,dados.custo_maquina,dados.custo_energia,dados.custo_mao_obra,
                dados.custo_embalagem,dados.custo_acessorios,dados.custo_perdas,dados.custo_extra,
                dados.custo_total,dados.custo_total_producao,dados.custo_unitario,
                dados.margem_percentual,dados.taxa_canal_percentual,dados.taxa_canal_fixa,
                dados.preco_sugerido,dados.preco_sugerido_unitario,dados.preco_venda_final,dados.preco_final_unitario,dados.preco_total_lote,dados.preco_repasse_final
            ]
        );
        await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
        try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch (_) {}
        try { await client.query(`RELEASE SAVEPOINT ${sp}`); } catch (_) {}
        console.warn('⚠️ Falha ao salvar histórico de precificação. Produto será salvo normalmente:', err.message);
    }
}

// ---- CSV ----

function csvEscape(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows, cols) {
    const header = cols.map(c => csvEscape(c.label)).join(',');
    const lines = rows.map(r => cols.map(c => csvEscape(r[c.key])).join(','));
    return [header, ...lines].join('\n');
}

module.exports = {
    parseMoeda, toInt, money,
    calcularCustosMaquina,
    gerarCodigo,
    inicioFimMes,
    normalizarPerfil,
    garantirParceiroPermitido,
    gerarSkuAutomatico, normalizarSku,
    telefoneWhatsappLimpo, slugifyCatalogo, sanitizarTexto,
    transacao, registrarAuditoria, registrarMovimentacao,
    uploadImagemProduto, arquivosProduto, uploadImagensProduto, salvarGaleriaProduto,
    salvarPrecificacaoProduto,
    csvEscape, toCSV,
};
