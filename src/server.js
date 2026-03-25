require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db = require('./config/db');
const multer = require('multer'); 
const { createClient } = require('@supabase/supabase-js'); 

// --- CONFIGURAÇÃO SUPABASE ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json());

// --- SERVIR ARQUIVOS ESTÁTICOS (HTML, CSS, JS) ---
app.use(express.static(path.join(__dirname, '../frontend')));

// Rota principal: Quando acessar o site, abre o Login direto
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const JWT_SECRET = process.env.JWT_SECRET || 'chave_super_secreta_personalize';

// --- CONFIGURAÇÃO EMAIL (GMAIL) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'cezar.antonio.silva@gmail.com', pass: 'bxse sblc spnt rkbo' }
});

// ==========================================
// 🔐 SEGURANÇA E USUÁRIOS
// ==========================================

app.post('/api/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        const resU = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (resU.rows.length === 0) return res.status(401).json({ erro: "E-mail ou senha incorretos!" });
        const user = resU.rows[0];
        if (!user.ativo) return res.status(403).json({ erro: "Acesso bloqueado ou em análise." });
        const valida = await bcrypt.compare(senha, user.senha_hash);
        if (!valida) return res.status(401).json({ erro: "E-mail ou senha incorretos!" });
        const token = jwt.sign({ id: user.id, perfil: user.perfil, parceiro_id: user.parceiro_id }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, usuario: { nome: user.nome, perfil: user.perfil, parceiro_id: user.parceiro_id } });
    } catch (e) { res.status(500).json({ erro: "Erro interno no login." }); }
});

// ==========================================
// 🔐 SEGURANÇA E USUÁRIOS (ROTA CORRIGIDA)
// ==========================================

app.post('/api/usuarios/recuperar', async (req, res) => {
    try {
        const { email } = req.body;
        const resU = await db.query('SELECT id, nome FROM usuarios WHERE email = $1', [email]);
        
        if (resU.rows.length === 0) {
            return res.status(404).json({ erro: "E-mail não encontrado." });
        }

        const senhaTemp = Math.random().toString(36).slice(-8);
        const hash = await bcrypt.hash(senhaTemp, 10);
        
        await db.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, resU.rows[0].id]);

        // Tenta enviar o e-mail, mas se falhar, não trava o servidor!
        try {
            await transporter.sendMail({
                from: `"PERSONALIZE Hub" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Recuperação de Senha - PERSONALIZE Hub',
                html: `<h2>Olá, ${resU.rows[0].nome}!</h2><p>Sua nova senha temporária é: <b>${senhaTemp}</b></p>`
            });
            res.json({ mensagem: "📩 E-mail enviado com sucesso!" });
        } catch (mailError) {
            console.error("❌ Erro ao enviar e-mail:", mailError);
            // Mesmo que o e-mail falhe, avisamos o frontend para destravar o botão
            res.status(500).json({ erro: "O servidor não conseguiu enviar o e-mail. Verifique as credenciais SMTP." });
        }

    } catch (e) { 
        console.error("Erro na recuperação:", e);
        res.status(500).json({ erro: "Erro interno ao recuperar senha." }); 
    }
});

app.get('/api/usuarios', async (req, res) => {
    try {
        const u = await db.query(`SELECT u.id, u.nome, u.email, u.perfil, u.ativo, p.nome_loja FROM usuarios u LEFT JOIN parceiros p ON u.parceiro_id = p.id ORDER BY u.id DESC`);
        res.json(u.rows);
    } catch (e) { res.status(500).json({ erro: "Erro ao buscar usuários." }); }
});

app.put('/api/usuarios/:id', async (req, res) => {
    try {
        const { nome, email, ativo } = req.body;
        await db.query('UPDATE usuarios SET nome=$1, email=$2, ativo=$3 WHERE id=$4', [nome, email, ativo, req.params.id]);
        res.json({ mensagem: "✅ Usuário atualizado!" });
    } catch (e) { res.status(500).json({ erro: "Erro ao atualizar usuário." }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
        res.json({ mensagem: "✅ Usuário removido." });
    } catch (e) { res.status(500).json({ erro: "Erro ao excluir usuário." }); }
});


// ==========================================
// 🏪 GESTÃO DE PARCEIROS E LOJAS
// ==========================================

// 1. LISTAR PARCEIROS (Admin)
app.get('/api/parceiros', async (req, res) => {
    try {
        const d = await db.query(`
            SELECT p.*, u.email as email_login 
            FROM parceiros p 
            LEFT JOIN usuarios u ON u.parceiro_id = p.id 
            ORDER BY p.id DESC
        `);
        res.json(d.rows);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ erro: "Erro ao buscar parceiros." }); 
    }
});

// 2. CADASTRAR DIRETO (Apenas Admin - Já entra ATIVO)
app.post('/api/parceiros', async (req, res) => {
    try {
        const { nome_loja, responsavel, telefone, email, senha } = req.body;

        // Log para conferência no terminal
        console.log("Admin cadastrando loja:", { nome_loja, email });

        const check = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (check.rows.length > 0) return res.status(400).json({ erro: "E-mail já cadastrado!" });

        const novaLoja = await db.query(
            `INSERT INTO parceiros (nome_loja, responsavel, telefone, status) 
             VALUES ($1, $2, $3, 'ATIVO') RETURNING id`, 
            [nome_loja, responsavel, telefone]
        );

        const parceiro_id = novaLoja.rows[0].id;
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(senha, salt);
        
        await db.query(
            `INSERT INTO usuarios (nome, email, senha_hash, perfil, parceiro_id, ativo) 
             VALUES ($1, $2, $3, 'PARCEIRO', $4, true)`, 
            [responsavel, email, hash, parceiro_id]
        );

        res.status(201).json({ mensagem: "✅ Parceiro cadastrado com sucesso!" });
    } catch (erro) {
        console.error("ERRO NO CADASTRO:", erro.message);
        res.status(500).json({ erro: "Erro interno: " + erro.message });
    }
});

// 3. SOLICITAÇÃO EXTERNA (Vem do registrar.html - Fica PENDENTE)
app.post('/api/parceiros/solicitar', async (req, res) => {
    try {
        const { nome_loja, responsavel, telefone, email_login, senha_login } = req.body;
        console.log("Nova solicitação de parceria recebida:", nome_loja);

        const check = await db.query('SELECT id FROM usuarios WHERE email = $1', [email_login]);
        if (check.rows.length > 0) return res.status(400).json({ erro: "Este e-mail já está em uso!" });

        // Entra como PENDENTE
        const novaLoja = await db.query(
            `INSERT INTO parceiros (nome_loja, responsavel, telefone, status) 
             VALUES ($1, $2, $3, 'PENDENTE') RETURNING id`, 
            [nome_loja, responsavel, telefone]
        );

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(senha_login, salt);
        
        // Entra como inativo (false) para não conseguir logar
        await db.query(
            `INSERT INTO usuarios (nome, email, senha_hash, perfil, parceiro_id, ativo) 
             VALUES ($1, $2, $3, 'PARCEIRO', $4, false)`, 
            [responsavel, email_login, hash, novaLoja.rows[0].id]
        );

        res.status(201).json({ mensagem: "✅ Solicitação enviada! Aguarde nossa análise." });
    } catch (erro) {
        console.error("ERRO NA SOLICITAÇÃO:", erro.message);
        res.status(500).json({ erro: "Erro interno ao enviar solicitação." });
    }
});

// 4. EDITAR PARCEIRO (Admin ajustando dados)
app.put('/api/parceiros/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nome_loja, responsavel, telefone, status } = req.body;

        const query = `
            UPDATE parceiros 
            SET nome_loja = COALESCE($1, nome_loja), 
                responsavel = COALESCE($2, responsavel), 
                telefone = COALESCE($3, telefone), 
                status = COALESCE($4, status) 
            WHERE id = $5
            RETURNING *`;
        
        const resultado = await db.query(query, [nome_loja, responsavel, telefone, status, id]);

        if (resultado.rowCount === 0) return res.status(404).json({ erro: "Loja não encontrada." });

        // Se mudou o status da loja para ATIVO, ativa o usuário também
        if (status === 'ATIVO') {
            await db.query('UPDATE usuarios SET ativo = true WHERE parceiro_id = $1', [id]);
        }

        res.json({ mensagem: "✅ Loja atualizada com sucesso!", dados: resultado.rows[0] });
    } catch (erro) {
        console.error("ERRO AO EDITAR LOJA:", erro.message);
        res.status(500).json({ erro: "Erro interno: " + erro.message });
    }
});

// 5. DELETAR PARCEIRO (Limpa tudo associado)
app.delete('/api/parceiros/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM consignacoes_estoque WHERE parceiro_id = $1', [id]);
        await db.query('DELETE FROM usuarios WHERE parceiro_id = $1', [id]);
        await db.query('DELETE FROM parceiros WHERE id = $1', [id]);
        res.json({ mensagem: "🗑️ Parceiro removido com sucesso!" });
    } catch (e) { 
        res.status(500).json({ erro: "Erro ao deletar parceiro." }); 
    }
});


// ==========================================
// 📦 PRODUTOS E LOGÍSTICA
// ==========================================

app.post('/api/produtos', upload.single('imagem'), async (req, res) => {
    try {
        const { nome, categoria, variacao, preco_venda, preco_repasse, custo_producao, estoque } = req.body;
        let imagem_url = null;
        if (req.file) {
            const nomeArq = `${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`;
            await supabase.storage.from('produtos').upload(nomeArq, req.file.buffer, { contentType: req.file.mimetype });
            const { data } = supabase.storage.from('produtos').getPublicUrl(nomeArq);
            imagem_url = data.publicUrl;
        }
        const nP = await db.query(`INSERT INTO produtos (nome, categoria, imagem_url, descricao) VALUES ($1, $2, $3, 'Peça 3D') RETURNING id`, [nome, categoria, imagem_url]);
        await db.query(`INSERT INTO produto_variacoes (produto_id, variacao, preco_venda, preco_repasse, custo_producao, estoque_central) VALUES ($1, $2, $3, $4, $5, $6)`, [nP.rows[0].id, variacao, preco_venda, preco_repasse, custo_producao, estoque]);
        res.status(201).json({ mensagem: "✅ Produto cadastrado!" });
    } catch (e) { res.status(500).json({ erro: "Erro no cadastro de produto." }); }
});

app.get('/api/produtos', async (req, res) => {
    try {
        const p = await db.query(`SELECT p.id, p.nome, p.categoria, p.imagem_url, v.variacao, v.preco_venda, v.preco_repasse, v.custo_producao, v.estoque_central FROM produtos p JOIN produto_variacoes v ON p.id = v.produto_id ORDER BY p.id DESC`);
        res.json(p.rows);
    } catch (e) { res.status(500).json({ erro: "Erro ao buscar produtos." }); }
});

app.patch('/api/produtos/estoque/:id', async (req, res) => {
    try {
        await db.query(`UPDATE produto_variacoes SET estoque_central = $1 WHERE produto_id = $2`, [req.body.novo_estoque, req.params.id]);
        res.json({ mensagem: "✅ Estoque atualizado!" });
    } catch (e) { res.status(500).json({ erro: "Erro no ajuste de estoque." }); }
});

app.delete('/api/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const v = await db.query(`SELECT id FROM produto_variacoes WHERE produto_id = $1`, [id]);
        if (v.rows.length > 0) {
            await db.query(`DELETE FROM consignacoes_estoque WHERE variacao_id = $1`, [v.rows[0].id]);
            await db.query(`DELETE FROM vendas WHERE variacao_id = $1`, [v.rows[0].id]);
            await db.query(`DELETE FROM produto_variacoes WHERE produto_id = $1`, [id]);
        }
        await db.query(`DELETE FROM produtos WHERE id = $1`, [id]);
        res.json({ mensagem: "✅ Peça removida!" });
    } catch (e) { res.status(500).json({ erro: "Erro ao deletar produto." }); }
});

// ==========================================
// 🚚 GESTÃO DE REMESSAS (CONSIGNAÇÃO)
// ==========================================

// 1. LISTAR ESTOQUE DE UMA LOJA ESPECÍFICA
app.get('/api/consignacoes/:parceiro_id', async (req, res) => {
    try {
        const query = `
            SELECT c.id, p.nome as produto_nome, v.variacao, v.preco_repasse, c.quantidade_atual, c.variacao_id
            FROM consignacoes_estoque c 
            JOIN produto_variacoes v ON c.variacao_id = v.id 
            JOIN produtos p ON v.produto_id = p.id 
            WHERE c.parceiro_id = $1 AND c.quantidade_atual > 0
            ORDER BY p.nome ASC`;
        
        const d = await db.query(query, [req.params.parceiro_id]);
        res.json(d.rows);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar estoque da loja." });
    }
});

// 2. ENVIAR NOVA REMESSA (Cria ou Incrementa)
app.post('/api/consignacoes', async (req, res) => {
    try {
        const { parceiro_id, produto_id, quantidade } = req.body;
        const qtd = parseInt(quantidade);

        // Busca a variação e checa estoque central
        const vRes = await db.query(`SELECT id, estoque_central FROM produto_variacoes WHERE produto_id = $1`, [produto_id]);
        if (vRes.rows.length === 0) return res.status(404).json({ erro: "Produto não encontrado." });
        
        const vId = vRes.rows[0].id;
        if (vRes.rows[0].estoque_central < qtd) return res.status(400).json({ erro: "Estoque central insuficiente!" });

        // Tira do estoque central
        await db.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [qtd, vId]);

        // Verifica se a loja já tem esse produto
        const ex = await db.query('SELECT id FROM consignacoes_estoque WHERE parceiro_id = $1 AND variacao_id = $2', [parceiro_id, vId]);

        if (ex.rows.length > 0) {
            await db.query('UPDATE consignacoes_estoque SET quantidade_atual = quantidade_atual + $1, quantidade_enviada = quantidade_enviada + $1 WHERE id = $2', [qtd, ex.rows[0].id]);
        } else {
            await db.query('INSERT INTO consignacoes_estoque (parceiro_id, variacao_id, quantidade_enviada, quantidade_atual) VALUES ($1, $2, $3, $3)', [parceiro_id, vId, qtd]);
        }

        res.status(201).json({ mensagem: "✅ Remessa enviada com sucesso!" });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao processar remessa: " + e.message });
    }
});

// 3. AJUSTAR QUANTIDADE (Update com balanceamento de estoque)
app.put('/api/consignacoes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nova_quantidade } = req.body;

        const rem = await db.query('SELECT variacao_id, quantidade_atual FROM consignacoes_estoque WHERE id = $1', [id]);
        if (rem.rows.length === 0) return res.status(404).json({ erro: "Remessa não encontrada." });

        const { variacao_id, quantidade_atual } = rem.rows[0];
        const diferenca = nova_quantidade - quantidade_atual;

        // Se estiver aumentando o envio, checa se tem no centro
        if (diferenca > 0) {
            const centro = await db.query('SELECT estoque_central FROM produto_variacoes WHERE id = $1', [variacao_id]);
            if (centro.rows[0].estoque_central < diferenca) return res.status(400).json({ erro: "Estoque central insuficiente para este ajuste!" });
        }

        // Ajusta ambos os lados
        await db.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [diferenca, variacao_id]);
        await db.query('UPDATE consignacoes_estoque SET quantidade_atual = $1 WHERE id = $2', [nova_quantidade, id]);

        res.json({ mensagem: "✅ Quantidade ajustada!" });
    } catch (e) {
        res.status(500).json({ erro: "Erro no ajuste." });
    }
});

// 4. DELETAR/ESTORNAR REMESSA (Devolve tudo ao centro)
app.delete('/api/consignacoes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const rem = await db.query('SELECT variacao_id, quantidade_atual FROM consignacoes_estoque WHERE id = $1', [id]);
        if (rem.rows.length === 0) return res.status(404).json({ erro: "Remessa não encontrada." });

        // Devolve ao centro e apaga
        await db.query('UPDATE produto_variacoes SET estoque_central = estoque_central + $1 WHERE id = $2', [rem.rows[0].quantidade_atual, rem.rows[0].variacao_id]);
        await db.query('DELETE FROM consignacoes_estoque WHERE id = $1', [id]);

        res.json({ mensagem: "🗑️ Remessa cancelada e estoque devolvido ao centro!" });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao excluir remessa." });
    }
});

// ==========================================
// 💰 FRENTE DE CAIXA (VENDAS & ESTORNO)
// ==========================================

// 1. REGISTRAR VENDA (Lógica Inteligente de Estoque)
app.post('/api/vendas', async (req, res) => {
    try {
        const { produto_id, quantidade, parceiro_id } = req.body;
        const auth = req.headers.authorization;
        if (!auth) return res.status(401).json({ erro: "Não autorizado." });

        const user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        const qtd = parseInt(quantidade);

        // Busca informações do produto e da variação
        const info = await db.query(`
            SELECT v.id, v.preco_venda, v.preco_repasse, v.estoque_central 
            FROM produto_variacoes v 
            WHERE v.produto_id = $1`, [produto_id]);
        
        if (info.rows.length === 0) return res.status(404).json({ erro: "Produto não encontrado." });
        const v = info.rows[0];

        // Define se a venda é do estoque central ou de um parceiro
        // Se for Admin, ele pode escolher um parceiro ou vender direto (null)
        // Se for Parceiro, o sistema força o ID dele
        let pIdFinal = (user.perfil === 'PARCEIRO') ? user.parceiro_id : (parceiro_id || null);
        let valorVenda = 0;

        if (pIdFinal) {
            // VENDA VIA PARCEIRO: Tira do estoque consignado
            const estLoja = await db.query(
                'SELECT id, quantidade_atual FROM consignacoes_estoque WHERE parceiro_id = $1 AND variacao_id = $2', 
                [pIdFinal, v.id]
            );

            if (estLoja.rows.length === 0 || estLoja.rows[0].quantidade_atual < qtd) {
                return res.status(400).json({ erro: "Estoque insuficiente na loja parceira!" });
            }

            await db.query('UPDATE consignacoes_estoque SET quantidade_atual = quantidade_atual - $1, quantidade_vendida = quantidade_vendida + $1 WHERE id = $2', [qtd, estLoja.rows[0].id]);
            valorVenda = v.preco_repasse * qtd; // Preço que o parceiro paga pro Rogério
        } else {
            // VENDA DIRETA (ADMIN): Tira do estoque central
            if (v.estoque_central < qtd) return res.status(400).json({ erro: "Estoque central insuficiente!" });
            
            await db.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [qtd, v.id]);
            valorVenda = v.preco_venda * qtd; // Preço de venda final
        }

        // Registra a venda
        await db.query(
            `INSERT INTO vendas (parceiro_id, usuario_id, variacao_id, quantidade, valor_total) 
             VALUES ($1, $2, $3, $4, $5)`, 
            [pIdFinal, user.id, v.id, qtd, valorVenda]
        );

        res.status(201).json({ mensagem: "✅ Venda realizada com sucesso!" });

    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao processar venda: " + e.message });
    }
});

// 2. LISTAR ÚLTIMAS VENDAS (Extrato)
app.get('/api/vendas', async (req, res) => {
    try {
        const query = `
            SELECT v.id, v.quantidade, v.valor_total, 
                   TO_CHAR(v.data_venda, 'DD/MM/YYYY HH24:MI') as data_formatada, 
                   p.nome as produto_nome, var.variacao, 
                   COALESCE(parc.nome_loja, 'VENDA DIRETA') as loja 
            FROM vendas v 
            JOIN produto_variacoes var ON v.variacao_id = var.id 
            JOIN produtos p ON var.produto_id = p.id 
            LEFT JOIN parceiros parc ON v.parceiro_id = parc.id 
            ORDER BY v.id DESC LIMIT 50`;
        
        const result = await db.query(query);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar extrato de vendas." });
    }
});

// 3. CANCELAR VENDA (Estorno de Estoque)
app.delete('/api/vendas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const vRes = await db.query('SELECT * FROM vendas WHERE id = $1', [id]);
        if (vRes.rows.length === 0) return res.status(404).json({ erro: "Venda não encontrada." });

        const venda = vRes.rows[0];

        // Devolve o estoque para o lugar de origem
        if (venda.parceiro_id) {
            await db.query(
                `UPDATE consignacoes_estoque 
                 SET quantidade_atual = quantidade_atual + $1, 
                     quantidade_vendida = quantidade_vendida - $1 
                 WHERE parceiro_id = $2 AND variacao_id = $3`, 
                [venda.quantidade, venda.parceiro_id, venda.variacao_id]
            );
        } else {
            await db.query(
                'UPDATE produto_variacoes SET estoque_central = estoque_central + $1 WHERE id = $2', 
                [venda.quantidade, venda.variacao_id]
            );
        }

        await db.query('DELETE FROM vendas WHERE id = $1', [id]);
        res.json({ mensagem: "✅ Venda cancelada e estoque estornado!" });

    } catch (e) {
        res.status(500).json({ erro: "Erro ao cancelar venda." });
    }
});

// ==========================================
// 📊 DASHBOARD E GRÁFICOS
// ==========================================

app.get('/api/dashboard', async (req, res) => {
    try {
        // 1. Vendas do Mês (Receita e Pedidos)
        const vMes = await db.query(`
            SELECT COUNT(*) as total_pedidos, COALESCE(SUM(valor_total), 0) as receita_total 
            FROM vendas 
            WHERE EXTRACT(MONTH FROM data_venda) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM data_venda) = EXTRACT(YEAR FROM CURRENT_DATE)`);

        // 2. Patrimônio: Qtd total no estoque central e Valor Total (Custo de Produção)
        const estoquePatrimonio = await db.query(`
            SELECT 
                SUM(estoque_central) as qtd_total_central,
                SUM(estoque_central * custo_producao) as valor_total_custo
            FROM produto_variacoes`);

        // 3. Estoque por Parceiro (Onde estão os produtos)
        const estoquePorParceiro = await db.query(`
            SELECT 
                p.nome_loja, 
                COALESCE(SUM(c.quantidade_atual), 0) as total_produtos
            FROM parceiros p
            LEFT JOIN consignacoes_estoque c ON p.id = c.parceiro_id
            GROUP BY p.nome_loja
            ORDER BY total_produtos DESC`);

        // 4. Itens com estoque baixo (Abaixo de 5 unidades)
        const eBaixo = await db.query(`
            SELECT p.nome, v.estoque_central, v.variacao 
            FROM produto_variacoes v 
            JOIN produtos p ON p.id = v.produto_id 
            WHERE v.estoque_central < 5 
            ORDER BY v.estoque_central ASC LIMIT 4`);

        // 5. Ranking de produtos mais vendidos
        const rank = await db.query(`
            SELECT p.nome, SUM(v.quantidade) as total_vendido 
            FROM vendas v 
            JOIN produto_variacoes var ON v.variacao_id = var.id 
            JOIN produtos p ON var.produto_id = p.id 
            GROUP BY p.nome 
            ORDER BY total_vendido DESC LIMIT 4`);

        res.json({ 
            pedidos_mes: vMes.rows[0].total_pedidos, 
            receita_mes: vMes.rows[0].receita_total,
            patrimonio: {
                quantidade: estoquePatrimonio.rows[0].qtd_total_central || 0,
                valor: estoquePatrimonio.rows[0].valor_total_custo || 0
            },
            parceiros_estoque: estoquePorParceiro.rows,
            estoque_lista: eBaixo.rows, 
            ranking: rank.rows 
        });

    } catch (e) { 
        console.error("Erro Dashboard:", e.message);
        res.status(500).json({ erro: "Erro ao processar dados do dashboard." }); 
    }
});

app.get('/api/grafico-vendas', async (req, res) => {
    try {
        const d = await db.query(`SELECT TO_CHAR(data_venda, 'DD/MM') as dia, SUM(valor_total) as total FROM vendas WHERE data_venda >= CURRENT_DATE - INTERVAL '7 days' GROUP BY dia ORDER BY MIN(data_venda) ASC`);
        res.json(d.rows);
    } catch (e) { res.status(500).json({ erro: "Erro no gráfico." }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 PERSONALIZE Hub Online: http://localhost:${PORT}`));