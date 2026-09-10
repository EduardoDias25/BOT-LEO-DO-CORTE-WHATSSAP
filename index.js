const { Client, LocalAuth } = require('whatsapp-web.js');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// ==========================================
// CONFIGURAÇÕES DO SISTEMA
// ==========================================
const NUMERO_SALAO = '5531999999999'; 
const NUMERO_ADMIN = '179778875347010@lid'; // Seu ID de Admin
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
const agradecimentosEnviados = new Set(); 

// CATÁLOGO DE SERVIÇOS (Apenas serviços de cadeira entram aqui)
const SERVICOS = {
    '1': { nome: 'Combo (Corte, Rosto, Sobrancelha, Bigode)', duracao: 60, preco: 'R$ 68', valorBase: 68 }, 
    '2': { nome: 'Corte', duracao: 60, preco: 'R$ 35', valorBase: 35 }, 
    '3': { nome: 'Barba', duracao: 40, preco: 'R$ 30', valorBase: 30 }, 
    '4': { nome: 'Alisamento', duracao: 60, preco: 'R$ 35', valorBase: 35 },
    '5': { nome: 'Luzes', duracao: 120, preco: 'R$ 60', valorBase: 60 },
    '6': { nome: 'Pé acabamento', duracao: 30, preco: 'R$ 15', valorBase: 15 },
    '7': { nome: 'Sobrancelha', duracao: 20, preco: 'R$ 18', valorBase: 18 },
    '8': { nome: 'Pigmentação preto', duracao: 45, preco: 'R$ 35', valorBase: 35 },
    '9': { nome: 'Pigmentação color', duracao: 120, preco: 'R$ 120', valorBase: 120 }
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

// ==========================================
// CÉREBRO E INTELIGÊNCIA DO BOT
// ==========================================

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
        return null; // Domingo e Segunda fechado
    }
    return { inicio, fim };
}

function converterData(texto) {
    let textoFormatado = texto.toLowerCase().trim();
    const agora = new Date();
    const anoAtual = agora.getFullYear();
    const mesAtual = agora.getMonth(); 
    let dataCalculada = null;

    textoFormatado = textoFormatado.replace(/e meia/g, 'e 30');

    const matchExato = textoFormatado.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})$/);
    const meses = {'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3, 'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11};
    const diasSemanaMap = {'domingo': 0, 'segunda': 1, 'terça': 2, 'terca': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6, 'sabado': 6};

    const matchTexto = textoFormatado.match(/(\d{1,2})\s*(?:de)?\s*([a-zç]+)\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);
    const matchRelativo = textoFormatado.match(/(hoje|amanhã|amanha)\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);
    const matchDiaSemana = textoFormatado.match(/(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado).*?(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);
    const matchDireto = textoFormatado.match(/(?:dia\s*)?(\d{1,2})\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);

    if (matchExato) {
        dataCalculada = new Date(matchExato[3], matchExato[2] - 1, matchExato[1], matchExato[4], matchExato[5]);
    } else if (matchTexto && meses[matchTexto[2]] !== undefined) {
        dataCalculada = new Date(anoAtual, meses[matchTexto[2]], parseInt(matchTexto[1]), parseInt(matchTexto[3]), matchTexto[4] ? parseInt(matchTexto[4]) : 0);
    } else if (matchRelativo) {
        let diaAlvo = agora.getDate();
        if (matchRelativo[1] === 'amanhã' || matchRelativo[1] === 'amanha') diaAlvo += 1;
        dataCalculada = new Date(anoAtual, mesAtual, diaAlvo, parseInt(matchRelativo[2]), matchRelativo[3] ? parseInt(matchRelativo[3]) : 0);
    } else if (matchDiaSemana && diasSemanaMap[matchDiaSemana[1]] !== undefined) {
        let diaAlvoInt = diasSemanaMap[matchDiaSemana[1]];
        let diaAtualInt = agora.getDay();
        let diff = diaAlvoInt - diaAtualInt;
        if (diff < 0) diff += 7; 
        dataCalculada = new Date(anoAtual, mesAtual, agora.getDate() + diff, parseInt(matchDiaSemana[2]), matchDiaSemana[3] ? parseInt(matchDiaSemana[3]) : 0);
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

    const meses = {'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3, 'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11};
    const diasSemanaMap = {'domingo': 0, 'segunda': 1, 'terça': 2, 'terca': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6, 'sabado': 6};

    const matchMesQueVem = textoFormatado.match(/m[eê]s q(?:ue)? vem dia (\d{1,2})/i);
    const matchExato = textoFormatado.match(/^(\d{1,2})\/(\d{1,2})/);
    const matchTexto = textoFormatado.match(/(\d{1,2})\s*(?:de)?\s*([a-zç]+)/i);
    const matchRelativo = textoFormatado.match(/(hoje|amanhã|amanha)/i);
    const matchDiaSemana = textoFormatado.match(/(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado)/i);
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
    } else if (matchDiaSemana && diasSemanaMap[matchDiaSemana[1]] !== undefined) {
        let diaAlvoInt = diasSemanaMap[matchDiaSemana[1]];
        let diaAtualInt = agora.getDay();
        let diff = diaAlvoInt - diaAtualInt;
        if (diff < 0) diff += 7; 
        dataCalculada = new Date(anoAtual, mesAtual, agora.getDate() + diff, 0, 0, 0);
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
    console.log('🔴🔵 Sistema Leo bot online e Operacional 100%!');

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

    cron.schedule('* * * * *', () => { 
        const agora = new Date();
        const agoraIso = agora.toISOString();

        db.all("SELECT id, telefone, nome, data_fim_iso FROM agendamentos WHERE data_fim_iso <= ?", [agoraIso], async (err, rows) => {
            if (err) return;
            
            for (const row of rows) {
                if (row.telefone === 'manual_admin') continue; 

                const tempoFim = new Date(row.data_fim_iso);
                const minutosPassados = (agora.getTime() - tempoFim.getTime()) / 60000;

                if (minutosPassados >= 0 && minutosPassados <= 3 && !agradecimentosEnviados.has(row.id)) {
                    agradecimentosEnviados.add(row.id); 
                    
                    const msgAgradecimento = `🔴 *Leo Du Corte* 🔵\n\nSatisfação total pela preferência, ${row.nome}! Muito obrigado pela moral de sempre. 🙏\n\nAproveita e já segue a gente lá no Insta pra dar aquela força e acompanhar os cortes na régua:\n👉 https://www.instagram.com/leoducorteofc_01/\n\nTmj, meu parceiro, e até a próxima! ✂️🔥`;
                    
                    try {
                        await client.sendMessage(row.telefone, msgAgradecimento);
                        if (sessoes[row.telefone]) sessoes[row.telefone].etapa = 'inicio';
                    } catch(e) {}
                }
            }
        });
    });
});

// ==========================================
// TRATAMENTO DE MENSAGENS
// ==========================================

client.on('message_create', async (message) => {
    const texto = message.body.toLowerCase();
    
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

    if (sessoes[chatId] && sessoes[chatId].pausado) return; 

    // SISTEMA DE DESPEDIDA / REINÍCIO
    const palavrasDespedida = ['obrigado', 'obrigada', 'valeu', 'vlw', 'adeus', 'tchau', 'ate', 'até', 'flw', 'falou', 'brigado'];
    const intencaoDespedida = palavrasDespedida.some(p => texto === p || texto.startsWith(p + ' ') || texto.endsWith(' ' + p));
    
    if (intencaoDespedida && (!sessoes[chatId] || sessoes[chatId].etapa !== 'capturando_nome')) {
        if (sessoes[chatId]) sessoes[chatId].etapa = 'inicio'; 
        return await message.reply('🔴 *Leo Du Corte* 🔵\n\nNós que agradecemos, meu parceiro! Qualquer coisa é só chamar. Tmj e até a próxima! ✂️🔥');
    }

    if (texto.includes('atendente') || texto.includes('humano') || texto.includes('falar com o leo') || texto.includes('dúvida') || texto.includes('duvida')) {
        if (!sessoes[chatId]) sessoes[chatId] = { etapa: 'inicio' };
        sessoes[chatId].pausado = true; 
        
        await message.reply('👨‍💻 Entendi! Pausei meu sistema automático e já chamei o Leo. Logo ele te responde aqui mesmo.');
        try {
            await client.sendMessage(NUMERO_ADMIN, `⚠️ *PRECISA DE ATENDIMENTO!*\n\nO número ${chatId.replace(/[^0-9]/g, '')} pediu ajuda e o bot se auto-pausou nessa conversa.`);
        } catch (e) {}
        return;
    }

    // ==========================================
    // BLOCO ADMINISTRATIVO
    // ==========================================
    if (chatId === NUMERO_ADMIN) {
        
        if (texto.startsWith('!relatorio') || texto.startsWith('!relatório')) {
            const periodo = texto.replace(/!relat[oó]rio/, '').trim() || 'hoje';
            const agora = new Date();
            let inicio, fim, titulo;

            if (periodo === 'mes' || periodo === 'mês') {
                inicio = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
                fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59).toISOString();
                titulo = 'MÊS ATUAL';
            } else if (periodo === 'semana') {
                const diaSemana = agora.getDay();
                const diff = agora.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1); 
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
                
                let totalCaixa = 0; let concluidos = 0; let pendentes = 0;

                rows.forEach(r => {
                    let valor = 0;
                    for (let key in SERVICOS) {
                        if (SERVICOS[key].nome === r.servico) valor = SERVICOS[key].valorBase;
                    }
                    totalCaixa += valor;
                    if (new Date(r.data_iso) < new Date()) concluidos++;
                    else pendentes++;
                });

                let msg = `📊 *BALANÇO - ${titulo}* 📊\n\n`;
                msg += `💰 *Faturamento:* R$ ${totalCaixa.toFixed(2).replace('.', ',')}\n\n`;
                msg += `✂️ *Total de Atendimentos:* ${rows.length}\n`;
                msg += `✅ *Já realizados:* ${concluidos}\n`;
                msg += `⏳ *Aguardando:* ${pendentes}\n`;
                await message.reply(msg);
            });
            return;
        }

        if (texto === '!fechar') {
            salaoFechado.ativo = true; salaoFechado.retorno = '';
            await message.reply(`🔒 *Salão Fechado!*`); return;
        }
        if (texto.startsWith('!fechar ')) {
            salaoFechado.ativo = true; salaoFechado.retorno = message.body.substring(8).trim(); 
            await message.reply(`🔒 *Salão Fechado!* Retorno: *${salaoFechado.retorno}*.`); return;
        }
        if (texto === '!abrir') {
            salaoFechado.ativo = false; salaoFechado.retorno = '';
            await message.reply(`🔓 *Salão Aberto!*`); return;
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
        if (texto === '!limpar') {
            const agoraLimpar = new Date().toISOString();
            db.run(`DELETE FROM agendamentos WHERE data_fim_iso < ?`, [agoraLimpar], function(err) {
                message.reply(`🧹 *Limpeza manual concluída!*`);
            });
            return;
        }
        if (texto.startsWith('!apagar ')) {
            const id = texto.split(' ')[1];
            db.run(`DELETE FROM agendamentos WHERE id = ?`, [id], function(err) {
                message.reply(`✅ Agendamento ID ${id} removido.`);
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
                if (horaMarcada < horarioFunc.inicio || horaMarcada >= horarioFunc.fim) return await message.reply(`⛔ Fora do horário.`);
                if (horaMarcada === 12) return await message.reply('⛔ Horário de almoço (12h) inválido.');

                let duracaoMinutos = 60;
                for (let key in SERVICOS) { if(SERVICOS[key].nome === row.servico) duracaoMinutos = SERVICOS[key].duracao; }

                const novaDataFim = new Date(novaDataValidada.getTime() + duracaoMinutos * 60000);
                const livre = await verificarDisponibilidade(novaDataValidada.toISOString(), novaDataFim.toISOString());
                if (!livre) return await message.reply('⏳ Conflito de horário!');

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

            if (partes.length < 3) return await message.reply('⚠️ Formato inválido.\nUse: *!adicionar Nome | Serviço | Data*');

            const nomeCliente = partes[0];
            const nomeServicoDigitado = partes[1].toLowerCase();
            const textoData = partes.slice(2).join(' ');

            let servicoObj = null;
            if (SERVICOS[nomeServicoDigitado]) {
                servicoObj = SERVICOS[nomeServicoDigitado];
            } else if (nomeServicoDigitado.includes('combo')) servicoObj = SERVICOS['1'];
            else if (nomeServicoDigitado.includes('corte')) servicoObj = SERVICOS['2'];
            else if (nomeServicoDigitado.includes('barba')) servicoObj = SERVICOS['3'];
            else if (nomeServicoDigitado.includes('alisamento')) servicoObj = SERVICOS['4'];
            else if (nomeServicoDigitado.includes('luzes')) servicoObj = SERVICOS['5'];
            else if (nomeServicoDigitado.includes('acabamento') || nomeServicoDigitado.includes('pé')) servicoObj = SERVICOS['6'];
            else if (nomeServicoDigitado.includes('sobrancelha')) servicoObj = SERVICOS['7'];
            else if (nomeServicoDigitado.includes('preto')) servicoObj = SERVICOS['8'];
            else if (nomeServicoDigitado.includes('color')) servicoObj = SERVICOS['9'];

            if (!servicoObj) return await message.reply('❌ Serviço inválido.');

            const dataValidada = converterData(textoData);
            if (!dataValidada) return await message.reply('⚠️ Não entendi a data.');
            
            const horarioFunc = obterHorarioFuncionamento(dataValidada);
            if (!horarioFunc) return await message.reply('⛔ Nós não abrimos neste dia da semana.');
            
            const horaMarcada = dataValidada.getHours();
            if (horaMarcada < horarioFunc.inicio || horaMarcada >= horarioFunc.fim) return await message.reply(`⛔ Fora do horário.`);
            if (horaMarcada === 12) return await message.reply('⛔ Horário de almoço (12h) inválido.');

            const dataFim = new Date(dataValidada.getTime() + servicoObj.duracao * 60000);
            const livre = await verificarDisponibilidade(dataValidada.toISOString(), dataFim.toISOString());
            if (!livre) return await message.reply('⏳ Conflito de horário! Já existe atendimento.');

            const horaFormatada = `${dataValidada.getHours()}h${dataValidada.getMinutes()===0?'00':dataValidada.getMinutes()}`;
            const dataString = `${dataValidada.getDate()}/${dataValidada.getMonth()+1} às ${horaFormatada}`;

            db.run(`INSERT INTO agendamentos (telefone, nome, servico, data_hora, data_iso, data_fim_iso) VALUES (?, ?, ?, ?, ?, ?)`, 
            ['manual_admin', nomeCliente, servicoObj.nome, dataString, dataValidada.toISOString(), dataFim.toISOString()], async (err) => {
                if (err) return await message.reply('❌ Erro.');
                await message.reply(`✅ *Agendamento Manual Criado!*\n\n👤 Cliente: ${nomeCliente}\n✂️ Serviço: ${servicoObj.nome}\n📅 Data: ${dataString}`);
            });
            return;
        }
    }

    // ==========================================
    // INTERAÇÃO COM O CLIENTE NORMAL
    // ==========================================
    
    // TRATAMENTO PARA PRODUTOS FÍSICOS DA LOJA
    if (texto.includes('gel ') || texto.includes('gel') || texto.includes('pomada') || texto.includes('produto')) {
        return await message.reply(`🔴 *Leo Du Corte* 🔵\n\nFala meu parceiro! Nossos produtos ficam expostos lá na barbearia.\n\nVocê pode colar aqui pra dar uma olhada e adquirir direto com a gente. Se preferir que entregue, basta solicitar um Uber Flash ou 99 Entrega pra retirar aqui, beleza? 🛵💨\n\n_(Digite *voltar* para o menu principal)_`);
    }

    if (texto === 'pix' || texto === 'pagar' || texto === 'pagamento') {
        await message.reply(`💸 *Área de Pagamento*\n\nNossa Chave Pix (Celular):\n*${CHAVE_PIX}*\nNome: ${NOME_PIX}\n\nObrigado pela preferência!`);
        return;
    }

    const intencaoCancelar = texto.includes('cancelar') || texto.includes('desmarcar') || texto.includes('deu ruim') || texto === '4';
    if (intencaoCancelar) {
        db.all(`SELECT id, data_hora FROM agendamentos WHERE telefone = ?`, [chatId], async (err, rows) => {
            if (err || rows.length === 0) {
                if (sessoes[chatId]) sessoes[chatId].etapa = 'inicio';
                return await message.reply('Não encontrei nenhum horário marcado no seu número para cancelar. Se precisar de algo, digite *Oi*.');
            }
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
        const querAgendar = texto.includes('agendar') || texto.includes('marcar');

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
        if (texto.includes('local') || texto.includes('onde fica') || texto === '3') {
            return await message.reply(`📍 *Nossa Localização*\n\nR. Junquilhas, 184\n\n🗺️ *GPS/Uber:*\nhttps://www.google.com/maps/search/?api=1&query=R.+Junquilhas,+184\n\n_(Digite *voltar* para o menu)_`);
        }

        if (texto === '6' || texto.includes('horários livres') || texto.includes('vagas')) {
            sessoes[chatId].etapa = 'consultando_vagas';
            return await message.reply(`🕒 Para qual dia você gostaria de ver nossas vagas?\n\n_(Exemplo: amanhã, sexta feira, pro mes que vem dia 28)_`);
        }

        let servicoDireto = null;
        if (texto.includes('combo')) servicoDireto = SERVICOS['1'];
        else if (texto.includes('corte') || texto.includes('cortar')) servicoDireto = SERVICOS['2'];
        else if (texto.includes('barba')) servicoDireto = SERVICOS['3'];
        else if (texto.includes('alisamento')) servicoDireto = SERVICOS['4'];
        else if (texto.includes('luzes')) servicoDireto = SERVICOS['5'];
        else if (texto.includes('acabamento') || texto.includes('pé') || texto.includes('pezinho')) servicoDireto = SERVICOS['6'];
        else if (texto.includes('sobrancelha')) servicoDireto = SERVICOS['7'];
        else if (texto.includes('preto')) servicoDireto = SERVICOS['8'];
        else if (texto.includes('color')) servicoDireto = SERVICOS['9'];

        if (servicoDireto) {
            sessoes[chatId].servicoSelecionado = servicoDireto;
            sessoes[chatId].etapa = 'escolhendo_horario';
            return await message.reply(`Show! Escolheu *${servicoDireto.nome}* (${servicoDireto.preco}). 💈\n\nAgora digite a data e o horário desejado (Ex: *amanhã às 15h* ou *sexta às 16:30*):`);
        }

        if (texto === '1' || texto === 'agendar' || texto === 'marcar') {
            sessoes[chatId].etapa = 'escolhendo_servico';
            await message.reply(
                `✂️ *O que vamos fazer hoje, ${sessoes[chatId].nome}?*\n\n` +
                `*1* - Combo (Corte, Rosto, Sobrancelha, Bigode)\n` +
                `*2* - Corte\n` +
                `*3* - Barba\n` +
                `*4* - Alisamento\n` +
                `*5* - Luzes\n` +
                `*6* - Pé acabamento\n` +
                `*7* - Sobrancelha\n` +
                `*8* - Pigmentação preto\n` +
                `*9* - Pigmentação color\n\n` +
                `_Digite o número do serviço:_`
            );
        }
        else if (texto === '2' || texto === 'tabela' || texto === 'preço' || texto === 'preços' || texto === 'valor' || texto === 'valores') {
            await message.reply(
                `🔴 *TABELA DE PREÇOS* 🔵\n\n` +
                `🔥 *Combo (Corte, Limpa Rosto, Sobrancelha, Bigode)* = R$ 68\n` +
                `✂️ *Corte* = R$ 35\n` +
                `🧔 *Barba* = R$ 30\n` +
                `💆‍♂️ *Alisamento* = R$ 35\n` +
                `✨ *Luzes* = R$ 60\n` +
                `📐 *Pé acabamento* = R$ 15\n` +
                `👁️ *Sobrancelha* = R$ 18\n` +
                `⚫ *Pigmentação preto* = R$ 35\n` +
                `🌈 *Pigmentação color* = R$ 120\n\n` +
                `💈 *PRODUTOS (Lojinha):*\n` +
                `*Gel Boy* = R$ 35\n` +
                `*Gel Mega Fix* = R$ 20\n` +
                `*Pomada* = R$ 40\n\n` +
                `⚠️ _Para produtos: Compre direto na barbearia ou mande um Uber Flash/99 pra retirar com a gente._\n\n` +
                `_(Para agendar serviço, digite *1*)_`
            );
        }
        else if (texto === '5' || texto.includes('insta')) {
            await message.reply(`📸 Nosso Instagram:\n👉 https://www.instagram.com/leoducorteofc_01/\n\n_(Digite *voltar* para retornar)_`);
        }
        else {
            await message.reply('❌ Opção não encontrada. \n\nVocê pode digitar o nome do que precisa (ex: *corte, pezinho, tabela, agendar*) ou enviar um número de 1 a 6 conforme o menu principal. 👊');
        }
    }
    else if (etapaAtual === 'escolhendo_servico') {
        if (SERVICOS[texto]) {
            sessoes[chatId].servicoSelecionado = SERVICOS[texto];
            sessoes[chatId].etapa = 'escolhendo_horario';
            await message.reply(`Ótima escolha! 💈\n\nAgora digite a data e o horário (Ex: *amanhã às 15h* ou *sexta às 16:30*):`);
        } else {
            await message.reply('⚠️ Por favor, escolha um número válido da lista.');
        }
    }
    else if (etapaAtual === 'escolhendo_horario') {
        const dataValidada = converterData(texto);
        if (!dataValidada) return await message.reply('⚠️ Não consegui entender. Tente usar formatos mais diretos como "hoje as 15" ou "quinta as 10":');

        const horarioFunc = obterHorarioFuncionamento(dataValidada);
        if (!horarioFunc) return await message.reply('⛔ Nós não abrimos neste dia da semana (Domingo ou Segunda-feira). Por favor, escolha outro dia.');

        const horaMarcada = dataValidada.getHours();
        if (horaMarcada < horarioFunc.inicio || horaMarcada >= horarioFunc.fim) return await message.reply(`⛔ Fora do nosso horário de funcionamento.`);
        if (horaMarcada === 12) return await message.reply('⛔ Infelizmente as 12h é nosso horário de almoço. Por favor, escolha outro horário.');

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
        if (!dataAlvo) return await message.reply('⚠️ Não consegui entender a data. Tente algo como "amanhã", "quinta", ou "dia 25".');

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
                if (h === 12) continue; 
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
        `*4* 🗑️ - Cancelar meu Agendamento\n` +
        `*5* 📸 - Nosso Instagram\n` +
        `*6* 🕒 - Ver Horários Livres\n\n` + 
        `_Dica: Se quiser deixar pago, é só digitar *Pix*._`
    );
}

client.initialize();