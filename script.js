// ================== SUPABASE INIT ==================
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================== ESTADO GLOBAL ==================
let currentDate = new Date();
let currentUser = null;      // usuário autenticado (auth.users)
let currentProfile = null;   // { id, family_id, name, role }
let currentFamily = null;    // { id, name, invite_code }

let financeData = {
    entradas: [],
    saidas: [],
    investimentos: [],
    historico: []
};

let currentCategoryFilter = 'TODAS';
let chartInstance = null;
let realtimeChannel = null;
let cadastroFamilyMode = 'nova';
let onboardingFamilyMode = 'nova';

// ================== BOOT ==================
document.addEventListener('DOMContentLoaded', () => {
    setupAuthTabs();
    setupAuthForms();
    setupFamilyModeToggles();
    initMonthPicker();
    setupTabs();
    setupEvents();
    schedule19hNotification();
    checkSession();

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            showAuthScreen();
        }
    });
});

async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await onAuthenticated(session.user);
    } else {
        showAuthScreen();
    }
}

// ================== TELAS (mostrar/esconder) ==================
function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('app-root').classList.add('hidden');
}
function showOnboardingScreen() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('onboarding-screen').classList.remove('hidden');
    document.getElementById('app-root').classList.add('hidden');
}
function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('app-root').classList.remove('hidden');
}

function setAuthMessage(kind, msg) {
    const err = document.getElementById('auth-error');
    const ok = document.getElementById('auth-success');
    err.style.display = 'none'; ok.style.display = 'none';
    if (kind === 'error') { err.innerText = msg; err.style.display = 'block'; }
    if (kind === 'success') { ok.innerText = msg; ok.style.display = 'block'; }
}
function setLoading(isLoading) {
    document.getElementById('auth-loading').style.display = isLoading ? 'block' : 'none';
}

// ================== ABAS DE LOGIN / CADASTRO ==================
function setupAuthTabs() {
    document.querySelectorAll('.auth-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`form-${btn.dataset.authtab}`).classList.add('active');
            setAuthMessage(null, '');
        });
    });
}

function setupFamilyModeToggles() {
    document.querySelectorAll('#form-cadastro .signup-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#form-cadastro .signup-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            cadastroFamilyMode = btn.dataset.mode;
            document.getElementById('cad-familia-nome').classList.toggle('hidden', cadastroFamilyMode !== 'nova');
            document.getElementById('cad-familia-codigo').classList.toggle('hidden', cadastroFamilyMode !== 'entrar');
        });
    });
    document.querySelectorAll('#onboarding-screen .signup-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#onboarding-screen .signup-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            onboardingFamilyMode = btn.dataset.obmode;
            document.getElementById('ob-familia-nome').classList.toggle('hidden', onboardingFamilyMode !== 'nova');
            document.getElementById('ob-familia-codigo').classList.toggle('hidden', onboardingFamilyMode !== 'entrar');
        });
    });
}

// ================== FORMULÁRIOS DE AUTENTICAÇÃO ==================
function setupAuthForms() {
    document.getElementById('form-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        setAuthMessage(null, ''); setLoading(true);
        const email = document.getElementById('login-email').value.trim();
        const senha = document.getElementById('login-senha').value;
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
        setLoading(false);
        if (error) { setAuthMessage('error', traduzErro(error.message)); return; }
        await onAuthenticated(data.user);
    });

    document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
        e.preventDefault();
        setAuthMessage(null, '');

        if (cadastroFamilyMode === 'nova' && !document.getElementById('cad-familia-nome').value.trim()) {
            setAuthMessage('error', 'Informe o nome da sua família.'); return;
        }
        if (cadastroFamilyMode === 'entrar' && !document.getElementById('cad-familia-codigo').value.trim()) {
            setAuthMessage('error', 'Informe o código de convite recebido.'); return;
        }

        setLoading(true);
        const nome = document.getElementById('cad-nome').value.trim();
        const email = document.getElementById('cad-email').value.trim();
        const senha = document.getElementById('cad-senha').value;

        const { data, error } = await supabaseClient.auth.signUp({ email, password: senha });
        setLoading(false);

        if (error) { setAuthMessage('error', traduzErro(error.message)); return; }

        if (!data.session) {
            // Confirmação de e-mail está ativada no projeto
            setAuthMessage('success', 'Conta criada! Verifique seu e-mail para confirmar o cadastro e depois faça login para concluir o cadastro da família.');
            document.querySelector('[data-authtab="login"]').click();
            return;
        }

        // Sessão já ativa: concluir vínculo com a família agora
        currentUser = data.user;
        await concluirVinculoFamilia(cadastroFamilyMode, nome,
            document.getElementById('cad-familia-nome').value.trim(),
            document.getElementById('cad-familia-codigo').value.trim());
    });

    document.getElementById('form-onboarding').addEventListener('submit', async (e) => {
        e.preventDefault();
        document.getElementById('onboarding-error').style.display = 'none';
        const nome = document.getElementById('ob-nome').value.trim();
        await concluirVinculoFamilia(onboardingFamilyMode, nome,
            document.getElementById('ob-familia-nome').value.trim(),
            document.getElementById('ob-familia-codigo').value.trim(), true);
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
        if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
        await supabaseClient.auth.signOut();
        location.reload();
    });

    document.getElementById('invite-code-label').addEventListener('click', () => {
        if (currentFamily) {
            navigator.clipboard.writeText(currentFamily.invite_code).then(() => {
                alert(`Código copiado: ${currentFamily.invite_code}\nCompartilhe com os familiares para eles entrarem na mesma conta.`);
            });
        }
    });
}

function traduzErro(msg) {
    if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (msg.includes('already registered')) return 'Este e-mail já está cadastrado. Tente entrar.';
    if (msg.includes('Password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
    return msg;
}

async function concluirVinculoFamilia(mode, nome, familiaNome, familiaCodigo, isOnboarding = false) {
    let rpcResult;
    if (mode === 'nova') {
        rpcResult = await supabaseClient.rpc('create_family_and_join', { p_family_name: familiaNome, p_user_name: nome });
    } else {
        rpcResult = await supabaseClient.rpc('join_family_by_code', { p_code: familiaCodigo, p_user_name: nome });
    }
    if (rpcResult.error) {
        const msg = rpcResult.error.message.includes('inválido') ? 'Código de convite inválido.' : rpcResult.error.message;
        if (isOnboarding) {
            const el = document.getElementById('onboarding-error');
            el.innerText = msg; el.style.display = 'block';
        } else {
            setAuthMessage('error', msg);
        }
        return;
    }
    const { data: { user } } = await supabaseClient.auth.getUser();
    await onAuthenticated(user);
}

// ================== PÓS-LOGIN ==================
async function onAuthenticated(user) {
    currentUser = user;
    const { data: profile, error } = await supabaseClient
        .from('profiles').select('*').eq('id', user.id).maybeSingle();

    if (error) { console.error(error); showAuthScreen(); return; }

    if (!profile) {
        showOnboardingScreen();
        return;
    }

    currentProfile = profile;

    const { data: family } = await supabaseClient
        .from('families').select('*').eq('id', profile.family_id).maybeSingle();
    currentFamily = family;

    document.getElementById('family-name-label').innerText = family ? family.name : '-';
    document.getElementById('invite-code-label').innerText = `código: ${family ? family.invite_code : '----'}`;

    showApp();
    updateMonthDisplay();
    await loadAllData();
    renderAll();
    setupRealtime();
}

function setupRealtime() {
    if (!currentProfile) return;
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

    realtimeChannel = supabaseClient
        .channel('family-data-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'saidas', filter: `family_id=eq.${currentProfile.family_id}` }, refreshFromRealtime)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'entradas', filter: `family_id=eq.${currentProfile.family_id}` }, refreshFromRealtime)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'investimentos', filter: `family_id=eq.${currentProfile.family_id}` }, refreshFromRealtime)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'investimentos_historico', filter: `family_id=eq.${currentProfile.family_id}` }, refreshFromRealtime)
        .subscribe();
}

let refreshTimeout = null;
function refreshFromRealtime() {
    // debounce: evita várias atualizações seguidas quando um membro da família faz mudanças em lote
    clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(async () => {
        await loadAllData();
        renderAll();
    }, 400);
}

// ================== CARREGAR DADOS DO SUPABASE ==================
async function loadAllData() {
    if (!currentProfile) return;
    const familyId = currentProfile.family_id;

    const [saidasRes, entradasRes, investimentosRes, historicoRes] = await Promise.all([
        supabaseClient.from('saidas').select('*').eq('family_id', familyId).order('vencimento', { ascending: true }),
        supabaseClient.from('entradas').select('*').eq('family_id', familyId).order('data', { ascending: true }),
        supabaseClient.from('investimentos').select('*').eq('family_id', familyId).order('created_at', { ascending: true }),
        supabaseClient.from('investimentos_historico').select('*').eq('family_id', familyId).order('registrado_em', { ascending: true })
    ]);

    financeData.saidas = saidasRes.data || [];
    financeData.entradas = entradasRes.data || [];
    financeData.investimentos = investimentosRes.data || [];
    financeData.historico = historicoRes.data || [];
}

// ================== NOTIFICAÇÃO DAS 19H ==================
function schedule19hNotification() {
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 19 && now.getMinutes() === 0 && now.getSeconds() === 0) {
            if (Notification.permission === 'granted') {
                new Notification('📈 Hora de Atualizar seus Investimentos!', {
                    body: 'São 19:00. Atualize os valores dos seus ativos (CDB, FIIs, Ações, Forex) na sua planilha financeira.'
                });
            } else if (document.getElementById('app-root') && !document.getElementById('app-root').classList.contains('hidden')) {
                alert('📈 Lembrete 19:00: Hora de atualizar o valor dos seus investimentos!');
            }
        }
    }, 1000);
}

// ================== NAVEGAÇÃO DE MÊS / ABAS ==================
function initMonthPicker() {
    document.getElementById('prev-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        updateMonthDisplay(); renderAll();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        updateMonthDisplay(); renderAll();
    });
}

function updateMonthDisplay() {
    const months = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
    const text = `${months[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    document.getElementById('current-month-text').innerText = text;

    const yyyy = currentDate.getFullYear();
    const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
    document.getElementById('saida-vencimento').value = `${yyyy}-${mm}-10`;
    document.getElementById('entrada-data').value = `${yyyy}-${mm}-05`;
}

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            if (btn.dataset.tab === 'tab-investimentos') renderChartInvestimentos();
        });
    });
}

// ================== FORMULÁRIOS DA APLICAÇÃO ==================
function setupEvents() {
    document.getElementById('form-saida').addEventListener('submit', async (e) => {
        e.preventDefault();
        const desc = document.getElementById('saida-desc').value;
        const cat = document.getElementById('saida-cat').value;
        const valor = parseFloat(document.getElementById('saida-valor').value);
        const parcelas = parseInt(document.getElementById('saida-parcelas').value);
        const vencimento = new Date(document.getElementById('saida-vencimento').value + 'T00:00:00');

        const linhas = [];
        for (let i = 1; i <= parcelas; i++) {
            const dataParcela = new Date(vencimento);
            dataParcela.setMonth(dataParcela.getMonth() + (i - 1));
            linhas.push({
                family_id: currentProfile.family_id,
                created_by: currentProfile.id,
                descricao: desc,
                categoria: cat,
                valor: valor,
                parcela_atual: i,
                parcelas_total: parcelas,
                vencimento: dataParcela.toISOString().split('T')[0],
                status: 'pendente'
            });
        }
        const { error } = await supabaseClient.from('saidas').insert(linhas);
        if (error) { alert('Erro ao salvar: ' + error.message); return; }
        await loadAllData(); renderAll(); e.target.reset(); updateMonthDisplay();
    });

    document.getElementById('form-entrada').addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = parseFloat(document.getElementById('entrada-valor').value);
        const { error } = await supabaseClient.from('entradas').insert({
            family_id: currentProfile.family_id,
            created_by: currentProfile.id,
            descricao: document.getElementById('entrada-desc').value,
            valor: valor,
            data: document.getElementById('entrada-data').value,
            dizimo_valor: +(valor * 0.10).toFixed(2),
            primicias_valor: +(valor / 30).toFixed(2)
        });
        if (error) { alert('Erro ao salvar: ' + error.message); return; }
        await loadAllData(); renderAll(); e.target.reset(); updateMonthDisplay();
    });

    document.getElementById('form-investimento').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('inv-nome').value;
        const tipo = document.getElementById('inv-tipo').value;
        const aporte = parseFloat(document.getElementById('inv-aporte').value);
        const atual = parseFloat(document.getElementById('inv-atual').value);
        const hojeStr = new Date().toISOString().split('T')[0];

        const { data: novoInv, error } = await supabaseClient.from('investimentos').insert({
            family_id: currentProfile.family_id,
            created_by: currentProfile.id,
            nome, tipo, aporte, valor_atual: atual
        }).select().single();
        if (error) { alert('Erro ao salvar: ' + error.message); return; }

        await supabaseClient.from('investimentos_historico').insert({
            investimento_id: novoInv.id, family_id: currentProfile.family_id, valor: atual
        });

        await supabaseClient.from('saidas').insert({
            family_id: currentProfile.family_id,
            created_by: currentProfile.id,
            descricao: `Aporte: ${nome}`,
            categoria: 'Investimentos',
            valor: aporte,
            parcela_atual: 1, parcelas_total: 1,
            vencimento: hojeStr, status: 'pago', data_pagamento: hojeStr
        });

        await loadAllData(); renderAll(); e.target.reset();
        alert('Investimento cadastrado e valor descontado como Saída de Aporte!');
    });

    document.getElementById('close-modal-inv').onclick = () => document.getElementById('modal-att-inv').style.display = 'none';
    document.getElementById('close-modal-sacar').onclick = () => document.getElementById('modal-sacar-inv').style.display = 'none';

    document.getElementById('btn-salvar-att-inv').onclick = async () => {
        const id = document.getElementById('att-inv-id').value;
        const novoValor = parseFloat(document.getElementById('att-inv-valor').value);

        await supabaseClient.from('investimentos').update({ valor_atual: novoValor }).eq('id', id);
        await supabaseClient.from('investimentos_historico').insert({
            investimento_id: id, family_id: currentProfile.family_id, valor: novoValor
        });

        await loadAllData(); renderAll();
        document.getElementById('modal-att-inv').style.display = 'none';
    };

    document.getElementById('btn-confirmar-sacar').onclick = async () => {
        const id = document.getElementById('sacar-inv-id').value;
        const valorSacar = parseFloat(document.getElementById('sacar-inv-valor').value);
        const inv = financeData.investimentos.find(i => i.id === id);
        if (!inv) return;

        const novoAtual = Math.max(0, parseFloat(inv.valor_atual) - valorSacar);
        const novoAporte = Math.max(0, parseFloat(inv.aporte) - valorSacar);

        await supabaseClient.from('investimentos').update({ valor_atual: novoAtual, aporte: novoAporte }).eq('id', id);
        await supabaseClient.from('investimentos_historico').insert({
            investimento_id: id, family_id: currentProfile.family_id, valor: novoAtual
        });
        await supabaseClient.from('entradas').insert({
            family_id: currentProfile.family_id,
            created_by: currentProfile.id,
            descricao: `Resgate Investimento: ${inv.nome}`,
            valor: valorSacar,
            data: new Date().toISOString().split('T')[0],
            dizimo_valor: +(valorSacar * 0.10).toFixed(2),
            primicias_valor: +(valorSacar / 30).toFixed(2)
        });

        await loadAllData(); renderAll();
        document.getElementById('modal-sacar-inv').style.display = 'none';
        alert('Valor sacado com sucesso e lançado na sua aba de Entradas!');
    };

    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategoryFilter = btn.dataset.cat;
            renderSaidas();
        });
    });
}

// ================== RENDERIZAÇÃO ==================
function renderAll() {
    renderDashboard();
    renderSaidas();
    renderEntradas();
    renderInvestimentos();
    renderPagas();
}

function renderDashboard() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const entradasMes = financeData.entradas.filter(e => {
        const d = new Date(e.data + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month;
    });
    const totalEntradas = entradasMes.reduce((acc, cur) => acc + Number(cur.valor), 0);

    const pagasMes = financeData.saidas.filter(s => {
        if (s.status !== 'pago') return false;
        const d = new Date(s.vencimento + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month;
    });
    const totalPagas = pagasMes.reduce((acc, cur) => acc + Number(cur.valor), 0);

    const pendentesMes = financeData.saidas.filter(s => {
        if (s.status === 'pago') return false;
        const d = new Date(s.vencimento + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month;
    });
    const totalVencer = pendentesMes.reduce((acc, cur) => acc + Number(cur.valor), 0);

    const totalAporte = financeData.investimentos.reduce((a, b) => a + Number(b.aporte), 0);
    const totalAtual = financeData.investimentos.reduce((a, b) => a + Number(b.valor_atual), 0);
    const lucroGeralPct = totalAporte > 0 ? (((totalAtual - totalAporte) / totalAporte) * 100) : 0;

    document.getElementById('dash-saldo').innerText = formatR$(totalEntradas - totalPagas);
    document.getElementById('dash-pago').innerText = formatR$(totalPagas);
    document.getElementById('dash-vencer').innerText = formatR$(totalVencer);
    document.getElementById('dash-investido').innerText = formatR$(totalAtual);
    document.getElementById('dash-lucro-total').innerText = `${lucroGeralPct >= 0 ? '+' : ''}${lucroGeralPct.toFixed(2)}% de Lucro Acumulado`;
}

function renderSaidas() {
    const tbody = document.getElementById('lista-saidas-pendentes');
    tbody.innerHTML = '';
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

    const filtradas = financeData.saidas.filter(s => {
        if (s.status === 'pago') return false;
        const d = new Date(s.vencimento + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month && (currentCategoryFilter === 'TODAS' || s.categoria === currentCategoryFilter);
    });

    if (filtradas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888;">Nenhuma conta pendente neste mês!</td></tr>';
        return;
    }

    filtradas.forEach(s => {
        const d = new Date(s.vencimento + 'T00:00:00');
        const isVencida = d < hoje;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatData(s.vencimento)}</td>
            <td><strong>${s.descricao}</strong></td>
            <td>${s.categoria}</td>
            <td>${s.parcela_atual}/${s.parcelas_total}</td>
            <td class="val-red">${formatR$(s.valor)}</td>
            <td><span class="badge-status">${isVencida ? '🔴 VENCIDA' : '🔴 PENDENTE'}</span></td>
            <td><button class="btn-pay" onclick="pagarSaida('${s.id}')">PAGAR</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderEntradas() {
    const tbody = document.getElementById('lista-entradas');
    tbody.innerHTML = '';
    const year = currentDate.getFullYear(); const month = currentDate.getMonth();

    const entradasMes = financeData.entradas.filter(e => {
        const d = new Date(e.data + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month;
    });

    if (entradasMes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#888;">Nenhuma entrada cadastrada neste mês!</td></tr>';
        return;
    }

    entradasMes.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatData(e.data)}</td>
            <td><strong>${e.descricao}</strong></td>
            <td class="val-green">${formatR$(e.valor)}</td>
            <td>${formatR$(e.dizimo_valor)}</td>
            <td>${e.dizimo_status === 'devolvido' ? '<span class="badge-status badge-devolvido">✓ Devolvido</span>' : `<button class="btn-secondary" onclick="confirmarDizimo('${e.id}')">[ ] Confirmar Dízimo</button>`}</td>
            <td>${formatR$(e.primicias_valor)}</td>
            <td>${e.primicias_status === 'devolvido' ? '<span class="badge-status badge-devolvido">✓ Devolvido</span>' : `<button class="btn-secondary" onclick="confirmarPrimicias('${e.id}')">[ ] Confirmar Primícias</button>`}</td>
            <td><button class="btn-delete" onclick="deletarEntrada('${e.id}')">🗑️</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPagas() {
    const tbody = document.getElementById('lista-saidas-pagas');
    tbody.innerHTML = '';
    const year = currentDate.getFullYear(); const month = currentDate.getMonth();

    const pagas = financeData.saidas.filter(s => {
        if (s.status !== 'pago') return false;
        const d = new Date(s.vencimento + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month;
    });

    pagas.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatData(s.data_pagamento || s.vencimento)}</td>
            <td><strong>${s.descricao}</strong></td>
            <td>${s.categoria}</td>
            <td>${s.parcela_atual}/${s.parcelas_total}</td>
            <td class="val-blue">${formatR$(s.valor)}</td>
            <td><span class="badge-status">🔵 PAGO</span></td>
            <td><button class="btn-secondary" onclick="desfazerPagto('${s.id}')">Desfazer</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderInvestimentos() {
    const tbody = document.getElementById('lista-investimentos');
    tbody.innerHTML = '';

    if (financeData.investimentos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888;">Nenhum ativo de investimento cadastrado.</td></tr>';
        return;
    }

    financeData.investimentos.forEach(inv => {
        const aporte = Number(inv.aporte), atual = Number(inv.valor_atual);
        const lucroR$ = atual - aporte;
        const lucroPct = aporte > 0 ? ((lucroR$ / aporte) * 100) : 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${inv.nome}</strong></td>
            <td>${inv.tipo}</td>
            <td>${formatR$(aporte)}</td>
            <td><strong>${formatR$(atual)}</strong></td>
            <td class="${lucroR$ >= 0 ? 'val-green' : 'val-red'}">${lucroR$ >= 0 ? '+' : ''}${formatR$(lucroR$)}</td>
            <td class="${lucroPct >= 0 ? 'val-green' : 'val-red'}"><strong>${lucroPct >= 0 ? '+' : ''}${lucroPct.toFixed(2)}%</strong></td>
            <td>
                <button class="btn-secondary" onclick="abrirModalAtt('${inv.id}')">🔄 Atualizar (19h)</button>
                <button class="btn-purple" onclick="abrirModalSacar('${inv.id}')">💸 Sacar para Entrada</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderChartInvestimentos();
}

function renderChartInvestimentos() {
    const ctx = document.getElementById('chart-investimentos');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();

    // Monta a evolução real com base no histórico salvo no Supabase
    const porInvestimento = {};
    financeData.investimentos.forEach(inv => { porInvestimento[inv.id] = { valor: Number(inv.aporte), aporte: Number(inv.aporte) }; });

    const historicoOrdenado = [...financeData.historico].sort((a, b) => new Date(a.registrado_em) - new Date(b.registrado_em));

    const pontosPorDia = {};
    historicoOrdenado.forEach(h => {
        if (!(h.investimento_id in porInvestimento)) porInvestimento[h.investimento_id] = { valor: 0, aporte: 0 };
        porInvestimento[h.investimento_id].valor = Number(h.valor);
        const diaKey = h.registrado_em.split('T')[0];
        const totalAtual = Object.values(porInvestimento).reduce((a, b) => a + b.valor, 0);
        const totalAporte = financeData.investimentos.reduce((a, b) => a + Number(b.aporte), 0);
        pontosPorDia[diaKey] = totalAporte > 0 ? ((totalAtual - totalAporte) / totalAporte) * 100 : 0;
    });

    let labels = Object.keys(pontosPorDia);
    let valores = Object.values(pontosPorDia);

    if (labels.length === 0 && financeData.investimentos.length > 0) {
        const totalAporte = financeData.investimentos.reduce((a, b) => a + Number(b.aporte), 0);
        const totalAtual = financeData.investimentos.reduce((a, b) => a + Number(b.valor_atual), 0);
        const pct = totalAporte > 0 ? ((totalAtual - totalAporte) / totalAporte) * 100 : 0;
        labels = ['Hoje']; valores = [pct];
    }

    // Limita aos últimos 12 pontos para não poluir o gráfico
    labels = labels.slice(-12).map(d => { const [y, m, dd] = d.split('-'); return `${dd}/${m}`; });
    valores = valores.slice(-12);

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Evolução % de Lucro da Carteira',
                data: valores,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderWidth: 3, fill: true, tension: 0.3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true } },
            scales: { y: { ticks: { callback: (val) => val + '%' } } }
        }
    });
}

// ================== AÇÕES ==================
function abrirModalAtt(id) {
    const inv = financeData.investimentos.find(i => i.id === id);
    if (inv) {
        document.getElementById('att-inv-id').value = id;
        document.getElementById('att-inv-label').innerText = `Novo Valor Atual das 19h para: ${inv.nome}`;
        document.getElementById('att-inv-valor').value = inv.valor_atual;
        document.getElementById('modal-att-inv').style.display = 'flex';
    }
}
function abrirModalSacar(id) {
    const inv = financeData.investimentos.find(i => i.id === id);
    if (inv) {
        document.getElementById('sacar-inv-id').value = id;
        document.getElementById('sacar-inv-valor').value = inv.valor_atual;
        document.getElementById('modal-sacar-inv').style.display = 'flex';
    }
}

async function pagarSaida(id) {
    await supabaseClient.from('saidas').update({ status: 'pago', data_pagamento: new Date().toISOString().split('T')[0] }).eq('id', id);
    await loadAllData(); renderAll();
}
async function desfazerPagto(id) {
    await supabaseClient.from('saidas').update({ status: 'pendente', data_pagamento: null }).eq('id', id);
    await loadAllData(); renderAll();
}
async function deletarEntrada(id) {
    if (!confirm('Excluir esta entrada?')) return;
    await supabaseClient.from('entradas').delete().eq('id', id);
    await loadAllData(); renderAll();
}

async function confirmarDizimo(id) {
    const e = financeData.entradas.find(x => x.id === id);
    if (!e) return;
    await supabaseClient.from('entradas').update({ dizimo_status: 'devolvido' }).eq('id', id);
    await supabaseClient.from('saidas').insert({
        family_id: currentProfile.family_id, created_by: currentProfile.id,
        descricao: `Dízimo (${e.descricao})`, categoria: 'Dízimos/Ofertas',
        valor: e.dizimo_valor, parcela_atual: 1, parcelas_total: 1,
        vencimento: e.data, status: 'pago', data_pagamento: new Date().toISOString().split('T')[0]
    });
    await loadAllData(); renderAll();
}

async function confirmarPrimicias(id) {
    const e = financeData.entradas.find(x => x.id === id);
    if (!e) return;
    await supabaseClient.from('entradas').update({ primicias_status: 'devolvido' }).eq('id', id);
    await supabaseClient.from('saidas').insert({
        family_id: currentProfile.family_id, created_by: currentProfile.id,
        descricao: `Primícias (${e.descricao})`, categoria: 'Dízimos/Ofertas',
        valor: e.primicias_valor, parcela_atual: 1, parcelas_total: 1,
        vencimento: e.data, status: 'pago', data_pagamento: new Date().toISOString().split('T')[0]
    });
    await loadAllData(); renderAll();
}

// ================== FORMATAÇÃO ==================
function formatR$(v) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatData(dStr) { if (!dStr) return '-'; const [y, m, d] = dStr.split('-'); return `${d}/${m}/${y}`; }
