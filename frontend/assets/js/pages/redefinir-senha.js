document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const form = document.getElementById('formReset');
    if (!token) {
        form.classList.add('hidden');
        App.setMsg('mensagem', ' Link inválido ou ausente. Solicite a recuperação novamente.', 'danger');
        return;
    }
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const novaSenha = document.getElementById('novaSenha').value;
        const confirmaSenha = document.getElementById('confirmaSenha').value;
        if (novaSenha !== confirmaSenha) return App.setMsg('mensagem', ' As senhas não conferem.', 'danger');
        const btn = document.getElementById('btnSalvar');
        btn.disabled = true;
        btn.textContent = 'Salvando...';
        try {
            const dados = await App.api('/usuarios/reset-password', { method: 'POST', body: JSON.stringify({ token, novaSenha }) });
            App.setMsg('mensagem', ` ${dados.mensagem}`, 'success');
            setTimeout(() => window.location.href = 'index.html', 1800);
        } catch (err) {
            App.setMsg('mensagem', ` ${err.message}`, 'danger');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Salvar senha';
        }
    });
});
