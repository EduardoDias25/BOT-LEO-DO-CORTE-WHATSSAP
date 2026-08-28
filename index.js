const { Client, LocalAuth } = require('whatsapp-web.js');
const os = require('os');

// ⚠️ COLOQUE AQUI O NÚMERO DO WHATSAPP DO SALÃO (Ex: 5531999999999)
const NUMERO_CLIENTE = '5531999999999'; 

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: os.platform() === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined
    }
});

// Banco de dados temporário na memória para guardar em qual etapa o cliente está
const sessoes = {};

client.on('qr', async () => {
    console.log('Aguardando liberação para gerar o código...');
    try {
        setTimeout(async () => {
            const codigo = await client.requestPairingCode(NUMERO_CLIENTE);
            console.log(`\n📲 CÓDIGO DE EMPARELHAMENTO: ${codigo}\n`);
            console.log('Vá no WhatsApp do salão em "Aparelhos Conectados" > "Conectar com número de telefone" e digite este código.');
        }, 2000);
    } catch (error) {
        console.error('Erro ao gerar o código. Verifique se o número está no formato correto.', error);
    }
});

client.on('ready', () => {
    console.log('🔴🔵 Bot do Leo Do Corte conectado e pronto para atender!');
});

client.on('message', async (message) => {
    const texto = message.body.toLowerCase();
    const chatId = message.from;

    // Ignora mensagens de grupos
    if (chatId.includes('@g.us')) return;

    // Pega o nome do cliente salvo no WhatsApp
    const contato = await message.getContact();
    const nomeCliente = contato.pushname || 'Amigo(a)';

    // COMANDOS GERAIS (Funcionam em qualquer etapa)
    if (texto === 'parar' || texto === 'reiniciar') {
        sessoes[chatId] = { etapa: 'menu' };
        await message.reply('🔴 Operação reiniciada.\n\nDigite *Oi* para ver o menu novamente.');
        return;
    }

    if (texto === 'voltar' && sessoes[chatId] && sessoes[chatId].etapa !== 'menu') {
        sessoes[chatId].etapa = 'menu';
        await enviarMenu(message, nomeCliente);
        return;
    }

    if (texto === 'reagendar') {
        sessoes[chatId] = { etapa: 'escolhendo_dia' };
        await message.reply('🔵 Certo, vamos reagendar! Para qual dia você gostaria de remarcar? (Ex: Amanhã, Sexta-feira, 20/10)');
        return;
    }

    // Inicializa a sessão do usuário se ele não tiver uma
    if (!sessoes[chatId]) {
        sessoes[chatId] = { etapa: 'inicio' };
    }

    const etapaAtual = sessoes[chatId].etapa;

    // Lógica do Chatbot baseada na etapa
    if (etapaAtual === 'inicio') {
        if (['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].includes(texto)) {
            sessoes[chatId].etapa = 'menu';
            await enviarMenu(message, nomeCliente);
        }
    } 
    else if (etapaAtual === 'menu') {
        switch (texto) {
            case '1':
                sessoes[chatId].etapa = 'escolhendo_horario';
                await message.reply(
                    `🔴 *AGENDAMENTO* 🔵\n\n` +
                    `Nosso horário de funcionamento:\n` +
                    `💈 Terça a Quinta: 9h às 17h\n` +
                    `💈 Sexta: 8h às 19h\n` +
                    `💈 Sábado: 9h às 18h\n\n` +
                    `⚠️ *Atenção:* Fechamos para o almoço das *12h às 13h*.\n\n` +
                    `Digite o dia e horário que você deseja (Ex: Quinta às 15h):`
                );
                break;
            case '2':
                await message.reply(
                    `🔴 *TABELA DE PREÇOS* 🔵\n\n` +
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
                    `_(Digite *voltar* para retornar ao menu)_`
                );
                break;
            case '3':
                await message.reply(
                    `📍 *Nossa Localização*\n\n` +
                    `R. Junquilhas, 184 - Alterosa 2ª Seção\n` +
                    `Betim - MG, 32673-202\n\n` +
                    `Telefone: (31) 97352-4465\n\n` +
                    `_(Digite *voltar* para retornar ao menu)_`
                );
                break;
            case '4':
                await message.reply(
                    `📸 *Nosso Instagram*\n\n` +
                    `Acompanhe nossos trabalhos e promoções lá no Insta!\n` +
                    `👉 https://www.instagram.com/leoducorteofc_01/\n\n` +
                    `_(Digite *voltar* para retornar ao menu)_`
                );
                break;
            default:
                await message.reply('❌ Opção inválida. Por favor, digite um número de 1 a 4.');
        }
    }
    else if (etapaAtual === 'escolhendo_horario' || etapaAtual === 'escolhendo_dia') {
        // Validação simples para ver se o cliente digitou 12h
        if (texto.includes('12h') || texto.includes('12:00') || texto.includes('12 h')) {
            await message.reply('⛔ Infelizmente as 12h é nosso horário de almoço e não podemos agendar. Por favor, escolha outro horário (ex: 11h ou 13h).');
        } else {
            sessoes[chatId].etapa = 'menu'; // Finaliza o fluxo temporariamente
            await message.reply(`✅ *${nomeCliente}*, seu pedido de agendamento para "${message.body}" foi recebido com sucesso!\n\nUm de nossos barbeiros vai confirmar com você em breve.\n\n_(Para remarcar, digite *reagendar*. Para voltar ao início, digite *voltar*)_`);
        }
    }
});

// Função auxiliar para enviar o menu
async function enviarMenu(message, nome) {
    await message.reply(
        `🔴 Bem-vindo ao *Leo Do Corte* 🔵\n` +
        `Olá, ${nome}! Como podemos te ajudar hoje?\n\n` +
        `Respondendo com o *NÚMERO* da opção desejada:\n\n` +
        `*1* 📅 - Marcar Horário\n` +
        `*2* 💰 - Ver Tabela de Preços\n` +
        `*3* 📍 - Nossa Localização\n` +
        `*4* 📸 - Nosso Instagram\n\n` +
        `--------------------\n` +
        `_Dica: A qualquer momento digite *voltar* para voltar aqui, ou *parar* para cancelar o atendimento._`
    );
}

client.initialize();