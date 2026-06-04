const { Resend } = require('resend');

const FROM = process.env.RESEND_FROM || 'PERSONALIZE Hub <onboarding@resend.dev>';

function _resend() {
    return process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
}

function _base(titulo, corpo) {
    return `<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;color:#111827;">
  <h2 style="color:#2563eb;text-align:center;margin-bottom:4px;">PERSONALIZE Hub</h2>
  <p style="text-align:center;color:#6b7280;margin-top:0;">${titulo}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
  ${corpo}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;">PERSONALIZE Hub — Plataforma de gestão B2B</p>
</div>`;
}

async function enviarEmail(to, subject, html) {
    const resend = _resend();
    if (!resend) {
        console.warn(`⚠️  Email ignorado (RESEND_API_KEY ausente): ${subject} → ${to}`);
        return;
    }
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) throw new Error('Erro Resend: ' + (error.message || JSON.stringify(error)));
}

async function emailBoasVindas({ email, nome, usuario, nomeLoja }) {
    await enviarEmail(email, '🎉 Bem-vindo(a) ao PERSONALIZE Hub!', _base('Sua loja foi cadastrada!', `
        <p>Olá, <strong>${nome}</strong>!</p>
        <p>A loja <strong>${nomeLoja}</strong> foi cadastrada com sucesso no <strong>PERSONALIZE Hub</strong>.</p>
        <p><strong>Seus dados de acesso:</strong></p>
        <ul>
          <li>Usuário: <strong>${usuario || email}</strong></li>
          <li>E-mail: <strong>${email}</strong></li>
        </ul>
        <p>Acesse a plataforma para começar a gerenciar sua loja.</p>`));
}

async function emailParceiroAprovado({ email, nome, nomeLoja }) {
    await enviarEmail(email, '✅ Sua loja foi aprovada — PERSONALIZE Hub', _base('Loja aprovada!', `
        <p>Olá, <strong>${nome}</strong>!</p>
        <p>Sua loja <strong>${nomeLoja}</strong> foi <strong>aprovada</strong> e já está ativa na plataforma.</p>
        <ul>
          <li>Receba remessas de produtos em consignação</li>
          <li>Registre vendas e acompanhe comissões</li>
          <li>Visualize seu extrato financeiro</li>
        </ul>
        <p>Faça login para começar!</p>`));
}

async function emailRemessaEnviada({ email, nome, nomeLoja, codigo, itens, valorTotal }) {
    const linhas = (itens || []).map(i =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${i.nome}${i.variacao ? ' — ' + i.variacao : ''}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">${i.quantidade}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">R$ ${Number(i.total||0).toFixed(2).replace('.',',')}</td></tr>`
    ).join('');
    await enviarEmail(email, `📦 Remessa ${codigo} enviada — ${nomeLoja}`, _base('Nova remessa enviada', `
        <p>Olá, <strong>${nome}</strong>!</p>
        <p>Uma nova remessa foi enviada para a loja <strong>${nomeLoja}</strong>.</p>
        <p><strong>Código: ${codigo}</strong></p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:8px;text-align:left;font-size:13px;">Produto</th>
            <th style="padding:8px;text-align:center;font-size:13px;">Qtd</th>
            <th style="padding:8px;text-align:right;font-size:13px;">Valor</th>
          </tr></thead>
          <tbody>${linhas}</tbody>
          <tfoot><tr style="font-weight:bold;">
            <td colspan="2" style="padding:8px;">Total</td>
            <td style="padding:8px;text-align:right;">R$ ${Number(valorTotal||0).toFixed(2).replace('.',',')}</td>
          </tr></tfoot>
        </table>
        <p style="font-size:13px;color:#6b7280;">Acesse a plataforma para assinar o recebimento.</p>`));
}

async function emailNovoLead({ email, nome, nomeLoja, codigo, clienteNome, resumoProdutos, subtotal }) {
    await enviarEmail(email, `🛒 Novo pedido ${codigo} — ${nomeLoja}`, _base('Novo pedido pelo catálogo', `
        <p>Olá, <strong>${nome}</strong>!</p>
        <p>Um novo pedido chegou pelo catálogo da loja <strong>${nomeLoja}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:8px;">
          <tr><td style="padding:8px 12px;font-weight:bold;">Código</td><td style="padding:8px 12px;">${codigo}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;">Cliente</td><td style="padding:8px 12px;">${clienteNome || 'Não informado'}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;">Itens</td><td style="padding:8px 12px;">${resumoProdutos}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;">Valor estimado</td><td style="padding:8px 12px;">R$ ${Number(subtotal||0).toFixed(2).replace('.',',')}</td></tr>
        </table>
        <p style="font-size:13px;color:#6b7280;">Acesse a plataforma para ver os detalhes e entrar em contato com o cliente.</p>`));
}

module.exports = { enviarEmail, emailBoasVindas, emailParceiroAprovado, emailRemessaEnviada, emailNovoLead };
