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
let chartPizzaInstance = null;
let realtimeChannel = null;

// ================== BOOT ==================
document.addEventListener('DOMContentLoaded', () => {
    setupAuthTabs();
    setupAuthForms();
    setupCurrencyToggles();
    initMonthPicker();
    setupTabs();
    setupEvents();
    schedule19hNotification();
    if (!checkEmailConfirmation()) {
        checkSession();
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            showAuthScreen();
        }
    });
});

// Detecta o retorno do link de confirmação de e-mail e mostra uma mensagem clara.
// Retorna true se estava numa confirmação (para não seguir o fluxo normal de checkSession).
function checkEmailConfirmation() {
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const isConfirmacao = hash.includes('type=signup') || hash.includes('type=email_change') || params.get('type') === 'signup';
    if (isConfirmacao) {
        // Limpa a URL pra não ficar feio/confuso e força o usuário a logar de novo manualmente
        history.replaceState(null, '', window.location.pathname);
        supabaseClient.auth.signOut().finally(() => {
            showAuthScreen();
            document.querySelector('[data-authtab="login"]').click();
            setAuthMessage('success', '✅ Confirmação bem-sucedida! Seu e-mail foi verificado. Agora faça login para entrar no sistema.');
        });
        return true;
    }
    return false;
}

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

function setupCurrencyToggles() {
    // Mostra/esconde o campo de cotação do dólar no cadastro de investimento
    document.getElementById('inv-moeda').addEventListener('change', (e) => {
        const isUSD = e.target.value === 'USD';
        document.getElementById('grupo-inv-cotacao-compra').classList.toggle('hidden', !isUSD);
        document.getElementById('inv-cotacao-compra').required = isUSD;
        document.getElementById('label-inv-atual').innerText = isUSD ? 'Valor Atual Hoje (em US$)' : 'Valor Atual Hoje (R$)';
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

        setLoading(true);
        const nome = document.getElementById('cad-nome').value.trim();
        const email = document.getElementById('cad-email').value.trim();
        const senha = document.getElementById('cad-senha').value;

        const { data, error } = await supabaseClient.auth.signUp({
            email, password: senha,
            options: { emailRedirectTo: window.location.href }
        });
        setLoading(false);

        if (error) { setAuthMessage('error', traduzErro(error.message)); return; }

        if (!data.session) {
            // Confirmação de e-mail está ativada no projeto
            setAuthMessage('success', 'Conta criada! Verifique seu e-mail e clique no link de confirmação. Depois volte aqui e faça login.');
            document.querySelector('[data-authtab="login"]').click();
            return;
        }

        // Sessão já ativa (confirmação de e-mail desativada): concluir cadastro agora
        currentUser = data.user;
        await concluirCadastroFamilia(nome);
    });

    document.getElementById('form-onboarding').addEventListener('submit', async (e) => {
        e.preventDefault();
        document.getElementById('onboarding-error').style.display = 'none';
        const nome = document.getElementById('ob-nome').value.trim();
        await concluirCadastroFamilia(nome, true);
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
        if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
        await supabaseClient.auth.signOut();
        location.reload();
    });

}

function traduzErro(msg) {
    if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (msg.includes('already registered')) return 'Este e-mail já está cadastrado. Tente entrar.';
    if (msg.includes('Password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
    return msg;
}

async function concluirCadastroFamilia(nome, isOnboarding = false) {
    const rpcResult = await supabaseClient.rpc('create_family_and_join', { p_user_name: nome });
    if (rpcResult.error) {
        if (isOnboarding) {
            const el = document.getElementById('onboarding-error');
            el.innerText = rpcResult.error.message; el.style.display = 'block';
        } else {
            setAuthMessage('error', rpcResult.error.message);
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
    const hojeStr = new Date().toISOString().split('T')[0];
    document.getElementById('saida-vencimento').value = `${yyyy}-${mm}-10`;
    document.getElementById('saida-data-compra').value = hojeStr;
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
        const dataCompra = document.getElementById('saida-data-compra').value;
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
                data_compra: dataCompra,
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
        const moeda = document.getElementById('inv-moeda').value; // 'BRL' ou 'USD'
        const aporte = parseFloat(document.getElementById('inv-aporte').value); // sempre em R$ (dinheiro real gasto)
        const atual = parseFloat(document.getElementById('inv-atual').value); // na moeda do ativo
        const hojeStr = new Date().toISOString().split('T')[0];

        let cotacaoCompra = 1;
        let aporteReferencia = aporte; // aporte convertido pra moeda do ativo, base pro cálculo de lucro %
        if (moeda === 'USD') {
            cotacaoCompra = parseFloat(document.getElementById('inv-cotacao-compra').value);
            if (!cotacaoCompra || cotacaoCompra <= 0) { alert('Informe a cotação do dólar na compra.'); return; }
            aporteReferencia = aporte / cotacaoCompra;
        }

        const { data: novoInv, error } = await supabaseClient.from('investimentos').insert({
            family_id: currentProfile.family_id,
            created_by: currentProfile.id,
            nome, tipo, moeda, aporte,
            aporte_referencia: aporteReferencia,
            valor_atual: atual,
            cotacao_atual: cotacaoCompra
        }).select().single();
        if (error) { alert('Erro ao salvar: ' + error.message); return; }

        await supabaseClient.from('investimentos_historico').insert({
            investimento_id: novoInv.id, family_id: currentProfile.family_id, valor: atual, cotacao: cotacaoCompra
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
        const lucroDia = parseFloat(document.getElementById('att-inv-valor').value);
        const inv = financeData.investimentos.find(i => i.id === id);
        if (!inv) return;
        if (isNaN(lucroDia)) { alert('Informe o lucro ou prejuízo de hoje (pode ser negativo).'); return; }

        const novoValor = Number(inv.valor_atual) + lucroDia;

        await supabaseClient.from('investimentos').update({ valor_atual: novoValor }).eq('id', id);
        await supabaseClient.from('investimentos_historico').insert({
            investimento_id: id, family_id: currentProfile.family_id, valor: novoValor, cotacao: inv.cotacao_atual || 1
        });

        await loadAllData(); renderAll();
        document.getElementById('modal-att-inv').style.display = 'none';
    };

    document.getElementById('btn-confirmar-sacar').onclick = async () => {
        const id = document.getElementById('sacar-inv-id').value;
        const valorSacar = parseFloat(document.getElementById('sacar-inv-valor').value); // na moeda do ativo
        const inv = financeData.investimentos.find(i => i.id === id);
        if (!inv) return;

        const valorAtualAntes = parseFloat(inv.valor_atual);
        let valorEmReais = valorSacar; // valor que efetivamente entra na aba Entradas (sempre em R$)

        if (inv.moeda === 'USD') {
            valorEmReais = parseFloat(document.getElementById('sacar-inv-valor-reais').value);
            if (!valorEmReais || valorEmReais <= 0) { alert('Informe quanto você recebeu em R$ depois de converter.'); return; }
        }

        const proporcao = valorAtualAntes > 0 ? Math.min(1, valorSacar / valorAtualAntes) : 1;
        const novoAtual = Math.max(0, valorAtualAntes - valorSacar);
        const novoAporte = Math.max(0, parseFloat(inv.aporte) * (1 - proporcao));
        const novoAporteReferencia = Math.max(0, parseFloat(inv.aporte_referencia) * (1 - proporcao));

        await supabaseClient.from('investimentos').update({
            valor_atual: novoAtual, aporte: novoAporte, aporte_referencia: novoAporteReferencia
        }).eq('id', id);

        await supabaseClient.from('investimentos_historico').insert({
            investimento_id: id, family_id: currentProfile.family_id, valor: novoAtual, cotacao: inv.cotacao_atual || 1
        });
        await supabaseClient.from('entradas').insert({
            family_id: currentProfile.family_id,
            created_by: currentProfile.id,
            descricao: `Resgate Investimento: ${inv.nome}`,
            valor: valorEmReais,
            data: new Date().toISOString().split('T')[0],
            dizimo_valor: +(valorEmReais * 0.10).toFixed(2),
            primicias_valor: +(valorEmReais / 30).toFixed(2)
        });

        await loadAllData(); renderAll();
        document.getElementById('modal-sacar-inv').style.display = 'none';
        alert('Valor sacado com sucesso e lançado na sua aba de Entradas (em Real)!');
    };

    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategoryFilter = btn.dataset.cat;
            renderSaidas();
        });
    });

    // ===== MODAIS DE EDIÇÃO =====
    document.getElementById('close-modal-editar-saida').onclick = () => document.getElementById('modal-editar-saida').style.display = 'none';
    document.getElementById('close-modal-editar-entrada').onclick = () => document.getElementById('modal-editar-entrada').style.display = 'none';
    document.getElementById('close-modal-editar-investimento').onclick = () => document.getElementById('modal-editar-investimento').style.display = 'none';
    document.getElementById('close-modal-confirmar-retorno').onclick = () => document.getElementById('modal-confirmar-retorno').style.display = 'none';
    document.getElementById('btn-salvar-confirmar-retorno').onclick = salvarConfirmarRetorno;

    document.getElementById('btn-salvar-edicao-saida').onclick = async () => {
        const id = document.getElementById('edit-saida-id').value;
        const dataPagamento = document.getElementById('edit-saida-data-pagamento').value || null;
        const { error } = await supabaseClient.from('saidas').update({
            descricao: document.getElementById('edit-saida-desc').value,
            categoria: document.getElementById('edit-saida-cat').value,
            valor: parseFloat(document.getElementById('edit-saida-valor').value),
            data_compra: document.getElementById('edit-saida-data-compra').value,
            vencimento: document.getElementById('edit-saida-vencimento').value,
            data_pagamento: dataPagamento,
            status: dataPagamento ? 'pago' : 'pendente'
        }).eq('id', id);
        if (error) { alert('Erro ao salvar: ' + error.message); return; }
        await loadAllData(); renderAll();
        document.getElementById('modal-editar-saida').style.display = 'none';
    };

    document.getElementById('btn-salvar-edicao-entrada').onclick = async () => {
        const id = document.getElementById('edit-entrada-id').value;
        const valor = parseFloat(document.getElementById('edit-entrada-valor').value);
        const { error } = await supabaseClient.from('entradas').update({
            descricao: document.getElementById('edit-entrada-desc').value,
            valor: valor,
            data: document.getElementById('edit-entrada-data').value,
            dizimo_valor: +(valor * 0.10).toFixed(2),
            primicias_valor: +(valor / 30).toFixed(2)
        }).eq('id', id);
        if (error) { alert('Erro ao salvar: ' + error.message); return; }
        await loadAllData(); renderAll();
        document.getElementById('modal-editar-entrada').style.display = 'none';
    };

    document.getElementById('btn-salvar-edicao-investimento').onclick = async () => {
        const id = document.getElementById('edit-inv-id').value;
        const moeda = document.getElementById('edit-inv-moeda').value;
        const payload = {
            nome: document.getElementById('edit-inv-nome').value,
            tipo: document.getElementById('edit-inv-tipo').value,
            moeda: moeda,
            aporte: parseFloat(document.getElementById('edit-inv-aporte').value),
            aporte_referencia: parseFloat(document.getElementById('edit-inv-aporte-ref').value),
            valor_atual: parseFloat(document.getElementById('edit-inv-valor-atual').value)
        };
        if (moeda === 'USD') {
            payload.cotacao_atual = parseFloat(document.getElementById('edit-inv-cotacao').value) || 1;
        }
        const { error } = await supabaseClient.from('investimentos').update(payload).eq('id', id);
        if (error) { alert('Erro ao salvar: ' + error.message); return; }
        await loadAllData(); renderAll();
        document.getElementById('modal-editar-investimento').style.display = 'none';
    };

    document.getElementById('edit-inv-moeda').addEventListener('change', (e) => {
        document.getElementById('edit-inv-cotacao-group').style.display = e.target.value === 'USD' ? 'block' : 'none';
    });
}

// ===== ABRIR MODAIS DE EDIÇÃO =====
function abrirEdicaoSaida(id) {
    const s = financeData.saidas.find(x => x.id === id);
    if (!s) return;
    document.getElementById('edit-saida-id').value = s.id;
    document.getElementById('edit-saida-desc').value = s.descricao;
    document.getElementById('edit-saida-cat').value = s.categoria;
    document.getElementById('edit-saida-valor').value = s.valor;
    document.getElementById('edit-saida-data-compra').value = s.data_compra;
    document.getElementById('edit-saida-vencimento').value = s.vencimento;
    document.getElementById('edit-saida-data-pagamento').value = s.data_pagamento || '';
    document.getElementById('modal-editar-saida').style.display = 'flex';
}

function abrirEdicaoEntrada(id) {
    const en = financeData.entradas.find(x => x.id === id);
    if (!en) return;
    document.getElementById('edit-entrada-id').value = en.id;
    document.getElementById('edit-entrada-desc').value = en.descricao;
    document.getElementById('edit-entrada-valor').value = en.valor;
    document.getElementById('edit-entrada-data').value = en.data;
    document.getElementById('modal-editar-entrada').style.display = 'flex';
}

function abrirEdicaoInvestimento(id) {
    const inv = financeData.investimentos.find(x => x.id === id);
    if (!inv) return;
    document.getElementById('edit-inv-id').value = inv.id;
    document.getElementById('edit-inv-nome').value = inv.nome;
    document.getElementById('edit-inv-tipo').value = inv.tipo;
    document.getElementById('edit-inv-moeda').value = inv.moeda;
    document.getElementById('edit-inv-aporte').value = inv.aporte;
    document.getElementById('edit-inv-aporte-ref').value = inv.aporte_referencia;
    document.getElementById('edit-inv-valor-atual').value = inv.valor_atual;
    document.getElementById('edit-inv-cotacao').value = inv.cotacao_atual || '';
    document.getElementById('edit-inv-cotacao-group').style.display = inv.moeda === 'USD' ? 'block' : 'none';
    document.getElementById('modal-editar-investimento').style.display = 'flex';
}

async function deletarSaida(id) {
    if (!confirm('Excluir esta saída/despesa? Essa ação não pode ser desfeita.')) return;
    await supabaseClient.from('saidas').delete().eq('id', id);
    await loadAllData(); renderAll();
}

async function deletarInvestimento(id) {
    if (!confirm('Excluir este ativo de investimento? O histórico dele também será removido.')) return;
    await supabaseClient.from('investimentos').delete().eq('id', id);
    await loadAllData(); renderAll();
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

    // ===== SALDO DO MÊS ANTERIOR (carrega pro mês atual) =====
    const primeiroDiaMesAtual = new Date(year, month, 1);
    const mesAnterior = new Date(year, month - 1, 1);
    const anoAnt = mesAnterior.getFullYear();
    const mesAnt = mesAnterior.getMonth();

    const entradasMesAnterior = financeData.entradas.filter(e => {
        const d = new Date(e.data + 'T00:00:00');
        return d.getFullYear() === anoAnt && d.getMonth() === mesAnt;
    }).reduce((acc, cur) => acc + Number(cur.valor), 0);

    const pagasMesAnterior = financeData.saidas.filter(s => {
        if (s.status !== 'pago' || !s.data_pagamento) return false;
        const d = new Date(s.data_pagamento + 'T00:00:00');
        return d.getFullYear() === anoAnt && d.getMonth() === mesAnt;
    }).reduce((acc, cur) => acc + Number(cur.valor), 0);

    const saldoAnterior = entradasMesAnterior - pagasMesAnterior;

    const entradasMes = financeData.entradas.filter(e => {
        const d = new Date(e.data + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month;
    });
    const totalEntradas = entradasMes.reduce((acc, cur) => acc + Number(cur.valor), 0);

    const pagasMes = financeData.saidas.filter(s => {
        if (s.status !== 'pago' || !s.data_pagamento) return false;
        const d = new Date(s.data_pagamento + 'T00:00:00');
        return d.getFullYear() === year && d.getMonth() === month;
    });
    const totalPagas = pagasMes.reduce((acc, cur) => acc + Number(cur.valor), 0);

    // Pendentes = tudo que vence até o fim do mês atual e ainda não foi pago (inclui atrasadas de meses anteriores)
    const fimMesAtual = new Date(year, month + 1, 0);
    const pendentesMes = financeData.saidas.filter(s => {
        if (s.status === 'pago') return false;
        const d = new Date(s.vencimento + 'T00:00:00');
        return d <= fimMesAtual;
    });
    const totalVencer = pendentesMes.reduce((acc, cur) => acc + Number(cur.valor), 0);

    // Aporte é sempre em R$; valor atual é convertido pra R$ usando a última cotação informada (ativos em US$)
    const totalAporte = financeData.investimentos.reduce((a, b) => a + Number(b.aporte), 0);
    const totalAtualBRL = financeData.investimentos.reduce((a, b) => {
        const valor = Number(b.valor_atual);
        return a + (b.moeda === 'USD' ? valor * Number(b.cotacao_atual || 1) : valor);
    }, 0);
    const lucroGeralPct = totalAporte > 0 ? (((totalAtualBRL - totalAporte) / totalAporte) * 100) : 0;

    document.getElementById('dash-saldo-anterior').innerText = formatR$(saldoAnterior);
    document.getElementById('dash-saldo').innerText = formatR$(saldoAnterior + totalEntradas - totalPagas);
    document.getElementById('dash-pago').innerText = formatR$(totalPagas);
    document.getElementById('dash-vencer').innerText = formatR$(totalVencer);
    document.getElementById('dash-investido').innerText = formatR$(totalAtualBRL);
    document.getElementById('dash-lucro-total').innerText = `${lucroGeralPct >= 0 ? '+' : ''}${lucroGeralPct.toFixed(2)}% de Lucro Acumulado (em R$)`;
}

function renderSaidas() {
    const tbody = document.getElementById('lista-saidas-pendentes');
    tbody.innerHTML = '';
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const fimMesAtual = new Date(year, month + 1, 0);

    // Mostra: pendentes vencendo no mês selecionado + qualquer pendente de meses anteriores que ainda não foi paga
    const filtradas = financeData.saidas.filter(s => {
        if (s.status === 'pago') return false;
        const d = new Date(s.vencimento + 'T00:00:00');
        return d <= fimMesAtual && (currentCategoryFilter === 'TODAS' || s.categoria === currentCategoryFilter);
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
            <td>
                <button class="btn-pay" onclick="pagarSaida('${s.id}')">PAGAR</button>
                <button class="btn-secondary" onclick="abrirEdicaoSaida('${s.id}')">✏️</button>
                <button class="btn-delete" onclick="deletarSaida('${s.id}')">🗑️</button>
            </td>
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
            <td>${e.dizimo_status === 'devolvido' ? `<span class="badge-status badge-devolvido">✓ Devolvido${e.dizimo_data_pagamento ? ' em ' + formatData(e.dizimo_data_pagamento) : ''}</span>` : `<button class="btn-secondary" onclick="abrirConfirmarRetorno('${e.id}','dizimo')">[ ] Confirmar Dízimo</button>`}</td>
            <td>${formatR$(e.primicias_valor)}</td>
            <td>${e.primicias_status === 'devolvido' ? `<span class="badge-status badge-devolvido">✓ Devolvido${e.primicias_data_pagamento ? ' em ' + formatData(e.primicias_data_pagamento) : ''}</span>` : `<button class="btn-secondary" onclick="abrirConfirmarRetorno('${e.id}','primicias')">[ ] Confirmar Primícias</button>`}</td>
            <td>
                <button class="btn-secondary" onclick="abrirEdicaoEntrada('${e.id}')">✏️</button>
                <button class="btn-delete" onclick="deletarEntrada('${e.id}')">🗑️</button>
            </td>
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
        const d = new Date((s.data_pagamento || s.vencimento) + 'T00:00:00');
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
            <td>
                <button class="btn-secondary" onclick="desfazerPagto('${s.id}')">Desfazer</button>
                <button class="btn-secondary" onclick="abrirEdicaoSaida('${s.id}')">✏️</button>
                <button class="btn-delete" onclick="deletarSaida('${s.id}')">🗑️</button>
            </td>
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
        const aporteBRL = Number(inv.aporte); // sempre em R$ (dinheiro real gasto)
        const aporteRef = Number(inv.aporte_referencia); // na moeda do ativo
        const atual = Number(inv.valor_atual); // na moeda do ativo
        const lucroNativo = atual - aporteRef;
        const lucroPct = aporteRef > 0 ? ((lucroNativo / aporteRef) * 100) : 0;
        const moedaBadge = inv.moeda === 'USD' ? ' <span style="font-size:0.7rem;color:#8b5cf6;">(US$)</span>' : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${inv.nome}</strong>${moedaBadge}</td>
            <td>${inv.tipo}</td>
            <td>${formatR$(aporteBRL)}</td>
            <td><strong>${formatMoeda(atual, inv.moeda)}</strong></td>
            <td class="${lucroNativo >= 0 ? 'val-green' : 'val-red'}">${lucroNativo >= 0 ? '+' : ''}${formatMoeda(lucroNativo, inv.moeda)}</td>
            <td class="${lucroPct >= 0 ? 'val-green' : 'val-red'}"><strong>${lucroPct >= 0 ? '+' : ''}${lucroPct.toFixed(2)}%</strong></td>
            <td>
                <button class="btn-secondary" onclick="abrirModalAtt('${inv.id}')">🔄 Atualizar (19h)</button>
                <button class="btn-purple" onclick="abrirModalSacar('${inv.id}')">💸 Sacar para Entrada</button>
                <button class="btn-secondary" onclick="abrirEdicaoInvestimento('${inv.id}')">✏️</button>
                <button class="btn-delete" onclick="deletarInvestimento('${inv.id}')">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderChartInvestimentos();
    renderChartPizzaInvestimentos();
}

function renderChartPizzaInvestimentos() {
    const ctx = document.getElementById('chart-pizza-investimentos');
    if (!ctx) return;
    if (chartPizzaInstance) chartPizzaInstance.destroy();

    const invs = financeData.investimentos.filter(i => Number(i.aporte) > 0);

    if (invs.length === 0) {
        return;
    }

    const cores = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];

    const labels = invs.map(inv => {
        const aporteRef = Number(inv.aporte_referencia);
        const atual = Number(inv.valor_atual);
        const lucroPct = aporteRef > 0 ? ((atual - aporteRef) / aporteRef) * 100 : 0;
        return `${inv.nome} (${lucroPct >= 0 ? '+' : ''}${lucroPct.toFixed(1)}%)`;
    });
    // Fatia proporcional ao capital investido em R$ (dinheiro real que saiu do bolso)
    const valores = invs.map(inv => Number(inv.aporte));
    const totalAporte = valores.reduce((a, b) => a + b, 0);

    chartPizzaInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data: valores,
                backgroundColor: invs.map((_, i) => cores[i % cores.length]),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const pctCarteira = totalAporte > 0 ? (ctx.raw / totalAporte) * 100 : 0;
                            return `${formatR$(ctx.raw)} investidos (${pctCarteira.toFixed(1)}% da carteira)`;
                        }
                    }
                }
            }
        }
    });
}

function renderChartInvestimentos() {
    const ctx = document.getElementById('chart-investimentos');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();

    // Monta a evolução real com base no histórico salvo no Supabase (tudo convertido pra R$)
    const moedaPorInv = {};
    financeData.investimentos.forEach(inv => { moedaPorInv[inv.id] = inv.moeda; });

    const valorAtualBRL = {}; // último valor conhecido de cada ativo, já em R$
    const totalAporte = financeData.investimentos.reduce((a, b) => a + Number(b.aporte), 0);

    const historicoOrdenado = [...financeData.historico].sort((a, b) => new Date(a.registrado_em) - new Date(b.registrado_em));

    const pontosPorDia = {};
    historicoOrdenado.forEach(h => {
        const moeda = moedaPorInv[h.investimento_id] || 'BRL';
        valorAtualBRL[h.investimento_id] = moeda === 'USD' ? Number(h.valor) * Number(h.cotacao || 1) : Number(h.valor);
        const diaKey = h.registrado_em.split('T')[0];
        const totalAtual = Object.values(valorAtualBRL).reduce((a, b) => a + b, 0);
        pontosPorDia[diaKey] = totalAporte > 0 ? ((totalAtual - totalAporte) / totalAporte) * 100 : 0;
    });

    let labels = Object.keys(pontosPorDia);
    let valores = Object.values(pontosPorDia);

    if (labels.length === 0 && financeData.investimentos.length > 0) {
        const totalAtualBRL = financeData.investimentos.reduce((a, b) => {
            const v = Number(b.valor_atual);
            return a + (b.moeda === 'USD' ? v * Number(b.cotacao_atual || 1) : v);
        }, 0);
        const pct = totalAporte > 0 ? ((totalAtualBRL - totalAporte) / totalAporte) * 100 : 0;
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
        const isUSD = inv.moeda === 'USD';
        document.getElementById('att-inv-id').value = id;
        document.getElementById('att-inv-label').innerText = `Lucro/Prejuízo de Hoje: ${inv.nome} (${isUSD ? 'em US$' : 'em R$'})`;
        document.getElementById('att-inv-valor').value = '';
        document.getElementById('att-inv-valor-atual-texto').innerText = `Valor atual: ${formatMoeda(inv.valor_atual, inv.moeda)}`;
        document.getElementById('modal-att-inv').style.display = 'flex';
    }
}
function abrirModalSacar(id) {
    const inv = financeData.investimentos.find(i => i.id === id);
    if (inv) {
        const isUSD = inv.moeda === 'USD';
        document.getElementById('sacar-inv-id').value = id;
        document.getElementById('sacar-inv-label').innerText = isUSD ? 'Valor do Resgate (em US$)' : 'Valor do Resgate Total ou Parcial (R$)';
        document.getElementById('sacar-inv-valor').value = inv.valor_atual;
        document.getElementById('grupo-sacar-inv-reais').classList.toggle('hidden', !isUSD);
        document.getElementById('sacar-inv-valor-reais').required = isUSD;
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

function abrirConfirmarRetorno(id, tipo) {
    document.getElementById('confirmar-retorno-id').value = id;
    document.getElementById('confirmar-retorno-tipo').value = tipo;
    document.getElementById('titulo-confirmar-retorno').innerText = tipo === 'dizimo' ? '✏️ Confirmar Devolução do Dízimo' : '✏️ Confirmar Devolução das Primícias';
    document.getElementById('confirmar-retorno-data').value = new Date().toISOString().split('T')[0];
    document.getElementById('modal-confirmar-retorno').style.display = 'flex';
}

async function salvarConfirmarRetorno() {
    const id = document.getElementById('confirmar-retorno-id').value;
    const tipo = document.getElementById('confirmar-retorno-tipo').value;
    const dataEscolhida = document.getElementById('confirmar-retorno-data').value;
    if (!dataEscolhida) { alert('Escolha uma data.'); return; }

    const e = financeData.entradas.find(x => x.id === id);
    if (!e) return;

    if (tipo === 'dizimo') {
        await supabaseClient.from('entradas').update({ dizimo_status: 'devolvido', dizimo_data_pagamento: dataEscolhida }).eq('id', id);
        await supabaseClient.from('saidas').insert({
            family_id: currentProfile.family_id, created_by: currentProfile.id,
            descricao: `Dízimo (${e.descricao})`, categoria: 'Dízimos/Ofertas',
            valor: e.dizimo_valor, parcela_atual: 1, parcelas_total: 1,
            data_compra: dataEscolhida, vencimento: dataEscolhida, status: 'pago', data_pagamento: dataEscolhida
        });
    } else {
        await supabaseClient.from('entradas').update({ primicias_status: 'devolvido', primicias_data_pagamento: dataEscolhida }).eq('id', id);
        await supabaseClient.from('saidas').insert({
            family_id: currentProfile.family_id, created_by: currentProfile.id,
            descricao: `Primícias (${e.descricao})`, categoria: 'Dízimos/Ofertas',
            valor: e.primicias_valor, parcela_atual: 1, parcelas_total: 1,
            data_compra: dataEscolhida, vencimento: dataEscolhida, status: 'pago', data_pagamento: dataEscolhida
        });
    }
    document.getElementById('modal-confirmar-retorno').style.display = 'none';
    await loadAllData(); renderAll();
}

// ================== FORMATAÇÃO ==================
function formatR$(v) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatMoeda(v, moeda) {
    if (moeda === 'USD') return 'US$ ' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return formatR$(v);
}
function formatData(dStr) { if (!dStr) return '-'; const [y, m, d] = dStr.split('-'); return `${d}/${m}/${y}`; }
