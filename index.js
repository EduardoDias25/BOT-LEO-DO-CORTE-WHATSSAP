const { Client, LocalAuth } = require('whatsapp-web.js');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const NUMERO_SALAO = '5531999999999'; 
const NUMERO_ADMIN = '5531888888888@c.us'; 

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
    } catch (error) {}
});

function converterData(texto) {
    const textoFormatado = texto.toLowerCase().trim();
    
    const regexExato = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})$/;
    const matchExato = textoFormatado.match(regexExato);
    if (matchExato) {
        return new Date(matchExato[3], matchExato[2] - 1, matchExato[1], matchExato[4], matchExato[5]);
    }

    const meses = {
        'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3,
        'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
        'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11
    };

    const regexTexto = /(\d{1,2})\s*(?:de)?\s*([a-zç]+)\s*(?:as|às|as)\s*(\d{1,2})(?:h|:)?(\d{1,2})?/i;
    const matchTexto = textoFormatado.match(regexTexto);

    if (matchTexto) {
        const dia = parseInt(matchTexto[1]);
        const mesNome = matchTexto[2];
        const hora = parseInt(matchTexto[3]);
        const minuto = matchTexto[4] ? parseInt(matchTexto[4]) : 0;
        const anoAtual = new Date().getFullYear();

        if (meses[mesNome] !== undefined) {
            return new Date(anoAtual, meses[mesNome], dia, hora, minuto);
        }
    }

    return null;
}

function calcularDiferencaDias(dataAgendada) {
    const agora = new Date();
    agora.setHours(0, 0, 0, 0); 
    
    const dataAlvo = new Date(dataAgendada);
    dataAlvo.setHours(0, 0, 0, 0);

    const diferencaTempo = dataAlvo.getTime() - agora.getTime();
    return Math.ceil(diferencaTempo / (1000 * 3600 * 24)); 
}

client.on('ready', () => {
    console.log('🔴🔵 Bot do Leo Do Corte rodando com NLP, Cron e Admin ativos!');

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
                } else if (diasRestantes > 10 && diasRestantes <= 30 && diasRestantes % 6 === 0) {
                    enviarMensagem = true;
                    textoLembrete = `🔴 Lembrete Leo Do Corte 🔵\n\nOlá ${row.nome}, passando para lembrar do seu agendamento no dia ${row.data_hora}.`;
                } else if (diasRestantes > 30 && diasRestantes <= 60 && diasRestantes % 10 === 0) {
                    enviarMensagem = true;
                    textoLembrete = `🔴 Lembrete Leo Do Corte 🔵\n\nOlá ${row.nome}, seu agendamento para o dia ${row.data_hora} segue confirmado.`;
                }

                if (enviarMensagem) {
                    try {
                        await client.sendMessage(row.telefone, textoLembrete);
                    } catch (e) {}
                }
            }
        });
    });
});

client.on('message', async (message) => {
    const texto = message.body.toLowerCase();
    const chatId = message.from;

    if (chatId.includes('@g.us')) return;

    if (chatId === NUMERO_ADMIN) {
        if (texto === '!agenda') {
            db.all("SELECT * FROM agendamentos ORDER BY data_iso ASC", [], async (err, rows) => {
                if (err || rows.length === 0) {
                    await message.reply('Nenhum agendamento encontrado.');
                    return;
                }
                let lista = '*📋 AGENDA ATUAL:*\n\n';
                rows.forEach(r => {
                    lista += `ID: ${r.id} | Cliente: ${r.nome}\nData: ${r.data_hora}\nContato: ${r.telefone.replace('@c.us', '')}\n\n`;
                });
                await message.reply(lista);
            });
            return;
        }

        if (texto.startsWith('!apagar ')) {
            const id = texto.split(' ')[1];
            db.run(`DELETE FROM agendamentos WHERE id = ?`, [id], async function(err) {
                if (err) return await message.reply('Erro ao apagar.');
                await message.reply(`✅ Agendamento ID ${id} apagado com sucesso.`);
            });
            return;
        }
    }

    const contato = await message.getContact();
    const nomePushname = contato.pushname; // Pode vir nulo se a pessoa tiver privacidade ativada

    // Verifica comandos globais primeiro
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
        if (!sessoes[chatId] || !sessoes[chatId].nome) {
            sessoes[chatId] = { etapa: 'escolhendo_horario', nome: nomePushname || 'Cliente' };
        } else {
            sessoes[chatId].etapa = 'escolhendo_horario';
        }
        await message.reply('🔵 Certo, vamos reagendar! Digite a nova data e horário (Ex: 26 de março as 15 ou 25/10/2026 15:00):');
        return;
    }

    // Cria sessão se não existir
    if (!sessoes[chatId]) {
        sessoes[chatId] = { etapa: 'inicio', nome: nomePushname };
    }

    const etapaAtual = sessoes[chatId].etapa;

    if (etapaAtual === 'inicio') {
        const saudacoes = [
            'oi', 'oii', 'oiii', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite',
            'bão', 'bao', 'bão?', 'aoba', 'aoooba', 'kl', 'cole', 'colé', 'coé', 'coe', 'qualé',
            'qual foi', 'qual q e', 'eai', 'eaí', 'e aí', 'iai', 'iaí', 'eae', 'opa', 'salve',
            'fala', 'fala tu', 'fala mestre', 'fala chefe', 'fala patrão', 'fala patrao', 
            'fala mano', 'fala meu querido', 'fala cria', 'fala zé', 'manda a braba', 
            'qual a boa', 'meu rei', 'consagrado', 'truta'
        ];

        // Gatilhos de intenção (já entende que o cliente quer algo sem precisar dar "oi")
        const querAgendar = texto.includes('agendar') || texto.includes('marcar') || texto.includes('horário') || texto.includes('horario') || texto.includes('cortar') || texto.includes('corte');

        if (saudacoes.some(saudacao => texto.startsWith(saudacao) || texto === saudacao) || querAgendar) {
            
            // SE O WHATSAPP ESCONDEU O NOME DA PESSOA:
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
        // Salva o nome que a pessoa digitou e vai pro menu
        sessoes[chatId].nome = message.body; 
        sessoes[chatId].etapa = 'menu';
        await enviarMenu(message, sessoes[chatId].nome);
    }
    else if (etapaAtual === 'menu') {
        // Respostas Diretas de Horário e Localização
        if (texto.includes('horario') || texto.includes('funcionamento') || texto.includes('abrem') || texto.includes('fecham')) {
            await message.reply(`🕒 *Nosso Horário de Funcionamento:*\n💈 Terça a Quinta: 9h às 17h\n💈 Sexta: 8h às 19h\n💈 Sábado: 9h às 18h\n\n⚠️ Fechamos para almoço das *12h às 13h*.\n\n_(Digite *1* se quiser agendar um horário)_`);
            return;
        }
        else if (texto.includes('local') || texto.includes('endereço') || texto.includes('endereco') || texto.includes('onde fica')) {
            await message.reply(`📍 *Nossa Localização*\n\nR. Junquilhas, 184 - Alterosa 2ª Seção\nBetim - MG, 32673-202\n\n_(Digite *voltar* para o menu principal)_`);
            return;
        }
        
        // Respostas Diretas de Serviços Específicos
        else if (texto.includes('corte') && (texto.includes('valor') || texto.includes('preço') || texto.includes('preco') || texto.includes('quanto'))) {
            await message.reply(`✂️ O valor do *Corte* é R$ 35.\n\n_(Digite *1* se quiser agendar)_`);
            return;
        }
        else if (texto.includes('barba') && (texto.includes('valor') || texto.includes('preço') || texto.includes('preco') || texto.includes('quanto'))) {
            await message.reply(`🧔 Fazer a *Barba* sai por R$ 30.\n\n_(Digite *1* se quiser agendar)_`);
            return;
        }
        else if (texto.includes('combo')) {
            await message.reply(`🔥 Nosso *COMBO* (Corte, Limpa Rosto, Sobrancelha, Bigode) está saindo por R$ 68.\n\n_(Digite *1* se quiser agendar)_`);
            return;
        }
        else if (texto.includes('luzes') || texto.includes('platinar') || texto.includes('quimica') || texto.includes('química') || texto.includes('pigmentação')) {
            await message.reply(`🧪 *Química / Cor:*\n• Alisamento: R$ 35\n• Luzes: R$ 60\n• Pigmentação Preto: R$ 35\n• Pigmentação Color: R$ 120\n\n_(Digite *1* se quiser agendar)_`);
            return;
        }
        else if (texto.includes('sobrancelha')) {
            await message.reply(`👁️ A *Sobrancelha* sai por R$ 18.\n\n_(Digite *1* se quiser agendar)_`);
            return;
        }

        // Navegação Padrão do Menu Numérico
        if (texto === '1' || texto === 'agendar' || texto === 'marcar') {
            sessoes[chatId].etapa = 'escolhendo_horario';
            await message.reply(
                `🔴 *AGENDAMENTO* 🔵\n\n` +
                `Lembrando que funcionamos de 9h às 17h (Sexta até 19h e Sábado até 18h).\n` +
                `⚠️ Fechamos para o almoço das *12h às 13h*.\n\n` +
                `Para o sistema registrar, digite a data e o horário (Ex: *26 de março as 15* ou *25/10/2026 15:00*):`
            );
        }
        else if (texto === '2' || texto === 'tabela' || texto === 'preços') {
            await message.reply(
                `🔴 *TABELA DE PREÇOS COMPLETA* 🔵\n\n` +
                `✂️ *Corte:* R$ 35\n` +
                `🧔 *Barba:* R$ 30\n` +
                `📏 *Pé acabamento:* R$ 15\n` +
                `👁️ *Sobrancelha:* R$ 18\n\n` +
                `🔥 *COMBO* (Corte, Limpa Rosto, Sobrancelha, Bigode): R$ 68\n\n` +
                `🧪 *Química / Cor:*\n` +
                `• Alisamento: R$ 35\n` +
                `• Luzes: R$ 60\n` +
                `• Pigmentação Preto: R$ 35\n` +
                `• Pigmentação Color: R$ 120\n\n` +
                `🧴 *Produtos:*\n` +
                `• Gel Boy: R$ 35\n` +
                `• Gel Mega Fix: R$ 20\n` +
                `• Pomada: R$ 40\n\n` +
                `_(Dúvidas sobre algo? É só perguntar. Para agendar, digite *1*)_`
            );
        }
        else if (texto === '3') {
            await message.reply(`📍 R. Junquilhas, 184 - Alterosa 2ª Seção\nBetim - MG, 32673-202\n\n_(Digite *voltar* para retornar)_`);
        }
        else if (texto === '4' || texto.includes('insta')) {
            await message.reply(`📸 Nosso Instagram:\n👉 https://www.instagram.com/leoducorteofc_01/\n\n_(Digite *voltar* para retornar)_`);
        }
        else {
            await message.reply('❌ Opção não encontrada. Digite um número de 1 a 4 ou pergunte sobre um serviço específico (ex: "valor do corte").');
        }
    }
    else if (etapaAtual === 'escolhendo_horario') {
        if (texto.includes('12h') || texto.includes('12:00') || texto.includes(' as 12')) {
            await message.reply('⛔ Infelizmente as 12h é nosso horário de almoço. Por favor, escolha outro horário (ex: 11:00 ou 13:00).');
            return;
        }

        const dataValidada = converterData(texto);
        if (!dataValidada) {
            await message.reply('⚠️ Não entendi a data. Por favor, digite algo como "26 de março as 15" ou "25/10/2026 15:00":');
            return;
        }

        db.run(`INSERT INTO agendamentos (telefone, nome, data_hora, data_iso) VALUES (?, ?, ?, ?)`, 
        [chatId, sessoes[chatId].nome, message.body, dataValidada.toISOString()], async (err) => {
            if (err) {
                await message.reply('❌ Ocorreu um erro ao salvar no banco de dados. Tente novamente.');
                return;
            }
            sessoes[chatId].etapa = 'menu';
            await message.reply(`✅ *${sessoes[chatId].nome}*, seu agendamento para *${message.body}* foi salvo no sistema!\n\nVocê receberá lembretes automáticos conforme a data se aproxima.\n\n_(Para remarcar, digite *reagendar*. Para sair, digite *parar*)_`);
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
        `_Dica: Você também pode me perguntar direto, tipo "qual o valor do corte?" ou "que horas vcs abrem?"._`
    );
}

client.initialize();