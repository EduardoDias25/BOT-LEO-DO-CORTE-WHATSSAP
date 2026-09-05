const { Client, LocalAuth } = require('whatsapp-web.js');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const NUMERO_SALAO = '5531999999999'; 
const NUMERO_ADMIN = '179778875347010@lid'; 

const db = new sqlite3.Database('./agendamentos.db');
db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefone TEXT,
    nome TEXT,
    data_hora TEXT,
    data_iso TEXT
)`);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: os.platform() === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined
    }
});

const sessoes = {};

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

// MOTOR DE DATAS TURBINADO
function converterData(texto) {
    let textoFormatado = texto.toLowerCase().trim();
    const agora = new Date();
    const anoAtual = agora.getFullYear();
    const mesAtual = agora.getMonth(); 

    // Formato Exato: 25/10/2026 15:00
    const matchExato = textoFormatado.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})$/);
    if (matchExato) return new Date(matchExato[3], matchExato[2] - 1, matchExato[1], matchExato[4], matchExato[5]);

    // Trata "meia" como 30 minutos
    textoFormatado = textoFormatado.replace(/e meia/g, 'e 30');

    // Formato com Mês: 25 de outubro as 16 e 30
    const meses = {'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3, 'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11};
    const matchTexto = textoFormatado.match(/(\d{1,2})\s*(?:de)?\s*([a-zç]+)\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);
    if (matchTexto && meses[matchTexto[2]] !== undefined) {
        return new Date(anoAtual, meses[matchTexto[2]], parseInt(matchTexto[1]), parseInt(matchTexto[3]), matchTexto[4] ? parseInt(matchTexto[4]) : 0);
    }

    // Formato "Hoje" ou "Amanha" (ex: hoje as 15 e 30)
    const matchRelativo = textoFormatado.match(/(hoje|amanhã|amanha)\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);
    if (matchRelativo) {
        let diaAlvo = agora.getDate();
        if (matchRelativo[1] === 'amanhã' || matchRelativo[1] === 'amanha') diaAlvo += 1;
        return new Date(anoAtual, mesAtual, diaAlvo, parseInt(matchRelativo[2]), matchRelativo[3] ? parseInt(matchRelativo[3]) : 0);
    }

    // Formato Direto sem Mês (ex: 25 as 16 e 30) - Assume mês atual
    const matchDireto = textoFormatado.match(/(?:dia\s*)?(\d{1,2})\s*(?:as|às|as)\s*(\d{1,2})(?:h|:| e )?(\d{1,2})?/i);
    if (matchDireto) {
        let diaMarcado = parseInt(matchDireto[1]);
        let mesAlvo = mesAtual;
        if (diaMarcado < agora.getDate()) mesAlvo += 1; // Se o dia já passou, marca pro mês que vem
        return new Date(anoAtual, mesAlvo, diaMarcado, parseInt(matchDireto[2]), matchDireto[3] ? parseInt(matchDireto[3]) : 0);
    }

    return null;
}

function calcularDiferencaDias(dataAgendada) {
    const agora = new Date();
    agora.setHours(0, 0, 0, 0); 
    const dataAlvo = new Date(dataAgendada);
    dataAlvo.setHours(0, 0, 0, 0);
    return Math.ceil((dataAlvo.getTime() - agora.getTime()) / (1000 * 3600 * 24)); 
}

client.on('ready', () => {
    console.log('🔴🔵 Bot rodando! IA de Datas e Novos Comandos Admin Ativos!');

    cron.schedule('0 8 * * *', () => {
        db.all("SELECT id, telefone, nome, data_hora, data_iso FROM agendamentos", [], async (err, rows) => {
            if (err) return;
            for (const row of rows) {
                const dataFormatada = new Date(row.data_iso);
                const diasRestantes = calcularDiferencaDias(dataFormatada);
                let enviarMensagem = false;
                let textoLembrete = '';

                if (diasRestantes === 0) {
                    enviarMensagem = true;
                    textoLembrete = `🔴 Lembrete Leo Do Corte 🔵\n\nOlá ${row.nome}, é HOJE o seu agendamento às ${dataFormatada.getHours()}h${dataFormatada.getMinutes() === 0 ? '00' : dataFormatada.getMinutes()}. Te esperamos!`;
                } else if (diasRestantes > 0 && diasRestantes <= 10 && diasRestantes % 2 === 0) {
                    enviarMensagem = true;
                    textoLembrete = `🔴 Lembrete Leo Do Corte 🔵\n\nOlá ${row.nome}, faltam ${diasRestantes} dias para o seu agendamento (${row.data_hora}).`;
                }

                if (enviarMensagem) {
                    try { await client.sendMessage(row.telefone, textoLembrete); } catch (e) {}
                }
            }
        });
    });
});

client.on('message', async (message) => {
    const texto = message.body.toLowerCase();
    const chatId = message.from;

    if (chatId.includes('@g.us')) return;

    // BLOCO ADMINISTRATIVO
    if (chatId === NUMERO_ADMIN) {
        if (texto === '!agenda') {
            db.all("SELECT * FROM agendamentos ORDER BY data_iso ASC", [], async (err, rows) => {
                if (err || rows.length === 0) return await message.reply('Nenhum agendamento encontrado.');
                let lista = '*📋 AGENDA COMPLETA:*\n\n';
                rows.forEach(r => { lista += `ID: ${r.id} | Cliente: ${r.nome}\nData/Hora: ${r.data_hora}\n\n`; });
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
                if (err || rows.length === 0) return await message.reply(texto === '!hoje' ? 'Nenhum cliente marcado para hoje.' : 'Agenda vazia para amanhã.');
                let lista = texto === '!hoje' ? '*📅 AGENDA DE HOJE:*\n\n' : '*📅 AGENDA DE AMANHÃ:*\n\n';
                rows.forEach(r => {
                    const hora = new Date(r.data_iso).getHours();
                    const min = new Date(r.data_iso).getMinutes() === 0 ? '00' : new Date(r.data_iso).getMinutes();
                    lista += `ID: ${r.id} | Cliente: ${r.nome}\n⏰ Horário: ${hora}:${min}\n\n`;
                });
                await message.reply(lista);
            });
            return;
        }

        if (texto === '!limpar') {
            const agora = new Date().toISOString();
            db.run(`DELETE FROM agendamentos WHERE data_iso < ?`, [agora], async function(err) {
                if (err) return await message.reply('Erro ao limpar agenda.');
                await message.reply(`🧹 *Limpeza concluída!*\nForam apagados ${this.changes} agendamentos passados do sistema.`);
            });
            return;
        }

        if (texto.startsWith('!apagar ')) {
            const id = texto.split(' ')[1];
            db.run(`DELETE FROM agendamentos WHERE id = ?`, [id], async function(err) {
                if (err) return await message.reply('Erro ao apagar.');
                await message.reply(`✅ Agendamento ID ${id} cancelado com sucesso.`);
            });
            return;
        }
    }

    const contato = await message.getContact();
    const nomePushname = contato.pushname; 

    if (texto === 'parar' || texto === 'reiniciar') {
        sessoes[chatId] = { etapa: 'inicio' };
        await message.reply('🔴 Atendimento encerrado.\n\nDigite *Oi* se precisar de mais alguma coisa.');
        return;
    }

    if (texto === 'voltar' && sessoes[chatId] && sessoes[chatId].etapa !== 'inicio') {
        sessoes[chatId].etapa = 'menu';
        await enviarMenu(message, sessoes[chatId].nome || nomePushname);
        return;
    }

    if (texto === 'reagendar') {
        if (!sessoes[chatId] || !sessoes[chatId].nome) sessoes[chatId] = { etapa: 'escolhendo_horario', nome: nomePushname || 'Cliente' };
        else sessoes[chatId].etapa = 'escolhendo_horario';
        
        await message.reply('🔵 Certo, vamos reagendar!\nDigite a nova data e horário (Ex: *25 as 16 e 30* ou *hoje as 15*):');
        return;
    }

    if (!sessoes[chatId]) sessoes[chatId] = { etapa: 'inicio', nome: nomePushname };
    const etapaAtual = sessoes[chatId].etapa;

    if (etapaAtual === 'inicio') {
        const saudacoes = ['oi', 'oii', 'oiii', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'bão', 'bao', 'aoba', 'cole', 'coé', 'coe', 'qualé', 'qual foi', 'eai', 'eaí', 'iai', 'eae', 'opa', 'salve', 'fala', 'fala tu', 'fala chefe', 'fala patrão', 'manda a braba', 'qual a boa', 'meu rei', 'consagrado'];
        const querAgendar = texto.includes('agendar') || texto.includes('marcar') || texto.includes('horário') || texto.includes('horario') || texto.includes('cortar') || texto.includes('corte');

        if (saudacoes.some(saudacao => texto.startsWith(saudacao) || texto === saudacao) || querAgendar) {
            if (!sessoes[chatId].nome) {
                sessoes[chatId].etapa = 'capturando_nome';
                await message.reply('🔴 Bem-vindo ao *Leo Do Corte* 🔵\n\nComo o seu nome não aparece aqui no meu sistema, como posso te chamar?');
                return;
            } else {
                sessoes[chatId].etapa = 'menu';
                await enviarMenu(message, sessoes[chatId].nome);
                return;
            }
        }
    } 
    else if (etapaAtual === 'capturando_nome') {
        sessoes[chatId].nome = message.body; 
        sessoes[chatId].etapa = 'menu';
        await enviarMenu(message, sessoes[chatId].nome);
    }
    else if (etapaAtual === 'menu') {
        if (texto.includes('horario') || texto.includes('abrem') || texto.includes('fecham')) {
            await message.reply(`🕒 *Nosso Horário de Funcionamento:*\n💈 Terça a Quinta: 9h às 17h\n💈 Sexta: 8h às 19h\n💈 Sábado: 9h às 18h\n\n⚠️ Fechamos para almoço das *12h às 13h*.\n\n_(Digite *1* se quiser agendar)_`);
            return;
        }
        else if (texto.includes('local') || texto.includes('endereço') || texto.includes('onde fica')) {
            await message.reply(`📍 *Nossa Localização*\n\nR. Junquilhas, 184 - Alterosa 2ª Seção\nBetim - MG\n\n_(Digite *voltar* para o menu)_`);
            return;
        }
        else if (texto.includes('corte') && (texto.includes('valor') || texto.includes('preço') || texto.includes('quanto'))) {
            await message.reply(`✂️ O valor do *Corte* é R$ 35.\n\n_(Digite *1* se quiser agendar)_`);
            return;
        }

        if (texto === '1' || texto === 'agendar' || texto === 'marcar') {
            sessoes[chatId].etapa = 'escolhendo_horario';
            await message.reply(
                `🔴 *AGENDAMENTO* 🔵\n\n` +
                `⚠️ Fechamos para o almoço das *12h às 13h*.\n\n` +
                `Digite a data e o horário. Nossa IA aceita formatos como:\n` +
                `👉 *25 as 16 e 30*\n` +
                `👉 *hoje as 15h*\n` +
                `👉 *amanhã as 10*`
            );
        }
        else if (texto === '2' || texto === 'tabela') {
            await message.reply(`🔴 *TABELA DE PREÇOS* 🔵\n\n✂️ *Corte:* R$ 35\n🧔 *Barba:* R$ 30\n📏 *Pé acabamento:* R$ 15\n👁️ *Sobrancelha:* R$ 18\n🔥 *COMBO* (Corte+Limpa+Sobrancelha+Bigode): R$ 68\n\n🧪 *Química / Cor:*\n• Alisamento: R$ 35\n• Luzes: R$ 60\n• Pigmentação Preto: R$ 35\n• Pigmentação Color: R$ 120\n\n_(Para agendar, digite *1*)_`);
        }
        else if (texto === '3') {
            await message.reply(`📍 R. Junquilhas, 184 - Alterosa 2ª Seção\nBetim - MG\n\n_(Digite *voltar* para retornar)_`);
        }
        else if (texto === '4' || texto.includes('insta')) {
            await message.reply(`📸 Nosso Instagram:\n👉 https://www.instagram.com/leoducorteofc_01/\n\n_(Digite *voltar* para retornar)_`);
        }
        else {
            await message.reply('❌ Opção não encontrada. Digite um número de 1 a 4.');
        }
    }
    else if (etapaAtual === 'escolhendo_horario') {
        if (texto.includes('12h') || texto.includes('12:00') || texto.includes(' as 12')) {
            await message.reply('⛔ Infelizmente as 12h é nosso horário de almoço. Por favor, escolha outro horário (ex: 11:00 ou 13:00).');
            return;
        }

        const dataValidada = converterData(texto);
        if (!dataValidada) {
            await message.reply('⚠️ Não consegui entender. Tente usar formatos mais diretos como "hoje as 15", "amanha as 10" ou "25 as 16 e 30":');
            return;
        }

        db.run(`INSERT INTO agendamentos (telefone, nome, data_hora, data_iso) VALUES (?, ?, ?, ?)`, 
        [chatId, sessoes[chatId].nome, message.body, dataValidada.toISOString()], async (err) => {
            if (err) return await message.reply('❌ Erro ao salvar no banco. Tente novamente.');
            
            sessoes[chatId].etapa = 'menu';
            await message.reply(`✅ *${sessoes[chatId].nome}*, horário agendado com sucesso para *${message.body}*!\n\nVocê receberá lembretes automáticos.\n_(Para remarcar, digite *reagendar*. Para sair, digite *parar*)_`);
            
            try {
                const avisoDono = `🔔 *NOVO AGENDAMENTO!*\n\n👤 *Cliente:* ${sessoes[chatId].nome}\n📞 *Contato:* ${chatId.replace('@c.us', '')}\n📅 *Data/Hora:* ${message.body}`;
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
        `*4* 📸 - Nosso Instagram\n\n` +
        `_Dica: Pode perguntar direto: "qual o valor do corte?"_`
    );
}

client.initialize();