const { Client, LocalAuth } = require('whatsapp-web.js');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// Configurações do Sistema
const NUMERO_SALAO = '5531999999999'; 
const NUMERO_ADMIN = '179778875347010@lid'; 
const CHAVE_PIX = '31999999999'; 
const NOME_PIX = 'Leonardo - Leo Du Corte';

const db = new sqlite3.Database('./agendamentos.db');

db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefone TEXT,
    nome TEXT,
    servico TEXT,
    data_hora TEXT,
    data_iso TEXT,
    data_fim_iso TEXT
)`);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: os.platform() === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined
    }
});

const sessoes = {};
let salaoFechado = { ativo: false, retorno: '' }; 

// Catálogo de Serviços com Valores Matemáticos para o Relatório
const SERVICOS = {
    '1': { nome: 'Corte', duracao: 60, preco: 'R$ 35', valorBase: 35 }, 
    '2': { nome: 'Barba', duracao: 40, preco: 'R$ 30', valorBase: 30 }, 
    '3': { nome: 'COMBO (Corte, Barba, Sobrancelha)', duracao: 60, preco: 'R$ 68', valorBase: 68 },
    '4': { nome: 'Química / Platinado', duracao: 120, preco: 'A partir de R$ 60', valorBase: 60 }
};

client.on('qr', async () => {
    try {
        setTimeout(async () => {
            const codigo = await client.requestPairingCode(NUMERO_SALAO);
            console.log(`\n📲 CÓDIGO DE EMPARELHAMENTO: ${codigo}\n`);
        }, 2000);
    } catch (error) {
        console.log('Erro ao gerar código:', error);
    }
});

// Cérebro do Calendário do Leo Du Corte
function obterHorarioFuncionamento(data) {
    const diaSemana = data.getDay(); 
    let inicio = 0, fim = 0;
    
    if (diaSemana >= 2 && diaSemana <= 4) { // Terça a Quinta
        inicio = 9; fim = 17;
    } else if (diaSemana === 5) { // Sexta
        inicio = 8; fim = 19;
    } else if (diaSemana === 6) { // Sábado
        inicio = 9; fim = 18;
    } else {
        return null; // Domingo e Segunda
    }
    return { inicio, fim };
}

// Inteligência de Datas Completa
function converterData(texto) {
    let textoFormatado = texto.toLowerCase().trim();
    const agora = new Date();
    const anoAtual = agora.getFullYear();
    const mesAtual = agora.getMonth(); 
    let dataCalculada = null;

    textoFormatado = textoFormatado.replace(/e meia/g, 'e 30');

    const matchExato = textoFormatado.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})$/);
    const meses = {'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3, 'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11};
    const matchTexto = textoFormatado.match(/(\d{1,2})\s*(?:de)?\s*([a-zç]+)\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);
    const matchRelativo = textoFormatado.match(/(hoje|amanhã|amanha)\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);
    const matchDireto = textoFormatado.match(/(?:dia\s*)?(\d{1,2})\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);

    if (matchExato) {
        dataCalculada = new Date(matchExato[3], matchExato[2] - 1, matchExato[1], matchExato[4], matchExato[5]);
    } else if (matchTexto && meses[matchTexto[2]] !== undefined) {
        dataCalculada = new Date(anoAtual, meses[matchTexto[2]], parseInt(matchTexto[1]), parseInt(matchTexto[3]), matchTexto[4] ? parseInt(matchTexto[4]) : 0);
    } else if (matchRelativo) {
        let diaAlvo = agora.getDate();
        if (matchRelativo[1] === 'amanhã' || matchRelativo[1] === 'amanha') diaAlvo += 1;
        dataCalculada = new Date(anoAtual, mesAtual, diaAlvo, parseInt(matchRelativo[2]), matchRelativo[3] ? parseInt(matchRelativo[3]) : 0);
    } else if (matchDireto) {
        let diaMarcado = parseInt(matchDireto[1]);
        let mesAlvo = mesAtual;
        if (diaMarcado < agora.getDate()) mesAlvo += 1; 
        dataCalculada = new Date(anoAtual, mesAlvo, diaMarcado, parseInt(matchDireto[2]), matchDireto[3] ? parseInt(matchDireto[3]) : 0);
    }

    if (dataCalculada) {
        let minutos = dataCalculada.getMinutes();
        if (minutos < 15) minutos = 0;
        else if (minutos < 45) minutos = 30;
        else { minutos = 0; dataCalculada.setHours(dataCalculada.getHours() + 1); }
        dataCalculada.setMinutes(minutos);
        dataCalculada.setSeconds(0);
        return dataCalculada;
    }
    return null;
}

function converterDataDia(texto) {
    let textoFormatado = texto.toLowerCase().trim();
    let agora = new Date();
    let anoAtual = agora.getFullYear();
    let mesAtual = agora.getMonth(); 
    let dataCalculada = null;

    const matchMesQueVem = textoFormatado.match(/m[eê]s q(?:ue)? vem dia (\d{1,2})/i);
    const matchExato = textoFormatado.match(/^(\d{1,2})\/(\d{1,2})/);
    const meses = {'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3, 'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11};
    const matchTexto = textoFormatado.match(/(\d{1,2})\s*(?:de)?\s*([a-zç]+)/i);
    const matchRelativo = textoFormatado.match(/(hoje|amanhã|amanha)/i);
    const matchDireto = textoFormatado.match(/(?:dia\s*)?(\d{1,2})/i);

    if (matchMesQueVem) {
        let mesAlvo = mesAtual + 1;
        if (mesAlvo > 11) { mesAlvo = 0; anoAtual += 1; }
        dataCalculada = new Date(anoAtual, mesAlvo, parseInt(matchMesQueVem[1]), 0, 0, 0);
    } else if (matchExato) {
        dataCalculada = new Date(anoAtual, matchExato[2] - 1, matchExato[1], 0, 0, 0);
    } else if (matchTexto && meses[matchTexto[2]] !== undefined) {
        dataCalculada = new Date(anoAtual, meses[matchTexto[2]], parseInt(matchTexto[1]), 0, 0, 0);
    } else if (matchRelativo) {
        let diaAlvo = agora.getDate();
        if (matchRelativo[1] === 'amanhã' || matchRelativo[1] === 'amanha') diaAlvo += 1;
        dataCalculada = new Date(anoAtual, mesAtual, diaAlvo, 0, 0, 0);
    } else if (matchDireto) {
        let diaMarcado = parseInt(matchDireto[1]);
        let mesAlvo = mesAtual;
        if (diaMarcado < agora.getDate()) mesAlvo += 1; 
        dataCalculada = new Date(anoAtual, mesAlvo, diaMarcado, 0, 0, 0);
    }
    return dataCalculada;
}

function verificarDisponibilidade(novaDataIso, novaDataFimIso) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT * FROM agendamentos WHERE 
            (data_iso < ? AND data_fim_iso > ?) OR 
            (data_iso >= ? AND data_iso < ?)
        `;
        db.get(query, [novaDataFimIso, novaDataIso, novaDataIso, novaDataFimIso], (err, row) => {
            if (err) reject(err);
            resolve(row ? false : true); 
        });
    });
}

client.on('ready', () => {
    console.log('🔴🔵 Sistema Leo bot online! Gestão Financeira Ativada.');

    // Disparo de lembretes automáticos às 08h
    cron.schedule('0 8 * * *', () => {
        db.all("SELECT telefone, nome, data_hora, data_iso FROM agendamentos", [], async (err, rows) => {
            if (err) return;
            const hoje = new Date();
            hoje.setHours(0,0,0,0);
            
            for (const row of rows) {
                const dataMarcada = new Date(row.data_iso);
                const diaMarcado = new Date(row.data_iso);
                diaMarcado.setHours(0,0,0,0);
                const dif = Math.ceil((diaMarcado.getTime() - hoje.getTime()) / (1000 * 3600 * 24));

                if (dif === 0) {
                    try { await client.sendMessage(row.telefone, `🔴 Lembrete Leo Du Corte 🔵\n\nOlá ${row.nome}, é HOJE o seu agendamento às ${dataMarcada.getHours()}h${dataMarcada.getMinutes()===0?'00':dataMarcada.getMinutes()}. Te esperamos!`); } catch(e){}
                }
            }
        });
    });
});

client.on('message_create', async (message) => {
    const texto = message.body.toLowerCase();
    
    // MÁGICA 1: O TRUQUE INVISÍVEL
    if (message.fromMe) {
        const chatIdAlvo = message.to; 
        const textoLimpo = texto.trim();
        
        const querPausar = textoLimpo.includes('assumir') || textoLimpo.includes('asumir') || textoLimpo === '!pausar';
        const querRetomar = textoLimpo.includes('retomar') || textoLimpo === '!despausar' || textoLimpo === 'voltar bot';

        if (querPausar) {
            if (!sessoes[chatIdAlvo]) sessoes[chatIdAlvo] = { etapa: 'inicio' };
            sessoes[chatIdAlvo].pausado = true;
        }
        else if (querRetomar) {
            if (sessoes[chatIdAlvo]) sessoes[chatIdAlvo].pausado = false;
        }
        return; 
    }

    const chatId = message.from;
    if (chatId.includes('@g.us')) return;

    // 🛑 TRAVA DE SALÃO FECHADO PELO ADMIN
    if (chatId !== NUMERO_ADMIN && salaoFechado.ativo) {
        if (!sessoes[chatId] || sessoes[chatId].etapa !== 'fechado') {
            if (!sessoes[chatId]) sessoes[chatId] = {};
            sessoes[chatId].etapa = 'fechado'; 
            
            if (salaoFechado.retorno) {
                await message.reply(`🛑 *Leo Du Corte informa:*\n\nInfelizmente nosso salão está fechado no momento.\nEstaremos de volta: *${salaoFechado.retorno}*!\n\nUm abraço e até breve! 💈`);
            } else {
                await message.reply(`🛑 *Leo Du Corte informa:*\n\nInfelizmente nosso salão está fechado no momento e não temos previsão de atendimento para hoje.\n\nUm abraço e até breve! 💈`);
            }
        }
        return; 
    }

    // A TRAVA DE SILÊNCIO
    if (sessoes[chatId] && sessoes[chatId].pausado) {
        return; 
    }

    // MÁGICA 2: PEDIDO DE SOCORRO DO CLIENTE
    if (texto.includes('atendente') || texto.includes('humano') || texto.includes('falar com o leo') || texto.includes('dúvida') || texto.includes('duvida')) {
        if (!sessoes[chatId]) sessoes[chatId] = { etapa: 'inicio' };
        sessoes[chatId].pausado = true; 
        
        await message.reply('👨‍💻 Entendi! Pausei meu sistema automático e já chamei o Leo. Logo ele te responde aqui mesmo.');
        try {
            await client.sendMessage(NUMERO_ADMIN, `⚠️ *PRECISA DE ATENDIMENTO!*\n\nO número ${chatId.replace(/[^0-9]/g, '')} pediu ajuda e o bot se auto-pausou nessa conversa.`);
        } catch (e) {}
        return;
    }

    // BLOCO ADMINISTRATIVO (Gestão Financeira e Grade)
    if (chatId === NUMERO_ADMIN) {
        
        // 📊 NOVO: COMANDO DE RELATÓRIO FINANCEIRO
        if (texto.startsWith('!relatorio')) {
            const periodo = texto.replace('!relatorio', '').trim() || 'hoje';
            const agora = new Date();
            let inicio, fim, titulo;

            if (periodo === 'mes' || periodo === 'mês') {
                inicio = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
                fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59).toISOString();
                titulo = 'MÊS ATUAL';
            } else if (periodo === 'semana') {
                const diaSemana = agora.getDay();
                const diff = agora.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1); // Ajusta pra segunda-feira
                const segunda = new Date(agora.setDate(diff));
                inicio = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate(), 0, 0, 0).toISOString();
                fim = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 6, 23, 59, 59).toISOString();
                titulo = 'ESTA SEMANA';
            } else {
                inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0).toISOString();
                fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59).toISOString();
                titulo = 'HOJE';
            }

            db.all("SELECT * FROM agendamentos WHERE data_iso >= ? AND data_iso <= ?", [inicio, fim], async (err, rows) => {
                if (err) return await message.reply('❌ Erro ao puxar relatório.');
                
                let totalCaixa = 0;
                let concluidos = 0;
                let pendentes = 0;

                rows.forEach(r => {
                    let valor = 0;
                    if (r.servico === 'Corte') valor = SERVICOS['1'].valorBase;
                    else if (r.servico === 'Barba') valor = SERVICOS['2'].valorBase;
                    else if (r.servico === 'COMBO (Corte, Barba, Sobrancelha)') valor = SERVICOS['3'].valorBase;
                    else if (r.servico === 'Química / Platinado') valor = SERVICOS['4'].valorBase;

                    totalCaixa += valor;

                    // Checa se o horário já passou (Concluído) ou se ainda vai acontecer
                    if (new Date(r.data_iso) < new Date()) concluidos++;
                    else pendentes++;
                });

                let msg = `📊 *BALANÇO - ${titulo}* 📊\n\n`;
                msg += `💰 *Faturamento Total:* R$ ${totalCaixa.toFixed(2).replace('.', ',')}\n\n`;
                msg += `✂️ *Total de Atendimentos:* ${rows.length}\n`;
                msg += `✅ *Já realizados:* ${concluidos}\n`;
                msg += `⏳ *Aguardando cliente:* ${pendentes}\n\n`;
                msg += `_(Lembrete: Se um cliente faltar, use o comando !apagar ID para ele não contar no faturamento)_`;

                await message.reply(msg);
            });
            return;
        }

        if (texto === '!fechar') {
            salaoFechado.ativo = true;
            salaoFechado.retorno = '';
            await message.reply(`🔒 *Salão Fechado!*\nA partir de agora, o bot avisará aos clientes que o salão está fechado.`);
            return;
        }
        if (texto.startsWith('!fechar ')) {
            const dataRetorno = message.body.substring(8).trim(); 
            salaoFechado.ativo = true;
            salaoFechado.retorno = dataRetorno;
            await message.reply(`🔒 *Salão Fechado!*\nA partir de agora, o bot avisará aos clientes que vocês estão fechados e retornam: *${dataRetorno}*.`);
            return;
        }
        if (texto === '!abrir') {
            salaoFechado.ativo = false;
            salaoFechado.retorno = '';
            await message.reply(`🔓 *Salão Aberto!*\nO bot voltou a atender e agendar normalmente.`);
            return;
        }
        if (texto === '!agenda') {
            const agoraAgenda = new Date().toISOString();
            db.all("SELECT * FROM agendamentos WHERE data_fim_iso >= ? ORDER BY data_iso ASC", [agoraAgenda], async (err, rows) => {
                if (err || rows.length === 0) return await message.reply('Nenhum agendamento futuro encontrado.');
                let lista = '*📋 AGENDA FUTURA:*\n\n';
                rows.forEach(r => { lista += `ID: ${r.id} | ${r.nome}\nServiço: ${r.servico}\nData/Hora: ${r.data_hora}\n\n`; });
                await message.reply(lista);
            });
            return;
        }
        if (texto === '!hoje' || texto === '!amanha' || texto === '!amanhã') {
            const alvo = new Date();
            if (texto.includes('amanh')) alvo.setDate(alvo.getDate() + 1);
            const inicio = new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate(), 0, 0, 0).toISOString();
            const fim = new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate(), 23, 59, 59).toISOString();
            const limiteAtual = new Date().toISOString();
            
            db.all("SELECT * FROM agendamentos WHERE data_iso >= ? AND data_iso <= ? AND data_fim_iso >= ? ORDER BY data_iso ASC", [inicio, fim, limiteAtual], async (err, rows) => {
                if (err || rows.length === 0) return await message.reply('Nenhum agendamento pendente para esta data.');
                let lista = texto === '!hoje' ? '*📅 PENDENTES DE HOJE:*\n\n' : '*📅 AGENDA DE AMANHÃ:*\n\n';
                rows.forEach(r => {
                    const hora = new Date(r.data_iso).getHours();
                    const min = new Date(r.data_iso).getMinutes() === 0 ? '00' : new Date(r.data_iso).getMinutes();
                    lista += `ID: ${r.id} | ⏰ ${hora}:${min}\nCliente: ${r.nome} (${r.servico})\n\n`;
                });
                await message.reply(lista);
            });
            return;
        }
        // Faxina manual foi mantida caso você queira zerar o banco um dia
        if (texto === '!limpar') {
            const agoraLimpar = new Date().toISOString();
            db.run(`DELETE FROM agendamentos WHERE data_fim_iso < ?`, [agoraLimpar], function(err) {
                message.reply(`🧹 *Limpeza manual concluída!*\n${this.changes} agendamentos passados foram excluídos (Isto afeta relatórios financeiros do passado).`);
            });
            return;
        }
        if (texto.startsWith('!apagar ')) {
            const id = texto.split(' ')[1];
            db.run(`DELETE FROM agendamentos WHERE id = ?`, [id], function(err) {
                message.reply(`✅ Agendamento ID ${id} cancelado/removido do sistema.`);
            });
            return;
        }
        if (texto.startsWith('!reagendar ')) {
            const partes = message.body.split(' ');
            const id = partes[1];
            const novoTextoData = partes.slice(2).join(' ');

            if (!id || !novoTextoData) return await message.reply('⚠️ Formato incorreto. Use: *!reagendar [ID] [Nova Data]*');

            db.get(`SELECT * FROM agendamentos WHERE id = ?`, [id], async (err, row) => {
                if (err || !row) return await message.reply(`❌ Agendamento ID ${id} não encontrado.`);

                const novaDataValidada = converterData(novoTextoData);
                if (!novaDataValidada) return await message.reply('⚠️ Não entendi a nova data.');
                
                const horarioFunc = obterHorarioFuncionamento(novaDataValidada);
                if (!horarioFunc) return await message.reply('⛔ Nós não abrimos neste dia da semana (Domingo ou Segunda).');
                
                const horaMarcada = novaDataValidada.getHours();
                if (horaMarcada < horarioFunc.inicio || horaMarcada >= horarioFunc.fim) {
                    return await message.reply(`⛔ Fora do horário. Neste dia, abrimos das ${horarioFunc.inicio}h às ${horarioFunc.fim}h.`);
                }
                if (horaMarcada === 12) return await message.reply('⛔ Horário de almoço (12h) inválido.');

                let duracaoMinutos = 60; 
                if (row.servico.includes('Barba')) duracaoMinutos = 40;
                if (row.servico.includes('Combo') || row.servico.includes('COMBO')) duracaoMinutos = 60;
                if (row.servico.includes('Química') || row.servico.includes('Platinado')) duracaoMinutos = 120;

                const novaDataFim = new Date(novaDataValidada.getTime() + duracaoMinutos * 60000);
                const livre = await verificarDisponibilidade(novaDataValidada.toISOString(), novaDataFim.toISOString());
                if (!livre) return await message.reply('⏳ Conflito de horário! Já existe agendamento nessa faixa.');

                const horaFormatada = `${novaDataValidada.getHours()}h${novaDataValidada.getMinutes()===0?'00':novaDataValidada.getMinutes()}`;
                const novaDataString = `${novaDataValidada.getDate()}/${novaDataValidada.getMonth()+1} às ${horaFormatada}`;

                db.run(`UPDATE agendamentos SET data_hora = ?, data_iso = ?, data_fim_iso = ? WHERE id = ?`, 
                [novaDataString, novaDataValidada.toISOString(), novaDataFim.toISOString(), id], async (err) => {
                    if (err) return await message.reply('❌ Erro ao atualizar.');
                    await message.reply(`✅ Agendamento ID ${id} reagendado para *${novaDataString}*.`);
                    try { await client.sendMessage(row.telefone, `🔔 *Leo Du Corte*\nSeu horário foi alterado para: *${novaDataString}* (${row.servico}).`); } catch (e) {}
                });
            });
            return;
        }
        if (texto.startsWith('!adicionar ')) {
            const conteudo = message.body.replace('!adicionar', '').trim();
            const partes = conteudo.split('|').map(p => p.trim());

            if (partes.length < 3) return await message.reply('⚠️ Formato inválido.\nUse: *!adicionar Nome | Num do Serviço (1-4) | Data*');

            const nomeCliente = partes[0];
            const numServico = partes[1];
            const textoData = partes.slice(2).join(' ');

            if (!SERVICOS[numServico]) return await message.reply('❌ Número do serviço inválido (1 a 4).');

            const servicoObj = SERVICOS[numServico];
            const dataValidada = converterData(textoData);

            if (!dataValidada) return await message.reply('⚠️ Não entendi a data.');
            
            const horarioFunc = obterHorarioFuncionamento(dataValidada);
            if (!horarioFunc) return await message.reply('⛔ Nós não abrimos neste dia da semana (Domingo ou Segunda).');
            
            const horaMarcada = dataValidada.getHours();
            if (horaMarcada < horarioFunc.inicio || horaMarcada >= horarioFunc.fim) {
                return await message.reply(`⛔ Fora do horário. Neste dia, abrimos das ${horarioFunc.inicio}h às ${horarioFunc.fim}h.`);
            }
            if (horaMarcada === 12) return await message.reply('⛔ Horário de almoço (12h) inválido.');

            const dataFim = new Date(dataValidada.getTime() + servicoObj.duracao * 60000);
            const livre = await verificarDisponibilidade(dataValidada.toISOString(), dataFim.toISOString());

            if (!livre) return await message.reply('⏳ Conflito de horário! Já existe um atendimento nessa faixa.');

            const horaFormatada = `${dataValidada.getHours()}h${dataValidada.getMinutes()===0?'00':dataValidada.getMinutes()}`;
            const dataString = `${dataValidada.getDate()}/${dataValidada.getMonth()+1} às ${horaFormatada}`;

            db.run(`INSERT INTO agendamentos (telefone, nome, servico, data_hora, data_iso, data_fim_iso) VALUES (?, ?, ?, ?, ?, ?)`, 
            ['manual_admin', nomeCliente, servicoObj.nome, dataString, dataValidada.toISOString(), dataFim.toISOString()], async (err) => {
                if (err) return await message.reply('❌ Erro ao salvar agendamento manual.');
                await message.reply(`✅ *Agendamento Manual Criado!*\n\n👤 Cliente: ${nomeCliente}\n✂️ Serviço: ${servicoObj.nome}\n📅 Data: ${dataString}`);
            });
            return;
        }
    }

    // INTERAÇÃO COM O CLIENTE NORMAL
    if (texto === 'pix' || texto === 'pagar' || texto === 'pagamento') {
        await message.reply(`💸 *Área de Pagamento*\n\nNossa Chave Pix (Celular):\n*${CHAVE_PIX}*\nNome: ${NOME_PIX}\n\nObrigado pela preferência!`);
        return;
    }

    const intencaoCancelar = texto.includes('cancelar') || texto.includes('desmarcar') || texto.includes('deu ruim') || texto === '5';
    if (intencaoCancelar) {
        db.all(`SELECT id, data_hora FROM agendamentos WHERE telefone = ?`, [chatId], async (err, rows) => {
            if (err || rows.length === 0) return await message.reply('Não encontrei nenhum horário marcado no seu número para cancelar. Se precisar de algo, digite *Oi*.');
            db.run(`DELETE FROM agendamentos WHERE telefone = ?`, [chatId], async function(err) {
                await message.reply('🗑️ *Horário Cancelado!*\n\nSua reserva foi removida. Digite *Oi* se quiser marcar uma nova data.');
                if (sessoes[chatId]) sessoes[chatId].etapa = 'inicio';
                try { await client.sendMessage(NUMERO_ADMIN, `⚠️ *DESISTÊNCIA AUTÔNOMA*\nO cliente desmarcou o horário. Vaga liberada!`); } catch (e) {}
            });
        });
        return;
    }

    if (texto === 'parar' || texto === 'reiniciar') {
        sessoes[chatId] = { etapa: 'inicio' };
        await message.reply('🔴 Atendimento encerrado.\n\nDigite *Oi* se precisar de algo.');
        return;
    }

    if (texto === 'voltar' && sessoes[chatId] && sessoes[chatId].etapa !== 'inicio') {
        sessoes[chatId].etapa = 'menu';
        await enviarMenu(message, sessoes[chatId].nome);
        return;
    }

    if (!sessoes[chatId]) sessoes[chatId] = { etapa: 'inicio' };
    const etapaAtual = sessoes[chatId].etapa;

    if (etapaAtual === 'capturando_nome') {
        if (message.body.trim().length < 2) return await message.reply('⚠️ Por favor, digite seu nome para continuarmos:');
        sessoes[chatId].nome = message.body.trim();
        sessoes[chatId].etapa = 'menu';
        await enviarMenu(message, sessoes[chatId].nome);
        return;
    }

    if (etapaAtual === 'inicio') {
        const saudacoes = ['oi', 'oii', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'opa', 'salve', 'fala'];
        const querAgendar = texto.includes('agendar') || texto.includes('marcar') || texto.includes('corte');

        if (saudacoes.some(saudacao => texto.startsWith(saudacao) || texto === saudacao) || querAgendar) {
            if (sessoes[chatId].nome) {
                sessoes[chatId].etapa = 'menu';
                return await enviarMenu(message, sessoes[chatId].nome);
            }
            db.get(`SELECT nome FROM agendamentos WHERE telefone = ? ORDER BY id DESC LIMIT 1`, [chatId], async (err, row) => {
                if (row && row.nome) {
                    sessoes[chatId].nome = row.nome;
                    sessoes[chatId].etapa = 'menu';
                    await enviarMenu(message, sessoes[chatId].nome);
                } else {
                    sessoes[chatId].etapa = 'capturando_nome';
                    await message.reply('Olá! Seja bem-vindo ao *Leo Du Corte* 💈\n\nPara começarmos, qual é o seu nome?');
                }
            });
        }
    } 
    else if (etapaAtual === 'menu') {
        if (texto.includes('local') || texto.includes('onde fica')) {
            return await message.reply(`📍 *Nossa Localização*\n\nR. Junquilhas, 184\n\n🗺️ *GPS/Uber:*\nhttps://www.google.com/maps/search/?api=1&query=R.+Junquilhas,+184\n\n_(Digite *voltar* para o menu)_`);
        }

        if (texto === '6' || texto.includes('horários livres') || texto.includes('vagas') || texto.includes('horario disponivel') || texto.includes('quais horarios')) {
            sessoes[chatId].etapa = 'consultando_vagas';
            return await message.reply(`🕒 Para qual dia você gostaria de ver nossas vagas?\n\n_(Exemplo: amanhã, dia 27, pro mes que vem dia 28)_`);
        }

        let servicoDireto = null;
        if (texto.includes('corte') || texto.includes('cortar')) servicoDireto = SERVICOS['1'];
        else if (texto.includes('barba')) servicoDireto = SERVICOS['2'];
        else if (texto.includes('combo')) servicoDireto = SERVICOS['3'];
        else if (texto.includes('química') || texto.includes('platinado')) servicoDireto = SERVICOS['4'];

        if (servicoDireto) {
            sessoes[chatId].servicoSelecionado = servicoDireto;
            sessoes[chatId].etapa = 'escolhendo_horario';
            return await message.reply(`Show! Escolheu *${servicoDireto.nome}* (${servicoDireto.preco}). 💈\n\nAgora digite a data e o horário desejado (Ex: *amanhã às 15h* ou *25 às 16:30*):`);
        }

        if (texto === '1' || texto === 'agendar' || texto === 'marcar') {
            sessoes[chatId].etapa = 'escolhendo_servico';
            await message.reply(`✂️ *O que vamos fazer hoje, ${sessoes[chatId].nome}?*\n\n*1* - Corte (R$ 35)\n*2* - Barba (R$ 30)\n*3* - Combo (Corte, Barba, Sobrancelha - R$ 68)\n*4* - Química / Platinado\n\n_Digite o número do serviço:_`);
        }
        else if (texto === '2' || texto === 'tabela') {
            await message.reply(`🔴 *TABELA DE PREÇOS* 🔵\n\n✂️ *Corte:* R$ 35\n🧔 *Barba:* R$ 30\n🔥 *COMBO:* R$ 68\n\n_(Para agendar, digite *1*)_`);
        }
        else if (texto === '3') {
            await message.reply(`📍 R. Junquilhas, 184\n\n🗺️ *GPS:* https://www.google.com/maps/search/?api=1&query=R.+Junquilhas,+184\n\n_(Digite *voltar* para retornar)_`);
        }
        else if (texto === '4' || texto.includes('insta')) {
            await message.reply(`📸 Nosso Instagram:\n👉 https://www.instagram.com/leoducorteofc_01/\n\n_(Digite *voltar* para retornar)_`);
        }
        else {
            await message.reply('❌ Opção não encontrada. Digite um número de 1 a 6.');
        }
    }
    else if (etapaAtual === 'escolhendo_servico') {
        if (SERVICOS[texto]) {
            sessoes[chatId].servicoSelecionado = SERVICOS[texto];
            sessoes[chatId].etapa = 'escolhendo_horario';
            await message.reply(`Ótima escolha! 💈\n\nAgora digite a data e o horário (Ex: *amanhã às 15h* ou *25 às 16:30*):`);
        } else {
            await message.reply('⚠️ Por favor, escolha um número de 1 a 4 para o serviço.');
        }
    }
    else if (etapaAtual === 'escolhendo_horario') {
        const dataValidada = converterData(texto);
        if (!dataValidada) return await message.reply('⚠️ Não consegui entender. Tente usar formatos mais diretos como "hoje as 15" ou "amanha as 10":');

        const horarioFunc = obterHorarioFuncionamento(dataValidada);
        if (!horarioFunc) return await message.reply('⛔ Nós não abrimos neste dia da semana (Domingo ou Segunda-feira). Por favor, escolha outro dia.');

        const horaMarcada = dataValidada.getHours();
        if (horaMarcada < horarioFunc.inicio || horaMarcada >= horarioFunc.fim) {
            return await message.reply(`⛔ Fora do nosso horário de funcionamento. Neste dia da semana, atendemos das ${horarioFunc.inicio}h às ${horarioFunc.fim}h.`);
        }
        if (horaMarcada === 12) return await message.reply('⛔ Infelizmente as 12h é nosso horário de almoço. Por favor, escolha outro horário (ex: 11:30 ou 13:00).');

        const duracao = sessoes[chatId].servicoSelecionado.duracao;
        const dataFim = new Date(dataValidada.getTime() + duracao * 60000);
        const livre = await verificarDisponibilidade(dataValidada.toISOString(), dataFim.toISOString());
        
        if (!livre) return await message.reply(`⏳ *Opa, conflito de agenda!*\n\nEsse horário já está reservado ou o tempo encavala com outro cliente. Quer tentar ver nossas vagas livres? (Digite *voltar* para o menu e escolha a opção 6)`);

        const horaArredondada = `${dataValidada.getHours()}h${dataValidada.getMinutes()===0?'00':dataValidada.getMinutes()}`;
        const dataString = `${dataValidada.getDate()}/${dataValidada.getMonth()+1} às ${horaArredondada}`;

        db.run(`INSERT INTO agendamentos (telefone, nome, servico, data_hora, data_iso, data_fim_iso) VALUES (?, ?, ?, ?, ?, ?)`, 
        [chatId, sessoes[chatId].nome, sessoes[chatId].servicoSelecionado.nome, dataString, dataValidada.toISOString(), dataFim.toISOString()], async (err) => {
            if (err) return await message.reply('❌ Erro ao salvar no banco. Tente novamente.');
            
            sessoes[chatId].etapa = 'menu';
            await message.reply(`✅ *Sucesso, ${sessoes[chatId].nome}!*\n\nSeu horário para *${sessoes[chatId].servicoSelecionado.nome}* está garantido para *${dataString}*.\n\nVocê receberá lembretes automáticos.\n_(Se precisar desmarcar, digite *cancelar*)_`);
            
            try {
                const contatoCliente = await message.getContact();
                const numeroReal = contatoCliente.number ? `${contatoCliente.number}` : chatId.replace('@c.us', '').replace('@lid', '');
                await client.sendMessage(NUMERO_ADMIN, `🔔 *NOVO AGENDAMENTO!*\n\n👤 *Cliente:* ${sessoes[chatId].nome}\n📞 *Contato:* ${numeroReal}\n✂️ *Serviço:* ${sessoes[chatId].servicoSelecionado.nome}\n📅 *Data/Hora:* ${dataString}`);
            } catch (e) {}
        });
    }
    else if (etapaAtual === 'consultando_vagas') {
        const dataAlvo = converterDataDia(texto);
        if (!dataAlvo) return await message.reply('⚠️ Não consegui entender a data. Tente algo como "amanhã", "hoje", ou "dia 25".');

        const horarioFunc = obterHorarioFuncionamento(dataAlvo);
        const dataString = `${dataAlvo.getDate()}/${dataAlvo.getMonth()+1}`;

        if (!horarioFunc) {
            return await message.reply(`📅 *Vagas para o dia ${dataString}*\n\nNós não abrimos neste dia da semana (Domingo/Segunda). 😕\nDigite outra data (ou *voltar* para sair):`);
        }

        const inicioDia = new Date(dataAlvo.getFullYear(), dataAlvo.getMonth(), dataAlvo.getDate(), 0, 0, 0).toISOString();
        const fimDia = new Date(dataAlvo.getFullYear(), dataAlvo.getMonth(), dataAlvo.getDate(), 23, 59, 59).toISOString();

        db.all("SELECT * FROM agendamentos WHERE data_iso >= ? AND data_iso <= ?", [inicioDia, fimDia], async (err, rows) => {
            const horariosPossiveis = [];
            
            for(let h = horarioFunc.inicio; h < horarioFunc.fim; h++) {
                if (h === 12) continue; // Pula o almoço
                horariosPossiveis.push(`${h.toString().padStart(2, '0')}:00`);
                horariosPossiveis.push(`${h.toString().padStart(2, '0')}:30`);
            }
            
            const livres = horariosPossiveis.filter(horaStr => {
                const [h, m] = horaStr.split(':').map(Number);
                const dataTest = new Date(dataAlvo.getFullYear(), dataAlvo.getMonth(), dataAlvo.getDate(), h, m, 0);
                const dataTestFim = new Date(dataTest.getTime() + 30 * 60000); 
                
                for (let row of rows) {
                    const rowInicio = new Date(row.data_iso);
                    const rowFim = new Date(row.data_fim_iso);
                    if ((dataTest < rowFim && dataTestFim > rowInicio) || (dataTest >= rowInicio && dataTest < rowFim)) {
                        return false; 
                    }
                }
                if (dataTest < new Date()) return false;
                return true;
            });

            if (livres.length === 0) {
                await message.reply(`📅 *Vagas para o dia ${dataString}*\n\nInfelizmente nossa agenda está 100% lotada neste dia. 😕\nQuer tentar ver para o dia seguinte? Digite a nova data (ou *voltar* para sair):`);
            } else {
                let listaTexto = livres.join(' | ');
                await message.reply(`📅 *Vagas para o dia ${dataString}*\n\nFuncionamos hoje das ${horarioFunc.inicio}h às ${horarioFunc.fim}h.\nTemos estes horários livres:\n\n🕒 ${listaTexto}\n\n_(Para marcar, digite *1* e escolha seu serviço)_`);
                sessoes[chatId].etapa = 'menu'; 
            }
        });
    }
});

async function enviarMenu(message, nome) {
    await message.reply(
        `🔴 Bem-vindo ao *Leo Du Corte* 🔵\n` +
        `Olá, ${nome}! Como posso te ajudar hoje?\n\n` +
        `*1* 📅 - Marcar Horário\n` +
        `*2* 💰 - Ver Tabela de Preços\n` +
        `*3* 📍 - Nossa Localização\n` +
        `*4* 📸 - Nosso Instagram\n` +
        `*5* 🗑️ - Cancelar meu Agendamento\n` +
        `*6* 🕒 - Ver Horários Livres\n\n` + 
        `_Dica: Se quiser deixar pago, é só digitar *Pix*._`
    );
}

client.initialize();