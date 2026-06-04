document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('parceiros');
    let parceiros = [];
    let editando = null;

    const form = document.getElementById('formParceiro');
    const tabela = document.getElementById('tabelaParceiros');

    function limpar() {
        editando = null;
        form.reset();
        document.getElementById('parceiroId').value = '';
        document.getElementById('tituloFormParceiro').textContent = 'Nova loja parceira';
        document.getElementById('btnCancelarParceiro').classList.add('hidden');
        document.getElementById('senha').placeholder = 'Obrigatória no cadastro';
        document.getElementById('senha').required = true;
        document.getElementById('usuario').required = true;
        document.getElementById('email').disabled = false;
    }

    function payload() {
        return {
            nome_loja: document.getElementById('nome_loja').value,
            responsavel: document.getElementById('responsavel').value,
            telefone: document.getElementById('telefone').value,
            cnpj_cpf: document.getElementById('cnpj_cpf').value,
            email: document.getElementById('email').value,
            usuario: document.getElementById('usuario').value,
            senha: document.getElementById('senha').value,
            status: document.getElementById('status').value,
            cep: document.getElementById('cep').value,
            rua: document.getElementById('rua').value,
            numero: document.getElementById('numero').value,
            complemento: document.getElementById('complemento').value
        };
    }

    function render() {
        if (!parceiros.length) return tabela.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma loja encontrada.</td></tr>';
        tabela.innerHTML = parceiros.map(p => `<tr><td>${App.badgeStatus(p.status)}</td><td><strong>${App.escapeHtml(p.nome_loja)}</strong><br><small>${App.escapeHtml(p.cnpj_cpf || '')}</small></td><td>${App.escapeHtml(p.responsavel || '-')}</td><td>${App.escapeHtml(p.telefone || '-')}</td><td>${App.escapeHtml(p.usuario || p.email_login || '-')}</td><td><div class="actions"><button class="icon-btn" data-edit="${p.id}"><i class="bx bx-edit"></i></button><button class="icon-btn" data-del="${p.id}"><i class="bx bx-trash"></i></button></div></td></tr>`).join('');
    }

    async function carregar() { parceiros = await App.api('/parceiros'); render(); }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const dados = payload();
            if (editando) {
                delete dados.email;
                if (!dados.senha) delete dados.senha;
                await App.api(`/parceiros/${editando.id}`, { method: 'PUT', body: JSON.stringify(dados) });
                App.toast('success', 'Loja atualizada.');
            } else {
                await App.api('/parceiros', { method: 'POST', body: JSON.stringify(dados) });
                App.toast('success', 'Loja cadastrada.');
            }
            limpar();
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    });

    tabela.addEventListener('click', async (e) => {
        const edit = e.target.closest('[data-edit]')?.dataset.edit;
        const del = e.target.closest('[data-del]')?.dataset.del;
        if (edit) {
            const p = parceiros.find(x => String(x.id) === String(edit));
            editando = p;
            document.getElementById('parceiroId').value = p.id;
            ['nome_loja','responsavel','telefone','cnpj_cpf','status','cep','rua','numero','complemento'].forEach(id => document.getElementById(id).value = p[id] || '');
            document.getElementById('email').value = p.email_login || '';
            document.getElementById('email').disabled = true;
            document.getElementById('usuario').value = p.usuario || '';
            document.getElementById('usuario').required = false;
            document.getElementById('senha').value = '';
            document.getElementById('senha').required = false;
            document.getElementById('senha').placeholder = 'Não altera por aqui';
            document.getElementById('tituloFormParceiro').textContent = `Editando: ${p.nome_loja}`;
            document.getElementById('btnCancelarParceiro').classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        if (del) {
            const ok = await App.confirmDialog({ title: 'Excluir loja?', text: 'Vendas e consignações dessa loja também serão removidas.', confirmText: 'Excluir' });
            if (!ok.isConfirmed) return;
            try { await App.api(`/parceiros/${del}`, { method: 'DELETE' }); App.toast('success', 'Loja removida.'); await carregar(); }
            catch (err) { App.toast('error', err.message); }
        }
    });

    document.getElementById('btnCancelarParceiro').addEventListener('click', limpar);
    carregar().catch(err => App.toast('error', err.message));
});
