# 💈 Bot de Atendimento para WhatsApp (Barbearia)

Um sistema de atendimento automatizado construído em **Node.js** para otimizar a agenda e o suporte ao cliente de uma barbearia. O bot gerencia interações iniciais, exibe tabelas de preços, salva agendamentos em um banco de dados relacional e envia lembretes automáticos.

## 🎯 O Problema Resolvido
Barbearias e salões perdem horas diárias gerenciando agendamentos manualmente pelo WhatsApp, além de sofrerem com o não comparecimento de clientes por esquecimento. Este projeto automatiza o agendamento de forma inteligente (bloqueando horários indisponíveis) e envia notificações preventivas.

## 🚀 Tecnologias Utilizadas
* **Node.js**: Ambiente de execução.
* **whatsapp-web.js**: Integração com o WhatsApp via emulação do navegador (Puppeteer).
* **SQLite3**: Banco de dados leve e integrado para persistência dos agendamentos.
* **node-cron**: Agendador de tarefas para os disparos automáticos de lembretes diários.

## 💡 Principais Funcionalidades
- **Menu Interativo Dinâmico:** Navegação simplificada por opções numéricas (Agendamento, Preços, Localização e Redes Sociais).
- **Banco de Dados Local:** Armazenamento seguro de nome, telefone e horário escolhido pelo cliente no SQLite.
- **Sistema de Lembretes (Cron Job):** Varredura diária no banco de dados para enviar mensagens de lembrete automáticas aos clientes agendados.
- **Regras de Negócio Customizadas:** Bloqueio automático de tentativas de agendamento em horários de pausa (ex: horário de almoço das 12h às 13h).
- **Gestão de Sessões e Estado:** O bot rastreia em qual etapa do funil o cliente está, permitindo o uso de comandos universais como `voltar`, `reagendar` e `parar` a qualquer momento.
- **Autenticação Segura via Terminal:** Conexão feita por Pairing Code (Código Numérico de 8 dígitos), dispensando a leitura frágil de QR Code em servidores na nuvem.

## 🛠️ Como rodar o projeto localmente

1. Clone este repositório:
   ```bash
   git clone [https://github.com/EduardoDias25/BOT-LEO-DO-CORTE-WHATSSAP.git](https://github.com/EduardoDias25/BOT-LEO-DO-CORTE-WHATSSAP.git)
