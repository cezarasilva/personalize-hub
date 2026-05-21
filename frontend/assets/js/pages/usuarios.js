document.addEventListener('DOMContentLoaded', () => {
    App.protectPage({ adminOnly: true });
    App.renderSidebar('usuarios');
    let usuarios = [];
    const tabela = document.getElementById('tabelaUsuarios');

    function render() {
        if (!usuarios.length) return tabela.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum usuário encontrado.</td></tr>';
        tabela.innerHTML = usuarios.map(u => `<tr><td><strong>${App.escapeHtml(u.nome)}</strong></td><td>${App.escapeHtml(u.email)}</td><td>${App.escapeHtml(u.usuario || '-')}</td><td><span class="badge badge-blue">${App.escapeHtml(u.perfil)}</span></td><td>${App.escapeHtml(u.nome_loja || '-')}</td><td>${u.ativo ? '<span class="badge badge-green">ATIVO</span>' : '<span class="badge badge-red">BLOQUEADO</span>'}</td><td><div class="actions"><button class="icon-btn" data-status="${u.id}">${u.ativo ? '🔒' : '🔓'}</button><button class="icon-btn" data-senha="${u.id}">🔑</button><button class="icon-btn" data-del="${u.id}">🗑️</button></div></td></tr>`).join('');
    }
    async function carregar() { usuarios = await App.api('/usuarios'); render(); }
    tabela.addEventListener('click', async (e) => {
        const statusId = e.target.closest('[data-status]')?.dataset.status;
        const senhaId = e.target.closest('[data-senha]')?.dataset.senha;
        const delId = e.target.closest('[data-del]')?.dataset.del;
        try {
            if (statusId) {
                const u = usuarios.find(x => String(x.id) === String(statusId));
                await App.api(`/usuarios/${statusId}`, { method: 'PUT', body: JSON.stringify({ ativo: !u.ativo }) });
                App.toast('success', 'Status atualizado.');
            }
            if (senhaId) {
                const result = await Swal.fire({ title: 'Nova senha', input: 'password', inputAttributes: { minlength: 6 }, showCancelButton: true, confirmButtonText: 'Alterar' });
                if (result.isConfirmed && result.value) { await App.api(`/usuarios/${senhaId}`, { method: 'PUT', body: JSON.stringify({ senha: result.value }) }); App.toast('success', 'Senha alterada.'); }
            }
            if (delId) {
                const ok = await App.confirmDialog({ title: 'Excluir usuário?', text: 'Admins não são removidos por segurança.', confirmText: 'Excluir' });
                if (ok.isConfirmed) { await App.api(`/usuarios/${delId}`, { method: 'DELETE' }); App.toast('success', 'Usuário removido.'); }
            }
            await carregar();
        } catch (err) { App.toast('error', err.message); }
    });
    carregar().catch(err => App.toast('error', err.message));
});
