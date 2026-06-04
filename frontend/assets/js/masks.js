window.Masks = (() => {
    // ---- CPF helpers ----
    function _validarCPF(d) {
        if (/^(\d)\1+$/.test(d)) return false;
        let s = 0;
        for (let i = 0; i < 9; i++) s += +d[i] * (10 - i);
        let r = 11 - (s % 11); if (r >= 10) r = 0;
        if (r !== +d[9]) return false;
        s = 0;
        for (let i = 0; i < 10; i++) s += +d[i] * (11 - i);
        r = 11 - (s % 11); if (r >= 10) r = 0;
        return r === +d[10];
    }

    // ---- CNPJ helpers ----
    function _validarCNPJ(d) {
        if (/^(\d)\1+$/.test(d)) return false;
        const calc = (str, w) => {
            const s = w.reduce((a, b, i) => a + +str[i] * b, 0);
            const r = 11 - (s % 11); return r < 2 ? 0 : r;
        };
        return calc(d, [5,4,3,2,9,8,7,6,5,4,3,2]) === +d[12]
            && calc(d, [6,5,4,3,2,9,8,7,6,5,4,3,2]) === +d[13];
    }

    // ---- Format functions (pure, no side-effects) ----
    function _fmtCpfCnpj(v) {
        v = String(v || '').replace(/\D/g, '').slice(0, 14);
        if (!v) return '';
        if (v.length <= 11)
            return v.replace(/(\d{3})(\d)/, '$1.$2')
                    .replace(/(\d{3})(\d)/, '$1.$2')
                    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        return v.replace(/(\d{2})(\d)/,   '$1.$2')
                .replace(/(\d{3})(\d)/,   '$1.$2')
                .replace(/(\d{3})(\d)/,   '$1/$2')
                .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    }

    function _fmtPhone(v) {
        v = String(v || '').replace(/\D/g, '').slice(0, 11);
        if (!v) return '';
        if (v.length > 10) return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
        if (v.length > 6)  return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
        if (v.length > 2)  return `(${v.slice(0,2)}) ${v.slice(2)}`;
        return `(${v}`;
    }

    function _fmtCep(v) {
        v = String(v || '').replace(/\D/g, '').slice(0, 8);
        return v.length > 5 ? `${v.slice(0,5)}-${v.slice(5)}` : v;
    }

    function _feedback(el, valid, empty) {
        el.classList.toggle('field-valid',   !empty && !!valid);
        el.classList.toggle('field-invalid', !empty && !valid);
        if (empty) el.classList.remove('field-valid', 'field-invalid');
    }

    // ---- Public: CPF / CNPJ ----
    function cpfCnpj(el) {
        if (!el) return;
        el.maxLength = 18;
        el.addEventListener('input', () => { el.value = _fmtCpfCnpj(el.value); });
        el.addEventListener('blur', () => {
            const d = el.value.replace(/\D/g, '');
            if (!d) { _feedback(el, false, true); return; }
            const ok = d.length === 11 ? _validarCPF(d)
                     : d.length === 14 ? _validarCNPJ(d)
                     : false;
            _feedback(el, ok, false);
        });
        el.addEventListener('focus', () => _feedback(el, false, true));
    }

    // ---- Public: Telefone / WhatsApp ----
    function phone(el) {
        if (!el) return;
        el.maxLength = 15;
        el.addEventListener('input', () => { el.value = _fmtPhone(el.value); });
        el.addEventListener('blur', () => {
            const d = el.value.replace(/\D/g, '');
            if (!d) { _feedback(el, false, true); return; }
            _feedback(el, d.length === 10 || d.length === 11, false);
        });
        el.addEventListener('focus', () => _feedback(el, false, true));
    }

    // ---- Public: CEP com autocomplete ViaCEP ----
    function cep(el, fields = {}) {
        if (!el) return;
        el.maxLength = 9;
        if (!el.placeholder) el.placeholder = '00000-000';
        el.addEventListener('input', () => { el.value = _fmtCep(el.value); });
        el.addEventListener('blur', async () => {
            const d = el.value.replace(/\D/g, '');
            _feedback(el, false, true);
            if (d.length !== 8) return;
            const saved = el.value;
            el.disabled = true;
            try {
                const resp = await fetch(`https://viacep.com.br/ws/${d}/json/`);
                const data = await resp.json();
                if (data.erro) { el.classList.add('field-invalid'); return; }
                el.classList.add('field-valid');
                const fill = (id, val) => {
                    if (!id || !val) return;
                    const t = document.getElementById(id)
                           || document.querySelector(`[name="${id}"]`);
                    if (t && !t.value) t.value = val;
                };
                fill(fields.rua,         data.logradouro);
                fill(fields.bairro,      data.bairro);
                fill(fields.cidade,      data.localidade);
                fill(fields.uf,          data.uf);
                fill(fields.complemento, data.complemento);
            } catch { /* sem conexão ou CEP inválido — ignora silenciosamente */ }
            finally { el.value = saved; el.disabled = false; }
        });
    }

    // ---- Reaplicar formatação em todos os campos já preenchidos ----
    function applyAll() {
        document.querySelectorAll('[data-mask]').forEach(el => {
            el.dispatchEvent(new Event('input'));
        });
    }

    // ---- Auto-inicializar via atributo data-mask ----
    function _autoInit() {
        document.querySelectorAll('[data-mask]').forEach(el => {
            const t = el.dataset.mask;
            if (t === 'phone')    phone(el);
            else if (t === 'cpfcnpj') cpfCnpj(el);
            else if (t === 'cep') cep(el, {
                rua:         el.dataset.cepRua,
                bairro:      el.dataset.cepBairro,
                cidade:      el.dataset.cepCidade,
                uf:          el.dataset.cepUf,
                complemento: el.dataset.cepComplemento,
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _autoInit);
    } else {
        _autoInit();
    }

    return { phone, cpfCnpj, cep, applyAll, format: { phone: _fmtPhone, cpfCnpj: _fmtCpfCnpj, cep: _fmtCep } };
})();
