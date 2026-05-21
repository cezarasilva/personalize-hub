document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formReg');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnReg');
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        App.setMsg('mensagem', '⏳ Enviando solicitação...', 'muted');
        try {
            const dados = await App.api('/parceiros/solicitar', { method: 'POST', body: JSON.stringify(App.formDataToObject(form)) });
            App.setMsg('mensagem', `✅ ${dados.mensagem}`, 'success');
            form.reset();
        } catch (err) {
            App.setMsg('mensagem', `❌ ${err.message}`, 'danger');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Enviar solicitação';
        }
    });
});
