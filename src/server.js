require('dotenv').config();

const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

const crypto = require('crypto'); 
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
// Configuração forçada com Host e Porta para evitar Timeout no Render
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    },
    tls: {
        rejectUnauthorized: false
    }
});

// ==========================================
// 🔐 SEGURANÇA E USUÁRIOS
// ==========================================

app.post('/api/login', async (req, res) => {
    try {
        // Agora o login é pelo USUARIO e não mais pelo e-mail
        const { usuario, senha } = req.body; 
        
        const resU = await db.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario]);
        if (resU.rows.length === 0) return res.status(401).json({ erro: "Usuário ou senha incorretos!" });
        
        const user = resU.rows[0];
        if (!user.ativo) return res.status(403).json({ erro: "Acesso bloqueado ou em análise." });
        
        const valida = await bcrypt.compare(senha, user.senha_hash);
        if (!valida) return res.status(401).json({ erro: "Usuário ou senha incorretos!" });
        
        const token = jwt.sign({ id: user.id, perfil: user.perfil, parceiro_id: user.parceiro_id }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, usuario: { nome: user.nome, perfil: user.perfil, parceiro_id: user.parceiro_id, usuario: user.usuario } });
    } catch (e) { res.status(500).json({ erro: "Erro interno no login." }); }
});

// ==========================================
// 🔑 ROTA 1: GERAR TOKEN E ENVIAR E-MAIL
// ==========================================
app.post('/api/usuarios/recuperar', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ erro: "Por favor, informe seu e-mail." });

        const userRes = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ erro: "E-mail não encontrado no sistema." });

        const user = userRes.rows[0];

        // 1. Gera um Token seguro e a data de validade (1 hora)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpira = new Date(Date.now() + 3600000); // +1 Hora

        // 2. Salva o Token no banco de dados
        await db.query(
            'UPDATE usuarios SET reset_token = $1, reset_token_expira = $2 WHERE id = $3', 
            [resetToken, tokenExpira, user.id]
        );

        // 3. Monta o Link Mágico
        const linkRecuperacao = `https://personalize-hub.onrender.com/redefinir-senha.html?token=${resetToken}`;

        // 4. Dispara o e-mail com o Botão
        const mailOptions = {
            from: `"PERSONALIZE Hub" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Recuperação de Senha - PERSONALIZE Hub',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
                    <h2 style="color: #3b82f6; text-align: center;">PERSONALIZE Hub</h2>
                    <p>Olá, <strong>${user.nome}</strong>!</p>
                    <p>Recebemos um pedido para redefinir sua senha de acesso. (Seu usuário é: <b>${user.usuario || user.email}</b>).</p>
                    <p>Para criar uma nova senha, clique no botão abaixo. Este link é válido por 1 hora.</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${linkRecuperacao}" style="background-color: #3b82f6; color: white; padding: 14px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">Redefinir Minha Senha</a>
                    </div>
                    
                    <p style="font-size: 12px; color: #9ca3af; text-align: center;">Se você não solicitou isso, pode ignorar este e-mail tranquilamente.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ mensagem: "Link de recuperação enviado para o seu e-mail!" });

    } catch (erro) {
        console.error("❌ ERRO RECUPERAÇÃO:", erro);
        res.status(500).json({ erro: "Erro no servidor ao tentar enviar o e-mail." });
    }
});

// ==========================================
// 🔑 ROTA 2: RECEBER A NOVA SENHA E SALVAR
// ==========================================
app.post('/api/usuarios/reset-password', async (req, res) => {
    try {
        const { token, novaSenha } = req.body;

        if (!token || !novaSenha) return res.status(400).json({ erro: "Dados inválidos." });

        // 1. Procura se existe alguém com esse Token e se ainda tá na validade
        const userRes = await db.query(
            'SELECT * FROM usuarios WHERE reset_token = $1 AND reset_token_expira > NOW()',
            [token]
        );

        if (userRes.rows.length === 0) {
            return res.status(400).json({ erro: "Link inválido ou expirado. Solicite novamente." });
        }

        const user = userRes.rows[0];

        // 2. Criptografa a senha nova
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(novaSenha, salt);

        // 3. Atualiza a senha no banco e DELETA o Token (para não ser usado de novo)
        await db.query(
            'UPDATE usuarios SET senha_hash = $1, reset_token = NULL, reset_token_expira = NULL WHERE id = $2',
            [hash, user.id]
        );

        res.status(200).json({ mensagem: "Senha redefinida com sucesso!" });

    } catch (erro) {
        console.error("❌ ERRO RESET:", erro);
        res.status(500).json({ erro: "Erro ao redefinir a senha." });
    }
});

app.get('/api/usuarios', async (req, res) => {
    try {
        const u = await db.query(`SELECT u.id, u.nome, u.email, u.usuario, u.perfil, u.ativo, p.nome_loja FROM usuarios u LEFT JOIN parceiros p ON u.parceiro_id = p.id ORDER BY u.id DESC`);
        res.json(u.rows);
    } catch (e) { res.status(500).json({ erro: "Erro ao buscar usuários." }); }
});

app.put('/api/usuarios/:id', async (req, res) => {
    try {
        const { nome, senha, ativo } = req.body;
        if(senha) {
            const hash = await bcrypt.hash(senha, 10);
            await db.query('UPDATE usuarios SET nome=$1, senha_hash=$2, ativo=$3 WHERE id=$4', [nome, hash, ativo, req.params.id]);
        } else {
            await db.query('UPDATE usuarios SET nome=$1, ativo=$2 WHERE id=$3', [nome, ativo, req.params.id]);
        }
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

app.get('/api/parceiros', async (req, res) => {
    try {
        const d = await db.query(`
            SELECT p.*, u.usuario, u.email as email_login 
            FROM parceiros p 
            LEFT JOIN usuarios u ON u.parceiro_id = p.id 
            ORDER BY p.id DESC
        `);
        res.json(d.rows);
    } catch (e) { 
        res.status(500).json({ erro: "Erro ao buscar parceiros." }); 
    }
});

app.post('/api/parceiros', async (req, res) => {
    try {
        // Recebe e-mail E usuario
        const { nome_loja, responsavel, telefone, email, usuario, senha } = req.body;

        const checkUser = await db.query('SELECT id FROM usuarios WHERE email = $1 OR usuario = $2', [email, usuario]);
        if (checkUser.rows.length > 0) return res.status(400).json({ erro: "E-mail ou Nome de Usuário já em uso!" });

        const novaLoja = await db.query(
            `INSERT INTO parceiros (nome_loja, responsavel, telefone, status) 
             VALUES ($1, $2, $3, 'ATIVO') RETURNING id`, 
            [nome_loja, responsavel, telefone]
        );

        const parceiro_id = novaLoja.rows[0].id;
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(senha, salt);
        
        await db.query(
            `INSERT INTO usuarios (nome, email, usuario, senha_hash, perfil, parceiro_id, ativo) 
             VALUES ($1, $2, $3, $4, 'PARCEIRO', $5, true)`, 
            [responsavel, email, usuario, hash, parceiro_id]
        );

        res.status(201).json({ mensagem: "✅ Parceiro cadastrado com sucesso!" });
    } catch (erro) {
        res.status(500).json({ erro: "Erro interno: " + erro.message });
    }
});

app.post('/api/parceiros/solicitar', async (req, res) => {
    try {
        const { nome_loja, responsavel, telefone, email_login, senha_login } = req.body;

        const check = await db.query('SELECT id FROM usuarios WHERE email = $1', [email_login]);
        if (check.rows.length > 0) return res.status(400).json({ erro: "Este e-mail já está em uso!" });

        const novaLoja = await db.query(
            `INSERT INTO parceiros (nome_loja, responsavel, telefone, status) 
             VALUES ($1, $2, $3, 'PENDENTE') RETURNING id`, 
            [nome_loja, responsavel, telefone]
        );

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(senha_login, salt);
        
        // Cadastra sem usuario definido (apenas e-mail) até o admin aprovar e criar um
        await db.query(
            `INSERT INTO usuarios (nome, email, senha_hash, perfil, parceiro_id, ativo) 
             VALUES ($1, $2, $3, 'PARCEIRO', $4, false)`, 
            [responsavel, email_login, hash, novaLoja.rows[0].id]
        );

        res.status(201).json({ mensagem: "✅ Solicitação enviada! Aguarde nossa análise." });
    } catch (erro) {
        res.status(500).json({ erro: "Erro interno ao enviar solicitação." });
    }
});

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

        if (status === 'ATIVO') {
            await db.query('UPDATE usuarios SET ativo = true WHERE parceiro_id = $1', [id]);
        }

        res.json({ mensagem: "✅ Loja atualizada com sucesso!", dados: resultado.rows[0] });
    } catch (erro) {
        res.status(500).json({ erro: "Erro interno: " + erro.message });
    }
});

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

app.get('/api/consignacoes/:parceiro_id', async (req, res) => {
    try {
        // CORREÇÃO: Agora a query devolve o "p.id as produto_id" para a frente de caixa saber de quem abater
        const query = `
            SELECT c.id, p.id as produto_id, p.nome as produto_nome, v.variacao, v.preco_repasse, c.quantidade_atual, c.variacao_id, p.imagem_url
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

app.post('/api/consignacoes', async (req, res) => {
    try {
        const { parceiro_id, produto_id, quantidade } = req.body;
        const qtd = parseInt(quantidade);

        const vRes = await db.query(`SELECT id, estoque_central FROM produto_variacoes WHERE produto_id = $1`, [produto_id]);
        if (vRes.rows.length === 0) return res.status(404).json({ erro: "Produto não encontrado." });
        
        const vId = vRes.rows[0].id;
        if (vRes.rows[0].estoque_central < qtd) return res.status(400).json({ erro: "Estoque central insuficiente!" });

        await db.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [qtd, vId]);

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

app.post('/api/consignacoes/lote', async (req, res) => {
    try {
        const { parceiro_id, itens } = req.body; 

        if (!itens || itens.length === 0) return res.status(400).json({ erro: "A lista de remessa está vazia." });

        await db.query('BEGIN');

        for (let item of itens) {
            const qtd = parseInt(item.quantidade);
            const vRes = await db.query(`SELECT id, estoque_central FROM produto_variacoes WHERE produto_id = $1`, [item.produto_id]);
            if (vRes.rows.length === 0) throw new Error(`Produto ID ${item.produto_id} não encontrado.`);
            if (vRes.rows[0].estoque_central < qtd) throw new Error(`Estoque central insuficiente.`);
            
            const vId = vRes.rows[0].id;
            await db.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [qtd, vId]);

            const ex = await db.query('SELECT id FROM consignacoes_estoque WHERE parceiro_id = $1 AND variacao_id = $2', [parceiro_id, vId]);

            if (ex.rows.length > 0) {
                await db.query('UPDATE consignacoes_estoque SET quantidade_atual = quantidade_atual + $1, quantidade_enviada = quantidade_enviada + $1 WHERE id = $2', [qtd, ex.rows[0].id]);
            } else {
                await db.query('INSERT INTO consignacoes_estoque (parceiro_id, variacao_id, quantidade_enviada, quantidade_atual) VALUES ($1, $2, $3, $3)', [parceiro_id, vId, qtd]);
            }
        }

        await db.query('COMMIT');
        res.status(201).json({ mensagem: "📦 Remessa em lote enviada com sucesso!" });

    } catch (e) {
        await db.query('ROLLBACK');
        res.status(400).json({ erro: e.message });
    }
});

app.put('/api/consignacoes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nova_quantidade } = req.body;

        const rem = await db.query('SELECT variacao_id, quantidade_atual FROM consignacoes_estoque WHERE id = $1', [id]);
        if (rem.rows.length === 0) return res.status(404).json({ erro: "Remessa não encontrada." });

        const { variacao_id, quantidade_atual } = rem.rows[0];
        const diferenca = nova_quantidade - quantidade_atual;

        if (diferenca > 0) {
            const centro = await db.query('SELECT estoque_central FROM produto_variacoes WHERE id = $1', [variacao_id]);
            if (centro.rows[0].estoque_central < diferenca) return res.status(400).json({ erro: "Estoque central insuficiente para este ajuste!" });
        }

        await db.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [diferenca, variacao_id]);
        await db.query('UPDATE consignacoes_estoque SET quantidade_atual = $1 WHERE id = $2', [nova_quantidade, id]);

        res.json({ mensagem: "✅ Quantidade ajustada!" });
    } catch (e) {
        res.status(500).json({ erro: "Erro no ajuste." });
    }
});

app.delete('/api/consignacoes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const rem = await db.query('SELECT variacao_id, quantidade_atual FROM consignacoes_estoque WHERE id = $1', [id]);
        if (rem.rows.length === 0) return res.status(404).json({ erro: "Remessa não encontrada." });

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

app.post('/api/vendas', async (req, res) => {
    try {
        const { produto_id, quantidade, parceiro_id } = req.body;
        const auth = req.headers.authorization;
        if (!auth) return res.status(401).json({ erro: "Não autorizado." });

        const user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        const qtd = parseInt(quantidade);

        const info = await db.query(`
            SELECT v.id, v.preco_venda, v.preco_repasse, v.estoque_central 
            FROM produto_variacoes v 
            WHERE v.produto_id = $1`, [produto_id]);
        
        if (info.rows.length === 0) return res.status(404).json({ erro: "Produto não encontrado." });
        const v = info.rows[0];

        let pIdFinal = (user.perfil === 'PARCEIRO') ? user.parceiro_id : (parceiro_id || null);
        let valorVenda = 0;

        if (pIdFinal) {
            const estLoja = await db.query(
                'SELECT id, quantidade_atual FROM consignacoes_estoque WHERE parceiro_id = $1 AND variacao_id = $2', 
                [pIdFinal, v.id]
            );

            if (estLoja.rows.length === 0 || estLoja.rows[0].quantidade_atual < qtd) {
                return res.status(400).json({ erro: "Estoque insuficiente na loja parceira!" });
            }

            await db.query('UPDATE consignacoes_estoque SET quantidade_atual = quantidade_atual - $1, quantidade_vendida = quantidade_vendida + $1 WHERE id = $2', [qtd, estLoja.rows[0].id]);
            valorVenda = v.preco_repasse * qtd; 
        } else {
            if (v.estoque_central < qtd) return res.status(400).json({ erro: "Estoque central insuficiente!" });
            
            await db.query('UPDATE produto_variacoes SET estoque_central = estoque_central - $1 WHERE id = $2', [qtd, v.id]);
            valorVenda = v.preco_venda * qtd; 
        }

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

app.get('/api/vendas', async (req, res) => {
    try {
        const query = `
            SELECT v.id, v.quantidade, v.valor_total, 
                   TO_CHAR(v.data_venda, 'DD/MM/YYYY HH24:MI') as data_formatada, 
                   p.nome as produto_nome, p.imagem_url, var.variacao, 
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

app.delete('/api/vendas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const vRes = await db.query('SELECT * FROM vendas WHERE id = $1', [id]);
        if (vRes.rows.length === 0) return res.status(404).json({ erro: "Venda não encontrada." });

        const venda = vRes.rows[0];

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
        const vMes = await db.query(`
            SELECT COUNT(*) as total_pedidos, COALESCE(SUM(valor_total), 0) as receita_total 
            FROM vendas 
            WHERE EXTRACT(MONTH FROM data_venda) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM data_venda) = EXTRACT(YEAR FROM CURRENT_DATE)`);

        const estoquePatrimonio = await db.query(`
            SELECT 
                SUM(estoque_central) as qtd_total_central,
                SUM(estoque_central * custo_producao) as valor_total_custo
            FROM produto_variacoes`);

        const estoquePorParceiro = await db.query(`
            SELECT 
                p.nome_loja, 
                COALESCE(SUM(c.quantidade_atual), 0) as total_produtos
            FROM parceiros p
            LEFT JOIN consignacoes_estoque c ON p.id = c.parceiro_id
            GROUP BY p.nome_loja
            ORDER BY total_produtos DESC`);

        const eBaixo = await db.query(`
            SELECT p.nome, v.estoque_central, v.variacao 
            FROM produto_variacoes v 
            JOIN produtos p ON p.id = v.produto_id 
            WHERE v.estoque_central < 5 
            ORDER BY v.estoque_central ASC LIMIT 4`);

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