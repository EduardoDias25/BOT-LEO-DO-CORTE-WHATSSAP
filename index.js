const { Client, LocalAuth } = require('whatsapp-web.js');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// Configurações do Sistema
const NUMERO_SALAO = '5531999999999'; // Tente com e sem o 9 para a Discloud
const NUMERO_ADMIN = '179778875347010@lid'; 
const CHAVE_PIX = '31999999999'; // Substitua pela sua chave Pix
const NOME_PIX = 'Leonardo - Leo Do Corte';

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

// Catálogo de Serviços com Duração Dinâmica
const SERVICOS = {
    '1': { nome: 'Corte', duracao: 30, preco: 'R$ 35' },
    '2': { nome: 'Barba', duracao: 30, preco: 'R$ 30' },
    '3': { nome: 'COMBO (Corte, Barba, Sobrancelha)', duracao: 60, preco: 'R$ 68' },
    '4': { nome: 'Química / Platinado', duracao: 120, preco: 'A partir de R$ 60' }
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

// IA de Datas com Arredondamento (Travamento de Grade 30 min)
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

// Checagem de Conflitos no Banco de Dados
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
    console.log('🔴🔵 Sistema J.A.R.V.I.S. online com Trava de Nome Real e Anti-Duplicidade.');

    // Faxina Autônoma à meia-noite
    cron.schedule('0 0 * * *', () => {
        const agora = new Date().toISOString();
        db.run(`DELETE FROM agendamentos WHERE data_fim_iso < ?`, [agora], function(err) {
            if (!err && this.changes > 0) console.log(`🧹 Faxina noturna: ${this.changes} horários antigos apagados.`);
        });
    });

    // Lembretes matinais às 08:00
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
                    try { await client.sendMessage(row.telefone, `🔴 Lembrete Leo Do Corte 🔵\n\nOlá ${row.nome}, é HOJE o seu agendamento às ${dataMarcada.getHours()}h${dataMarcada.getMinutes()===0?'00':dataMarcada.getMinutes()}. Te esperamos!`); } catch(e){}
                }
            }
        });
    });
});

client.on('message', async (message) => {
    const texto = message.body.toLowerCase();
    const chatId = message.from;

    if (chatId.includes('@g.us')) return;

    // BLOCO ADMINISTRATIVO J.A.R.V.I.S.
    if (chatId === NUMERO_ADMIN) {
        if (texto === '!agenda') {
            db.all("SELECT * FROM agendamentos ORDER BY data_iso ASC", [], async (err, rows) => {
                if (err || rows.length === 0) return await message.reply('Nenhum agendamento encontrado no banco de dados.');
                let lista = '*📋 AGENDA GERAL:*\n\n';
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
            
            db.all("SELECT * FROM agendamentos WHERE data_iso >= ? AND data_iso <= ? ORDER BY data_iso ASC", [inicio, fim], async (err, rows) => {
                if (err || rows.length === 0) return await message.reply('Grade vazia para esta data.');
                let lista = texto === '!hoje' ? '*📅 AGENDA DE HOJE:*\n\n' : '*📅 AGENDA DE AMANHÃ:*\n\n';
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
            const agora = new Date().toISOString();
            db.run(`DELETE FROM agendamentos WHERE data_fim_iso < ?`, [agora], function(err) {
                message.reply(`🧹 *Limpeza manual concluída!*\n${this.changes} agendamentos passados foram removidos.`);
            });
            return;
        }
        if (texto.startsWith('!apagar ')) {
            const id = texto.split(' ')[1];
            db.run(`DELETE FROM agendamentos WHERE id = ?`, [id], function(err) {
                message.reply(`✅ Agendamento ID ${id} cancelado pelo sistema.`);
            });
            return;
        }
    }

    const contato = await message.getContact();
    const nomePushname = contato.pushname; 

    // GATILHO DE PAGAMENTO RÁPIDO
    if (texto === 'pix' || texto === 'pagar' || texto === 'pagamento') {
        await message.reply(`💸 *Área de Pagamento*\n\nNossa Chave Pix (Celular):\n*${CHAVE_PIX}*\nNome: ${NOME_PIX}\n\nObrigado pela preferência!`);
        return;
    }

    // CANCELAMENTO AUTÔNOMO
    const intencaoCancelar = texto.includes('cancelar') || texto.includes('desmarcar') || texto.includes('deu ruim') || texto.includes('não vou conseguir') || texto.includes('nao vou poder') || texto === '5';
    if (intencaoCancelar) {
        db.all(`SELECT id, data_hora FROM agendamentos WHERE telefone = ?`, [chatId], async (err, rows) => {
            if (err || rows.length === 0) {
                await message.reply('Não encontrei nenhum horário marcado no seu número para cancelar. Se precisar de algo, digite *Oi*.');
                return;
            }
            db.run(`DELETE FROM agendamentos WHERE telefone = ?`, [chatId], async function(err) {
                await message.reply('🗑️ *Horário Cancelado!*\n\nSua reserva foi removida do nosso sistema. Estaremos te esperando na próxima vez. Digite *Oi* se quiser marcar uma nova data.');
                if (sessoes[chatId]) sessoes[chatId].etapa = 'inicio';
                try {
                    await client.sendMessage(NUMERO_ADMIN, `⚠️ *DESISTÊNCIA AUTÔNOMA*\n\nO cliente desmarcou o horário pelo bot. Vaga liberada na grade!`);
                } catch (e) {}
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

    // ETAPA 1: CAPTURA E TRAVA DE NOME REAL
    if (etapaAtual === 'capturando_nome') {
        // Validação simples para evitar que mandem símbolos ou textos vazios
        if (message.body.trim().length < 2) {
            await message.reply('⚠️ Por favor, digite o seu **nome real** para continuarmos o atendimento:');
            return;
        }
        sessoes[chatId].nome = message.body.trim();
        sessoes[chatId].etapa = 'menu';
        await enviarMenu(message, sessoes[chatId].nome);
        return;
    }

    if (etapaAtual === 'inicio') {
        const saudacoes = ['oi', 'oii', 'oiii', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'bão', 'bao', 'aoba', 'cole', 'coé', 'coe', 'qualé', 'qual foi', 'eai', 'eaí', 'iai', 'eae', 'opa', 'salve', 'fala'];
        const querAgendar = texto.includes('agendar') || texto.includes('marcar') || texto.includes('horário') || texto.includes('cortar') || texto.includes('corte');

        if (saudacoes.some(saudacao => texto.startsWith(saudacao) || texto === saudacao) || querAgendar) {
            
            // Verifica se já tem nome na sessão atual
            if (sessoes[chatId].nome) {
                sessoes[chatId].etapa = 'menu';
                await enviarMenu(message, sessoes[chatId].nome);
                return;
            }

            // Memória Permanente: Busca nome anterior no Banco de Dados
            db.get(`SELECT nome FROM agendamentos WHERE telefone = ? ORDER BY id DESC LIMIT 1`, [chatId], async (err, row) => {
                if (row && row.nome) {
                    sessoes[chatId].nome = row.nome;
                    sessoes[chatId].etapa = 'menu';
                    await enviarMenu(message, sessoes[chatId].nome);
                } else {
                    // FORÇA A OBRIGATORIEDADE DO NOME REAL
                    sessoes[chatId].etapa = 'capturando_nome';
                    await message.reply(
                        '🔴 Bem-vindo ao *Leo Do Corte* 🔵\n\n' +
                        '⚠️ Para garantir um atendimento organizado, preciso do seu **nome real** (já que muitos perfis do WhatsApp usam apelidos ou nomes ocultos).\n\n' +
                        '✍️ Por favor, digite o seu nome:'
                    );
                }
            });
        }
    } 
    else if (etapaAtual === 'menu') {
        if (texto.includes('local') || texto.includes('endereço') || texto.includes('onde fica')) {
            await message.reply(`📍 *Nossa Localização*\n\nR. Junquilhas, 184 - Alterosa 2ª Seção\nBetim - MG, 32673-202\n\n🗺️ *Abra direto no GPS/Uber:*\nhttps://www.google.com/maps/search/?api=1&query=R.+Junquilhas,+184+-+Alterosa+2ª+Seção,+Betim+-+MG\n\n_(Digite *voltar* para o menu)_`);
            return;
        }

        if (texto === '1' || texto === 'agendar' || texto === 'marcar') {
            sessoes[chatId].etapa = 'escolhendo_servico';
            await message.reply(
                `✂️ *O que vamos fazer hoje, ${sessoes[chatId].nome}?*\n\n` +
                `*1* - Corte (R$ 35)\n` +
                `*2* - Barba (R$ 30)\n` +
                `*3* - Combo (Corte, Barba, Sobrancelha - R$ 68)\n` +
                `*4* - Química / Platinado\n\n` +
                `_Digite o número do serviço:_`
            );
        }
        else if (texto === '2' || texto === 'tabela') {
            await message.reply(`🔴 *TABELA DE PREÇOS* 🔵\n\n✂️ *Corte:* R$ 35\n🧔 *Barba:* R$ 30\n📏 *Pé acabamento:* R$ 15\n👁️ *Sobrancelha:* R$ 18\n🔥 *COMBO:* R$ 68\n\n🧪 *Química / Cor:*\n• Alisamento: R$ 35\n• Luzes: R$ 60\n• Pigment Preto: R$ 35\n• Pigment Color: R$ 120\n\n_(Para agendar, digite *1*)_`);
        }
        else if (texto === '3') {
            await message.reply(`📍 R. Junquilhas, 184 - Alterosa 2ª Seção\nBetim - MG\n\n🗺️ *GPS:* https://www.google.com/maps/search/?api=1&query=R.+Junquilhas,+184+-+Alterosa+2ª+Seção,+Betim+-+MG\n\n_(Digite *voltar* para retornar)_`);
        }
        else if (texto === '4' || texto.includes('insta')) {
            await message.reply(`📸 Nosso Instagram:\n👉 https://www.instagram.com/leoducorteofc_01/\n\n_(Digite *voltar* para retornar)_`);
        }
        else {
            await message.reply('❌ Opção não encontrada. Digite um número de 1 a 5.');
        }
    }
    else if (etapaAtual === 'escolhendo_servico') {
        if (SERVICOS[texto]) {
            sessoes[chatId].servicoSelecionado = SERVICOS[texto];
            sessoes[chatId].etapa = 'escolhendo_horario';
            await message.reply(
                `Ótima escolha! 💈\n\n` +
                `Agora digite a data e o horário. Nossa IA aceita formatos como:\n` +
                `👉 *25 as 16 e 30*\n` +
                `👉 *hoje as 15h*\n` +
                `👉 *amanhã as 10*`
            );
        } else {
            await message.reply('⚠️ Por favor, escolha um número de 1 a 4 para o serviço.');
        }
    }
    else if (etapaAtual === 'escolhendo_horario') {
        const dataValidada = converterData(texto);
        if (!dataValidada) {
            await message.reply('⚠️ Não consegui entender. Tente usar formatos mais diretos como "hoje as 15", "amanha as 10" ou "25 as 16 e 30":');
            return;
        }

        // Validação de horário de almoço
        if (dataValidada.getHours() === 12) {
            await message.reply('⛔ Infelizmente as 12h é nosso horário de almoço. Por favor, escolha outro horário (ex: 11:30 ou 13:00).');
            return;
        }

        // Cálculo Dinâmico de Tempo
        const duracao = sessoes[chatId].servicoSelecionado.duracao;
        const dataFim = new Date(dataValidada.getTime() + duracao * 60000);

        // TRAVA DE DUPLICIDADE
        const livre = await verificarDisponibilidade(dataValidada.toISOString(), dataFim.toISOString());
        
        if (!livre) {
            await message.reply(`⏳ *Opa, conflito de agenda!*\n\nInfelizmente esse horário já está reservado ou o tempo de serviço vai encavalar com outro cliente. Que tal tentar 30 minutinhos antes ou depois? Digite uma nova hora:`);
            return;
        }

        const horaArredondada = `${dataValidada.getHours()}h${dataValidada.getMinutes()===0?'00':dataValidada.getMinutes()}`;
        const dataString = `${dataValidada.getDate()}/${dataValidada.getMonth()+1} às ${horaArredondada}`;

        db.run(`INSERT INTO agendamentos (telefone, nome, servico, data_hora, data_iso, data_fim_iso) VALUES (?, ?, ?, ?, ?, ?)`, 
        [chatId, sessoes[chatId].nome, sessoes[chatId].servicoSelecionado.nome, dataString, dataValidada.toISOString(), dataFim.toISOString()], async (err) => {
            if (err) return await message.reply('❌ Erro ao salvar no banco. Tente novamente.');
            
            sessoes[chatId].etapa = 'menu';
            await message.reply(`✅ *Sucesso, ${sessoes[chatId].nome}!*\n\nSeu horário para *${sessoes[chatId].servicoSelecionado.nome}* está garantido para *${dataString}*.\n\nVocê receberá lembretes automáticos.\n_(Se precisar desmarcar depois, basta digitar *cancelar*)_`);
            
            try {
                const avisoDono = `🔔 *NOVO AGENDAMENTO!*\n\n👤 *Cliente:* ${sessoes[chatId].nome}\n📞 *Contato:* ${chatId.replace('@c.us', '')}\n✂️ *Serviço:* ${sessoes[chatId].servicoSelecionado.nome}\n📅 *Data/Hora:* ${dataString}`;
                await client.sendMessage(NUMERO_ADMIN, avisoDono);
            } catch (e) {}
        });
    }
});

async function enviarMenu(message, nome) {
    await message.reply(
        `🔴 Bem-vindo ao *Leo Do Corte* 🔵\n` +
        `Olá, ${nome}! Como posso te ajudar hoje?\n\n` +
        `*1* 📅 - Marcar Horário\n` +
        `*2* 💰 - Ver Tabela de Preços\n` +
        `*3* 📍 - Nossa Localização\n` +
        `*4* 📸 - Nosso Instagram\n` +
        `*5* 🗑️ - Cancelar meu Agendamento\n\n` +
        `_Dica: Se quiser deixar pago, é só digitar *Pix*._`
    );
}

client.initialize();