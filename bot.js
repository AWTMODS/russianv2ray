require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const api = require('./api');
const { User, Payment, connectDB } = require('./db');
const platega = require('./platega');

// Proxy support for Russian VPS (Telegram is blocked)
let telegramAgent = null;
if (process.env.PROXY_URL) {
    try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        telegramAgent = new HttpsProxyAgent(process.env.PROXY_URL);
        console.log(`🌐 Using proxy: ${process.env.PROXY_URL}`);
    } catch (e) {
        console.warn('⚠️  https-proxy-agent not installed. Run: npm install https-proxy-agent');
    }
}

class TelegramBot {
    constructor() {
        this.bot = new Telegraf(process.env.BOT_TOKEN, {
            telegram: telegramAgent ? { agent: telegramAgent } : {}
        });
        this.app = express();
        this.webhookPort = process.env.WEBHOOK_PORT || 3000;
        this.pendingBroadcasts = new Map();
        this.bannerPath = path.join(__dirname, 'bannernew.jpg');
        this.mainMenuBannerPath = path.join(__dirname, 'bannernew.jpg');

        this.setupMiddleware();
        this.setupHandlers();
        this.setupWebhook();
    }

    setupMiddleware() {
        this.app.use(bodyParser.json());
    }

    async getUser(ctx) {
        return await User.findOne({ telegramId: ctx.from.id.toString() });
    }

    getHost() {
        try {
            return new URL(process.env.PANEL_URL).hostname;
        } catch (e) {
            return 'your-domain';
        }
    }

    newTraceId(prefix = 'pay') {
        return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    }

    logStep(traceId, step, details = {}) {
        console.log(`[${traceId}] ${step}`, details);
    }

    normalizePaymentStatus(rawStatus) {
        const status = String(rawStatus || '').toUpperCase();

        if (['SUCCESS', 'SUCCEEDED', 'CONFIRMED', 'PAID', 'COMPLETED'].includes(status)) return 'success';
        if (['FAILED', 'DECLINED', 'EXPIRED'].includes(status)) return 'failed';
        if (['CANCELLED', 'CANCELED'].includes(status)) return 'cancelled';

        return 'pending';
    }

    getAdminIds() {
        return String(process.env.ADMIN_CHAT_IDS || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    isAdmin(chatId) {
        return this.getAdminIds().includes(String(chatId));
    }

    buildTrialVlessLink(uuid, firstName = 'user') {
        const host = process.env.VLESS_HOST;
        const port = process.env.VLESS_PORT || '443';
        const type = process.env.VLESS_TYPE || 'tcp';
        const security = process.env.VLESS_SECURITY || 'reality';
        const remark = encodeURIComponent(process.env.VLESS_REMARK || 'PortalVPN');

        let params = `type=${type}&security=${security}`;

        if (security === 'reality') {
            const pbk = encodeURIComponent(process.env.VLESS_PBK || '');
            const fp = process.env.VLESS_FP || 'chrome';
            const sni = encodeURIComponent(process.env.VLESS_SNI || 'github.com');
            const sid = encodeURIComponent(process.env.VLESS_SID || '');
            const spx = encodeURIComponent(process.env.VLESS_SPX || '/');
            const flow = encodeURIComponent(process.env.VLESS_FLOW || 'xtls-rprx-vision');
            const alpn = encodeURIComponent(process.env.VLESS_ALPN || 'h2,http/1.1');
            params += `&pbk=${pbk}&fp=${fp}&sni=${sni}&sid=${sid}&spx=${spx}&flow=${flow}&alpn=${alpn}`;
        }

        if (type === 'ws') {
            const path = encodeURIComponent(process.env.VLESS_PATH || '/');
            const hostHeader = encodeURIComponent(process.env.VLESS_WS_HOST || '');
            params += `&path=${path}&host=${hostHeader}`;
        }

        // Add encryption=none for wide compatibility
        params += '&encryption=none';

        return `vless://${uuid}@${host}:${port}?${params}#${remark}`;
    }

    buildSubscriptionLink(subId) {
        if (!subId) return null;
        let baseUrl = process.env.PANEL_URL || '';
        baseUrl = baseUrl.replace(/\/$/, '');
        if (baseUrl.endsWith('/panel')) {
            baseUrl = baseUrl.slice(0, -6);
        }
        return `${baseUrl}/sub/${subId}`;
    }



    async sendTrialExpiryReminders() {
        const now = new Date();
        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // 1. Remind 24 hours before expiry
        const expiringUsers = await User.find({
            subscriptionStatus: 'trial',
            trialUsed: true,
            keyExpiry: { $gt: now, $lte: in24h },
            trialExpiryReminderSent: { $ne: true }
        });

        for (const user of expiringUsers) {
            try {
                await this.bot.telegram.sendMessage(
                    user.telegramId,
                    '⏰ *Напоминание*\n\nЧерез 24 часа ваш пробный период истекает.\nУспейте продлить подписку, чтобы не потерять доступ!',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([[Markup.button.callback('💎 Купить Premium', 'buy_premium')]])
                    }
                );
                user.trialExpiryReminderSent = true;
                await user.save();
            } catch (e) {
                console.error('[trial_reminder] failed:', user.telegramId, e.message);
            }
        }

        // 2. Remind on exact expiry
        const expiredUsers = await User.find({
            subscriptionStatus: 'trial',
            trialUsed: true,
            keyExpiry: { $lte: now },
            trialExpiredReminderSent: { $ne: true }
        });

        for (const user of expiredUsers) {
            try {
                await this.bot.telegram.sendMessage(
                    user.telegramId,
                    '⚠️ *Ваш пробный период истек.*\n\nПродлите подписку, чтобы продолжить использование без ограничений!',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([[Markup.button.callback('💎 Купить Premium', 'buy_premium')]])
                    }
                );
                user.trialExpiredReminderSent = true;
                await user.save();
            } catch (e) {
                console.error('[trial_expired_reminder] failed:', user.telegramId, e.message);
            }
        }
    }

    startTrialReminderJob() {
        this.sendTrialExpiryReminders().catch(console.error);
        setInterval(() => this.sendTrialExpiryReminders().catch(console.error), 60 * 60 * 1000);
    }

    setupHandlers() {
        this.bot.start(async (ctx) => {
            try {
                let user = await User.findOne({ telegramId: ctx.from.id.toString() });

                if (!user) {
                    const startPayload = ctx.message.text.split(' ')[1];
                    let referredBy = null;
                    if (startPayload && startPayload.startsWith('ref_')) {
                        referredBy = startPayload.replace('ref_', '');
                        console.log(`👤 User ${ctx.from.id} referred by ${referredBy}`);
                    }

                    user = new User({
                        telegramId: ctx.from.id.toString(),
                        username: ctx.from.username,
                        firstName: ctx.from.first_name,
                        lastName: ctx.from.last_name,
                        subscriptionStatus: 'free',
                        trialUsed: false,
                        referredBy: referredBy,
                        subId: crypto.randomBytes(8).toString('hex')
                    });
                    await user.save();
                    console.log(`✅ New user created: ${ctx.from.id}`);
                }

                // Temporary: assign subId if missing for existing users
                if (!user.subId) {
                    user.subId = crypto.randomBytes(8).toString('hex');
                    await user.save();
                }

                const isActive = user && user.keyExpiry && new Date() <= user.keyExpiry;
                const vlessLink = (isActive && user.uuid) ? this.buildTrialVlessLink(user.uuid, user.firstName || 'user') : null;
                const subLink = (isActive && user.subId) ? this.buildSubscriptionLink(user.subId) : null;

                let subscriptionLine = '📢 У вас еще нет активной подписки, но вы ее можете оформить по кнопке снизу.';
                if (isActive) {
                    subscriptionLine = `🤑 *Ваша подписка:*\n\n` +
                        `🔗 *Ссылка для приложений (V2Ray/Neko):*\n\`${subLink}\`\n\n` +
                        `🔑 *Ключ для ручной настройки (VLESS):*\n\`${vlessLink}\``;
                }

                const welcomeMessage = `👋 *Добро пожаловать!*
Надёжный VPN без лагов, без ограничений по скорости и трафику.
🔒 [Политика конфиденциальности](https://telegra.ph/Politika-konfidencialnosti-08-15-17)
📄 [Пользовательское соглашение](https://telegra.ph/Polzovatelskoe-soglashenie-08-15-10)

${subscriptionLine}

💭 Нужна помощь? [Напишите нам!](https://t.me/portalvpnhelp)`;

                const buttons = [
                    [Markup.button.callback('🔑 Пробный период (3 дня)', 'get_trial_key')],
                    [Markup.button.callback('🛒 Купить VPN', 'buy_premium')],
                    [Markup.button.callback('💰 Заработать', 'show_referral')],
                    [Markup.button.url('💬 О нас', 'https://t.me/portalvnp')]
                ];

                if (this.isAdmin(ctx.from.id)) {
                    buttons.push([Markup.button.callback('👑 Панель управления', 'admin_menu')]);
                }

                const mainKeyboard = Markup.inlineKeyboard(buttons);

                if (fs.existsSync(this.bannerPath)) {
                    try {
                        await ctx.replyWithPhoto(
                            { source: this.bannerPath },
                            { caption: welcomeMessage, parse_mode: 'Markdown', ...mainKeyboard }
                        );
                    } catch (photoErr) {
                        console.error('Failed to send welcome photo, falling back to text:', photoErr.message);
                        await ctx.reply(welcomeMessage, { parse_mode: 'Markdown', ...mainKeyboard });
                    }
                } else {
                    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown', ...mainKeyboard });
                }
            } catch (err) {
                const errorId = Date.now();
                console.error(`[Error ID: ${errorId}] Start command error:`, err);
                console.error('Error stack:', err.stack);

                let errorMessage = '❌ Произошла ошибка при запуске бота.\n\n';
                if (
                    /mongoose|mongo/i.test(err.name || '') ||
                    /(mongodb|mongo|server selection|econnrefused|timed out)/i.test(err.message || '')
                ) {
                    errorMessage += 'Проблема с подключением к базе данных. Пожалуйста, попробуйте позже.';
                } else if (err.message && err.message.includes('ENOENT')) {
                    errorMessage += 'Отсутствует необходимый файл. Обратитесь в поддержку.';
                } else {
                    errorMessage += 'Пожалуйста, попробуйте позже или обратитесь в поддержку.';
                }

                errorMessage += `\n\nID ошибки: ${errorId}`;
                await ctx.reply(errorMessage).catch(() => { });
            }
        });

        this.bot.action('get_trial_key', async (ctx) => await this.handleTrialKey(ctx));
        this.bot.action('buy_premium', async (ctx) => await this.handleBuyPremium(ctx));
        this.bot.command('broadcast', async (ctx) => {
            await this.handleBroadcastCommand(ctx);
        });

        this.bot.action(/bc_(all|premium|normal)_(\d+)/, async (ctx) => await this.executeBroadcastAction(ctx));
        this.bot.action('bc_cancel', async (ctx) => await this.cancelBroadcastAction(ctx));
        this.bot.action('trial_info', async (ctx) => await this.handleTrialInfo(ctx));
        this.bot.action('return_main', async (ctx) => await this.handleReturnMain(ctx));

        this.bot.action('select_1_month', async (ctx) => await this.handlePaymentSelection(ctx, 1, 99));
        this.bot.action('select_3_months', async (ctx) => await this.handlePaymentSelection(ctx, 3, 249));
        this.bot.action('select_6_months', async (ctx) => await this.handlePaymentSelection(ctx, 6, 449));
        this.bot.action('select_1_year', async (ctx) => await this.handlePaymentSelection(ctx, 12, 790));

        this.bot.action(/check_payment_(.+)/, async (ctx) => await this.handleCheckPayment(ctx));
        this.bot.action('cancel_payment', async (ctx) => await ctx.reply('Оплата отменена.'));
        this.bot.action('show_instruction', async (ctx) => await this.handleInstruction(ctx));
        this.bot.action('show_referral', async (ctx) => await this.handleReferral(ctx));
        this.bot.command('stats', async (ctx) => await this.handleAdminStats(ctx));
        this.bot.command('admin', async (ctx) => await this.handleAdminMenu(ctx));
        this.bot.action('admin_menu', async (ctx) => await this.handleAdminMenu(ctx));
        this.bot.action('admin_stats', async (ctx) => await this.handleAdminStats(ctx));
        this.bot.action('admin_broadcast_init', async (ctx) => {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.reply('📢Введите текст для рассылки (или используйте команду /broadcast <текст>):');
        });

    }

    async handleTrialKey(ctx) {
        const traceId = this.newTraceId('trial');
        try {
            await ctx.answerCbQuery().catch(() => {});
            let user = await this.getUser(ctx);
            this.logStep(traceId, 'Trial request received', { telegramId: ctx.from.id.toString() });

            if (user && user.trialUsed) {
                const isActive = user.keyExpiry && new Date() <= user.keyExpiry;
                
                if (isActive && user.uuid) {
                    const vlessLink = this.buildTrialVlessLink(user.uuid, ctx.from.first_name);
                    await ctx.reply(
                        `✅ *Ваш доступ активен.*\n\n🔑 Ключ:\n\`${vlessLink}\`\n\n📅 Истекает: ${user.keyExpiry.toLocaleString('ru-RU')}`,
                        {
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard([[Markup.button.callback('💎 Купить Premium', 'buy_premium')]])
                        }
                    );
                    return;
                }

                // If trialUsed is true but no keyExpiry, it might be legacy/corrupt data
                if (!user.keyExpiry) {
                    this.logStep(traceId, 'User has trialUsed but no keyExpiry, resetting trialUsed for fresh start', { telegramId: user.telegramId });
                    user.trialUsed = false;
                    await user.save();
                    // fall through to create new trial
                } else {
                    await ctx.reply(
                        '⚠️ Ваш пробный период истек.',
                        Markup.inlineKeyboard([[Markup.button.callback('💎 Купить Premium', 'buy_premium')]])
                    );
                    return;
                }
            }

            const uuid = uuidv4();
            const email = `trial_${ctx.from.id}_${Date.now()}`;
            const expiryTime = Date.now() + (72 * 60 * 60 * 1000); // 72 hours

            this.logStep(traceId, 'Creating trial client in panel', {
                uuid,
                email,
                expiryTime
            });

            const result = await api.addClient(
                { uuid, email, flow: 'xtls-rprx-vision' },
                parseInt(process.env.TRIAL_INBOUND_ID, 10),
                expiryTime
            );

            this.logStep(traceId, 'Panel addClient response', { result });

            if (result.success) {
                if (!user) {
                    user = new User({
                        telegramId: ctx.from.id.toString(),
                        username: ctx.from.username,
                        firstName: ctx.from.first_name,
                        lastName: ctx.from.last_name
                    });
                }

                user.trialUsed = true;
                user.trialExpiryReminderSent = false;
                user.trialExpiredReminderSent = false;
                user.subscriptionStatus = 'trial';
                user.keyExpiry = new Date(expiryTime);
                user.uuid = uuid;
                user.email = email;
                user.inboundId = parseInt(process.env.TRIAL_INBOUND_ID, 10);
                await user.save();

                this.logStep(traceId, 'Trial data saved to DB', {
                    telegramId: user.telegramId,
                    uuid: user.uuid,
                    keyExpiry: user.keyExpiry
                });

                const vlessLink = this.buildTrialVlessLink(uuid, ctx.from.first_name);
                const message = `🔑 *Ваш ключ доступа готов:*\n\`${vlessLink}\`\n(нажмите на код, чтобы скопировать)\n\n*Как запустить PortalVPN:*\nИнструкция - https://teletype.in/@portalsvpnbot/wonDJyFfsfgaF\n\nДоступ активен: *72 часа.* ⚡️`;

                await ctx.reply(message, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback('💎 Купить Premium', 'buy_premium')]])
                });

                this.logStep(traceId, 'Trial key sent to user', { telegramId: ctx.from.id.toString() });
            } else {
                await ctx.reply(`❌ Не удалось создать ключ: ${result.msg || 'неизвестная ошибка'}`);
                console.error(`[${traceId}] Trial key API result:`, result);
            }
        } catch (err) {
            const errorId = Date.now();
            console.error(`[Error ID: ${errorId}] Trial key error:`, err);

            let errorMessage = '❌ Произошла ошибка при создании пробного ключа.\n\n';
            if (
                /mongoose|mongo/i.test(err.name || '') ||
                /(mongodb|mongo|server selection|econnrefused|timed out)/i.test(err.message || '')
            ) {
                errorMessage += 'Проблема с базой данных. Попробуйте позже.';
            } else if (err.message && err.message.includes('ECONNREFUSED')) {
                errorMessage += 'Не удалось подключиться к панели. Обратитесь в поддержку.';
            } else {
                errorMessage += 'Попробуйте позже или обратитесь в поддержку.';
            }

            errorMessage += `\n\nID ошибки: ${errorId}`;
            await ctx.reply(errorMessage).catch(() => { });
        }
    }

    async handleBuyPremium(ctx) {
        const user = await this.getUser(ctx);
        const text = '*Тарифы Portal VPN:*\n\n🔹 1 месяц — 99₽\n⭐ 3 месяца — 249₽ (Выгода 140₽)\n👑 1 год — 790₽ (Выгода 50%)';
        
        const trialButton = (user && user.trialUsed) 
            ? Markup.button.callback('Пробный период (Использован) 📅', 'trial_info')
            : Markup.button.callback('🔑 Пробный период (3 дня)', 'get_trial_key');

        const keyboard = Markup.inlineKeyboard([
            [trialButton],
            [
                Markup.button.callback('1 Месяц - 99₽', 'select_1_month'),
                Markup.button.callback('3 Месяца - 249₽', 'select_3_months')
            ],
            [
                Markup.button.callback('6 Месяцев - 449₽', 'select_6_months'),
                Markup.button.callback('12 Месяцев - 790₽', 'select_1_year')
            ],
            [Markup.button.callback('Вернуться ↩️', 'return_main')]
        ]);

        try {
            await ctx.answerCbQuery().catch(() => {});
            if (fs.existsSync(this.bannerPath)) {
                try {
                    await ctx.deleteMessage();
                } catch (e) {}
                await ctx.replyWithPhoto(
                    { source: fs.createReadStream(this.bannerPath) },
                    { caption: text, parse_mode: 'Markdown', ...keyboard }
                );
            } else {
                await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
            }
        } catch (e) {
            await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    async handleTrialInfo(ctx) {
        const user = await this.getUser(ctx);
        const text = '⏳ *Пробный период*\n\nМы предоставляем 3 дня бесплатного доступа для тестирования скорости и качества нашего сервиса.\n\nПосле окончания пробного периода вы сможете выбрать любой тариф.';
        
        const buttons = [[Markup.button.callback('🔙 Назад', 'buy_premium')]];
        if (user && !user.trialUsed) {
            buttons.unshift([Markup.button.callback('🎁 Начать тест (3 дня)', 'get_trial_key')]);
        }

        const keyboard = Markup.inlineKeyboard(buttons);

        try {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } catch (e) {
            await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    async handleReturnMain(ctx) {
        try {
            await ctx.deleteMessage();
        } catch (e) { }

        const text = '*Главное меню* 🏠\nВыберите действие:';
        const buttons = [
            [Markup.button.callback('🔑 Пробный период (3 дня)', 'get_trial_key')],
            [Markup.button.callback('🛒 Купить VPN', 'buy_premium')],
            [Markup.button.callback('💰 Заработать', 'show_referral')],
            [Markup.button.url('💬 О нас', 'https://t.me/portalvnp')]
        ];

        if (this.isAdmin(ctx.from.id)) {
            buttons.push([Markup.button.callback('👑 Панель управления', 'admin_menu')]);
        }

        const keyboard = Markup.inlineKeyboard(buttons);

        try {
            if (fs.existsSync(this.mainMenuBannerPath)) {
                await ctx.replyWithPhoto(
                    { source: fs.createReadStream(this.mainMenuBannerPath) },
                    { caption: text, parse_mode: 'Markdown', ...keyboard }
                );
            } else {
                await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
            }
        } catch (error) {
            console.error('Error sending main menu:', error);
            await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }

    async handlePaymentSelection(ctx, months, cost) {
        const traceId = this.newTraceId('payment_create');

        try {
            this.logStep(traceId, 'START', {
                telegramId: ctx.from.id.toString(),
                months,
                cost
            });

            let user = await this.getUser(ctx);
            this.logStep(traceId, 'User lookup', { found: !!user });

            if (!user) {
                user = new User({
                    telegramId: ctx.from.id.toString(),
                    username: ctx.from.username,
                    firstName: ctx.from.first_name,
                    lastName: ctx.from.last_name,
                    subscriptionStatus: 'free',
                    trialUsed: false
                });
                await user.save();
                this.logStep(traceId, 'User created', { userId: user.telegramId });
            }

            const description = `Portal VPN - ${months} ${months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}`;
            const successUrl = `${process.env.WEBHOOK_BASE_URL || 'https://t.me/' + process.env.BOT_TOKEN.split(':')[0]}/payment/success`;
            const failedUrl = `${process.env.WEBHOOK_BASE_URL || 'https://t.me/' + process.env.BOT_TOKEN.split(':')[0]}/payment/failed`;

            this.logStep(traceId, 'Calling createPayment', { description, successUrl, failedUrl });

            const paymentResult = await platega.createPayment(
                cost,
                description,
                ctx.from.id.toString(),
                successUrl,
                failedUrl
            );

            this.logStep(traceId, 'createPayment response', {
                success: paymentResult.success,
                transactionId: paymentResult.transactionId,
                error: paymentResult.error
            });

            if (paymentResult.success) {
                const payment = new Payment({
                    transactionId: paymentResult.transactionId,
                    externalId: paymentResult.externalId,
                    userId: ctx.from.id.toString(),
                    amount: cost,
                    currency: 'RUB',
                    status: 'pending',
                    subscriptionMonths: months,
                    paymentUrl: paymentResult.paymentUrl,
                    metadata: {
                        username: ctx.from.username,
                        firstName: ctx.from.first_name,
                        traceId
                    }
                });

                await payment.save();
                this.logStep(traceId, 'Payment saved', { transactionId: payment.transactionId });

                user.lastPaymentId = paymentResult.transactionId;
                user.lastPaymentStatus = 'pending';
                await user.save();
                this.logStep(traceId, 'User updated', {
                    userId: user.telegramId,
                    lastPaymentId: user.lastPaymentId
                });

                await ctx.reply(
                    `💳 *Оплата подписки*\n\n` +
                    `📦 Тариф: ${months} ${months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}\n` +
                    `💰 Сумма: ${cost}₽\n\n` +
                    `Нажмите кнопку ниже для оплаты. После успешной оплаты нажмите на 🔍 проверить статус и вы автоматически получите ключ доступа.\n\n` +
                    `⏱ Ссылка действительна 24 часа.`,
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.url('💳 Оплатить', paymentResult.paymentUrl)],
                            [Markup.button.callback('🔍 Проверить статус', `check_payment_${paymentResult.transactionId}`)],
                            [Markup.button.callback('❌ Отменить', 'cancel_payment')]
                        ])
                    }
                );

                this.logStep(traceId, 'Payment link sent', {
                    telegramId: ctx.from.id.toString(),
                    transactionId: paymentResult.transactionId
                });
            } else {
                this.logStep(traceId, 'Payment creation failed', { error: paymentResult.error });

                await ctx.reply(
                    '❌ Не удалось создать платеж. Попробуйте позже или обратитесь в поддержку.\n\n' +
                    `Ошибка: ${paymentResult.error}`,
                    Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'buy_premium')]])
                );
            }
        } catch (err) {
            console.error(`[${traceId}] Payment selection error:`, err);
            await ctx.reply('Произошла ошибка. Попробуйте позже.');
        }
    }

    async handleCheckPayment(ctx) {
        const transactionId = ctx.match[1];
        const traceId = this.newTraceId('payment_check');

        try {
            this.logStep(traceId, 'Manual status check requested', {
                transactionId,
                telegramId: ctx.from.id.toString()
            });

            const statusResult = await platega.checkPaymentStatus(transactionId);
            const normalizedStatus = this.normalizePaymentStatus(statusResult.status);

            this.logStep(traceId, 'Status check response', {
                success: statusResult.success,
                rawStatus: statusResult.status,
                normalizedStatus,
                data: statusResult.data
            });

            if (!statusResult.success) {
                await ctx.reply('Не удалось проверить статус платежа.');
                return;
            }

            const payment = await Payment.findOne({ transactionId });
            if (!payment) {
                await ctx.reply('Платеж не найден в базе.');
                return;
            }

            const user = await User.findOne({ telegramId: payment.userId });
            if (!user) {
                await ctx.reply('Пользователь платежа не найден.');
                return;
            }

            // sync DB status
            payment.status = normalizedStatus;
            if (normalizedStatus === 'success' && !payment.completedAt) {
                payment.completedAt = new Date();
            }
            await payment.save();

            // Fallback activation path when webhook is delayed/missing
            if (normalizedStatus === 'success') {
                if (payment.metadata && payment.metadata.keyIssued) {
                    this.logStep(traceId, 'Key already issued, skip manual activation', {
                        transactionId
                    });
                } else {
                    this.logStep(traceId, 'Manual success -> activating premium', {
                        transactionId,
                        userId: user.telegramId
                    });

                    const days = payment.subscriptionMonths * 30;
                    const newExpiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                    const newUuid = uuidv4();
                    const newEmail = `premium_${user.telegramId}_${Date.now()}`;

                    const result = await api.addClient(
                        { uuid: newUuid, email: newEmail, flow: 'xtls-rprx-vision' },
                        parseInt(process.env.PREMIUM_INBOUND_ID, 10),
                        newExpiry
                    );

                    this.logStep(traceId, 'Manual addClient result', { result });

                    if (result.success) {
                        user.subscriptionStatus = 'premium';
                        user.keyExpiry = new Date(newExpiry);
                        user.uuid = newUuid;
                        user.email = newEmail;
                        user.inboundId = parseInt(process.env.PREMIUM_INBOUND_ID, 10);
                        user.lastPaymentStatus = 'success';
                        await user.save();

                        payment.metadata = {
                            ...(payment.metadata || {}),
                            keyIssued: true,
                            keyIssuedAt: new Date().toISOString(),
                            keyIssuedBy: 'manual_check'
                        };
                        await payment.save();

                        const vlessLink = this.buildTrialVlessLink(newUuid, user.firstName || 'User');
                        const subLink = user.subId ? this.buildSubscriptionLink(user.subId) : null;

                        await this.bot.telegram.sendMessage(
                            user.telegramId,
                            `🎉 *Оплата подтверждена!*\n\n` +
                            `💎 *Premium активирован* на ${payment.subscriptionMonths} ${payment.subscriptionMonths === 1 ? 'месяц' : payment.subscriptionMonths < 5 ? 'месяца' : 'месяцев'}\n` +
                            `Инструкция - https://teletype.in/@portalsvpnbot/wonDJyFfsfgaF\n\n` +
                            `🔗 *Ссылка для приложений (V2Ray/Neko):*\n\`${subLink}\`\n\n` +
                            `🔑 *Ваш ключ (VLESS):*\n\`${vlessLink}\`\n\n` +
                            `📅 *Действует до:* ${user.keyExpiry.toLocaleString('ru-RU')}`,
                            { parse_mode: 'Markdown' }
                        );

                        this.logStep(traceId, 'Manual activation completed and key sent', {
                            userId: user.telegramId
                        });

                        // Reward referrer
                        if (user.referredBy) {
                            await this.rewardReferrer(user.telegramId).catch(err => {
                                console.error(`[${traceId}] Failed to reward referrer for ${user.telegramId}:`, err);
                            });
                        }
                    } else {
                        await this.bot.telegram.sendMessage(
                            user.telegramId,
                            '⚠️ Оплата подтверждена, но не удалось выдать ключ. Напишите в поддержку.'
                        );
                    }
                }
            }

            const statusEmoji = {
                pending: '⏳',
                success: '✅',
                failed: '❌',
                cancelled: '🚫'
            };

            await ctx.reply(
                `${statusEmoji[normalizedStatus] || '❓'} *Статус платежа*\n\n` +
                `ID: \`${transactionId}\`\n` +
                `Статус: ${statusResult.status}\n` +
                `Нормализованный: ${normalizedStatus}\n\n` +
                (normalizedStatus === 'pending' ? 'Ожидаем подтверждения оплаты...' : ''),
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            console.error(`[${traceId}] Payment status check error:`, err);
            await ctx.reply('Ошибка при проверке статуса.');
        }
    }

    async handleAdminMenu(ctx) {
        try {
            if (!this.isAdmin(ctx.from.id)) {
                if (ctx.callbackQuery) {
                    return await ctx.answerCbQuery('⛔ Access denied.');
                }
                return await ctx.reply('⛔ Access denied.');
            }
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery().catch(() => {});
            }

            const text = '👑 *Панель управления*\n\nВыберите действие:';
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('📊 Статистика', 'admin_stats')],
                [Markup.button.callback('📢 Рассылка', 'admin_broadcast_init')],
                [Markup.button.callback('🔙 Назад в меню', 'return_main')]
            ]);

            try {
                await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
            } catch (e) {
                await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
            }
        } catch (err) {
            console.error('Admin menu error:', err);
            await ctx.reply('❌ Ошибка при открытии админ-панели.');
        }
    }

    async handleAdminStats(ctx) {
        try {
            if (!this.isAdmin(ctx.from.id)) {
                return await ctx.reply('⛔ Access denied.');
            }
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery().catch(() => {});
            }

            const totalUsers = await User.countDocuments({});
            const trialUsers = await User.countDocuments({ subscriptionStatus: 'trial' });
            const premiumUsers = await User.countDocuments({ subscriptionStatus: 'premium' });
            const freeUsers = await User.countDocuments({ subscriptionStatus: 'free' });

            const text = `📊 *Статистика бота*\n\n` +
                `👥 Всего пользователей: *${totalUsers}*\n` +
                `🆓 Бесплатные: *${freeUsers}*\n` +
                `🧪 Пробный период: *${trialUsers}*\n` +
                `💎 Premium: *${premiumUsers}*`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Обновить', 'admin_stats')],
                [Markup.button.callback('🔙 Назад', 'admin_menu')]
            ]);

            try {
                await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
            } catch (e) {
                await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
            }
        } catch (err) {
            console.error('Admin stats error:', err);
            await ctx.reply('❌ Не удалось получить статистику.');
        }
    }


    async handleBroadcastCommand(ctx) {
        try {
            const adminIds = String(process.env.ADMIN_CHAT_IDS || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            const requesterId = String(ctx.from.id);
            if (!adminIds.includes(requesterId)) {
                return await ctx.reply('⛔ Access denied.');
            }

            const text = ctx.message.text.replace(/^\/broadcast\s*/i, '').trim();
            if (!text) {
                return await ctx.reply(
                    '📢 *Broadcast*\n\nUsage: `/broadcast Your message here`\n\nProvide the message text after the command.',
                    { parse_mode: 'Markdown' }
                );
            }

            const broadcastId = Date.now();
            this.pendingBroadcasts.set(broadcastId, text);

            // Auto-clean after 10 minutes
            setTimeout(() => this.pendingBroadcasts.delete(broadcastId), 10 * 60 * 1000);

            const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
            await ctx.reply(
                `📢 *Broadcast Preview*\n\n${preview}\n\nSelect target audience:`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('👥 All users', `bc_all_${broadcastId}`)],
                        [Markup.button.callback('💎 Premium users', `bc_premium_${broadcastId}`)],
                        [Markup.button.callback('🆓 Free/Trial users', `bc_normal_${broadcastId}`)],
                        [Markup.button.callback('❌ Cancel', 'bc_cancel')]
                    ])
                }
            );
        } catch (err) {
            console.error('Broadcast command error:', err);
            await ctx.reply('❌ Failed to initiate broadcast.');
        }
    }

    async executeBroadcastAction(ctx) {
        try {
            const adminIds = String(process.env.ADMIN_CHAT_IDS || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            const requesterId = String(ctx.from.id);
            if (!adminIds.includes(requesterId)) {
                return await ctx.answerCbQuery('⛔ Access denied.');
            }

            const match = ctx.match;
            const target = match[1]; // all | premium | normal
            const broadcastId = parseInt(match[2], 10);

            const message = this.pendingBroadcasts.get(broadcastId);
            if (!message) {
                await ctx.answerCbQuery('⚠️ Broadcast expired or not found.');
                return await ctx.editMessageText('⚠️ Broadcast session expired. Please run /broadcast again.');
            }

            this.pendingBroadcasts.delete(broadcastId);
            await ctx.answerCbQuery('✅ Broadcast started...');
            await ctx.editMessageText(`📤 Sending broadcast to *${target}* users...`, { parse_mode: 'Markdown' });

            let query = {};
            if (target === 'premium') {
                query = { subscriptionStatus: 'premium' };
            } else if (target === 'normal') {
                query = { subscriptionStatus: { $in: ['free', 'trial'] } };
            }

            const users = await User.find(query, 'telegramId').lean();
            let sent = 0, failed = 0;

            for (const user of users) {
                try {
                    await this.bot.telegram.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
                    sent++;
                } catch (e) {
                    console.error(`Broadcast failed for ${user.telegramId}:`, e.message);
                    failed++;
                }
                // Small delay to avoid Telegram rate limits
                await new Promise(r => setTimeout(r, 50));
            }

            await ctx.reply(
                `✅ *Broadcast complete*\n\n📨 Sent: *${sent}*\n❌ Failed: *${failed}*\n👥 Total targeted: *${users.length}*`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            console.error('Broadcast execution error:', err);
            await ctx.reply('❌ Broadcast failed.');
        }
    }

    async cancelBroadcastAction(ctx) {
        try {
            await ctx.answerCbQuery('Broadcast cancelled.');
            await ctx.editMessageText('❌ Broadcast cancelled.');
        } catch (err) {
            console.error('Cancel broadcast error:', err);
            await ctx.reply('Broadcast cancelled.');
        }
    }

    async handleReferral(ctx) {
        try {
            await ctx.answerCbQuery().catch(() => {});
            const user = await this.getUser(ctx);
            const botInfo = await this.bot.telegram.getMe();
            const refLink = `https://t.me/${botInfo.username}?start=ref_${ctx.from.id}`;
            const rewardDays = process.env.REFERRAL_REWARD_DAYS || '7';

            const text = `🎁 *Реферальная программа*\n\n` +
                `Приглашайте друзей и получайте бонусы!\n\n` +
                `За каждого друга, который купит любую подписку, вы получите *${rewardDays} дней* Premium доступа.\n\n` +
                `👥 Приглашено: *${user.referralCount || 0}*\n\n` +
                `🔗 *Ваша ссылка для приглашения:*\n\`${refLink}\``;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.url('📢 Поделиться', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Пользуюсь Portal VPN, попробуй и ты! 🛡')}`)],
                [Markup.button.callback('🔙 Назад', 'return_main')]
            ]);

            try {
                await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
            } catch (e) {
                await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
            }
        } catch (err) {
            console.error('Referral menu error:', err);
            await ctx.reply('❌ Ошибка при загрузке реферальной программы.');
        }
    }

    async handleInstruction(ctx) {
        const text =
            '*Инструкция для всех устройств*\n\n' +
            'Android - https://telegra.ph/Vless---Android-08-16\n' +
            'IPhone, Ipad - https://telegra.ph/Vless---MacOS-08-16\n' +
            'Mac - https://telegra.ph/Vless---MacOS-08-16\n' +
            'Windows - https://telegra.ph/Vless---Windows-08-19\n\n' +
            'Telegraph (https://telegra.ph/Vless---Android-08-16)\n' +
            'Vless - Android\n' +
            'Скачайте V2RayTun - https://play.google.com/store/apps/details?id=com.v2raytun.android\n' +
            '2. Копируем ключ из телеграм бота';

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'return_main')]
        ]);

        try {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        } catch (e) {
            await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        }
    }



    setupWebhook() {
        this.app.post('/webhook/platega', async (req, res) => {
            const traceId = this.newTraceId('payment_webhook');

            try {
                this.logStep(traceId, 'Webhook received', { body: req.body });

                const signature = req.headers['x-signature'] || req.headers['x-platega-signature'];
                if (signature && !platega.verifyWebhookSignature(req.body, signature)) {
                    this.logStep(traceId, 'Invalid webhook signature', { signaturePresent: !!signature });
                    return res.status(401).json({ error: 'Invalid signature' });
                }

                const webhookData = platega.processWebhook(req.body);
                const { transactionId, status: rawStatus, userId } = webhookData;
                const normalizedStatus = this.normalizePaymentStatus(rawStatus);

                this.logStep(traceId, 'Webhook parsed', {
                    transactionId,
                    rawStatus,
                    normalizedStatus,
                    userId
                });

                const payment = await Payment.findOne({ transactionId });
                if (!payment) {
                    this.logStep(traceId, 'Payment not found', { transactionId });
                    return res.status(404).json({ error: 'Payment not found' });
                }

                payment.status = normalizedStatus;
                if (normalizedStatus === 'success') {
                    payment.completedAt = new Date();
                }
                await payment.save();

                this.logStep(traceId, 'Payment updated', {
                    transactionId,
                    status: payment.status
                });

                const effectiveUserId = userId || payment.userId;
                const user = await User.findOne({ telegramId: effectiveUserId });
                if (!user) {
                    this.logStep(traceId, 'User not found', { effectiveUserId });
                    return res.status(404).json({ error: 'User not found' });
                }

                user.lastPaymentStatus = normalizedStatus;
                if (!user.paymentHistory) {
                    user.paymentHistory = [];
                }
                user.paymentHistory.push({
                    transactionId,
                    amount: payment.amount,
                    status: normalizedStatus,
                    createdAt: new Date()
                });
                await user.save();

                this.logStep(traceId, 'User history updated', {
                    userId: effectiveUserId,
                    lastPaymentStatus: user.lastPaymentStatus
                });

                if (normalizedStatus === 'success') {
                    this.logStep(traceId, 'Success status, activating subscription', {
                        userId: effectiveUserId,
                        months: payment.subscriptionMonths
                    });

                    const days = payment.subscriptionMonths * 30;
                    const newExpiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                    const newUuid = uuidv4();
                    const newEmail = `premium_${effectiveUserId}_${Date.now()}`;

                    const result = await api.addClient(
                        { uuid: newUuid, email: newEmail, flow: 'xtls-rprx-vision' },
                        parseInt(process.env.PREMIUM_INBOUND_ID, 10),
                        newExpiry
                    );

                    this.logStep(traceId, 'Panel addClient response', { result });

                    if (result.success) {
                        user.subscriptionStatus = 'premium';
                        user.keyExpiry = new Date(newExpiry);
                        user.uuid = newUuid;
                        user.email = newEmail;
                        user.inboundId = parseInt(process.env.PREMIUM_INBOUND_ID, 10);
                        await user.save();

                        const vlessLink = this.buildTrialVlessLink(newUuid, user.firstName || 'User');
                        const subLink = user.subId ? this.buildSubscriptionLink(user.subId) : null;

                        await this.bot.telegram.sendMessage(
                            effectiveUserId,
                            `🎉 *Оплата прошла успешно!*\n\n` +
                            `💎 *Premium активирован* на ${payment.subscriptionMonths} ${payment.subscriptionMonths === 1 ? 'месяц' : payment.subscriptionMonths < 5 ? 'месяца' : 'месяцев'}\n` +
                            `Инструкция - https://teletype.in/@portalsvpnbot/wonDJyFfsfgaF\n\n` +
                            `🔗 *Ссылка для приложений (V2Ray/Neko):*\n\`${subLink}\`\n\n` +
                            `🔑 *Ваш ключ доступа:*\n\`${vlessLink}\`\n\n` +
                            `📅 *Действует до:* ${user.keyExpiry.toLocaleString('ru-RU')}\n\n` +
                            `*Как подключиться:*\n` +
                            `1. Скачайте приложение V2RayTun или Happ\n` +
                            `2. Скопируйте ключ выше\n` +
                            `3. Импортируйте ключ в приложение\n` +
                            `4. Подключитесь к VPN`,
                            { parse_mode: 'Markdown' }
                        );

                        this.logStep(traceId, 'Subscription activated and key sent', {
                            userId: effectiveUserId
                        });

                        // Reward referrer
                        if (user.referredBy) {
                            await this.rewardReferrer(effectiveUserId).catch(err => {
                                console.error(`[${traceId}] Failed to reward referrer for ${effectiveUserId}:`, err);
                            });
                        }
                    } else {
                        this.logStep(traceId, 'Key creation failed', {
                            userId: effectiveUserId,
                            result
                        });

                        await this.bot.telegram.sendMessage(
                            effectiveUserId,
                            '⚠️ Оплата прошла успешно, но возникла проблема с активацией ключа. Обратитесь в поддержку.'
                        );
                    }
                } else if (normalizedStatus === 'failed') {
                    this.logStep(traceId, 'Payment failed status, notifying user', {
                        userId: effectiveUserId
                    });

                    await this.bot.telegram.sendMessage(
                        effectiveUserId,
                        '❌ *Оплата не прошла*\n\nПопробуйте еще раз или обратитесь в поддержку.',
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    this.logStep(traceId, 'Non-final payment status', {
                        normalizedStatus,
                        rawStatus
                    });
                }

                return res.status(200).json({ success: true });
            } catch (error) {
                console.error(`[${traceId}] Webhook processing error:`, error);
                return res.status(500).json({ error: 'Internal server error' });
            }
        });

        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
    }

    async rewardReferrer(userId) {
        try {
            const user = await User.findOne({ telegramId: userId });
            if (!user || !user.referredBy) return;

            const referrer = await User.findOne({ telegramId: user.referredBy });
            if (!referrer) return;

            console.log(`🎁 Rewarding referrer ${referrer.telegramId} for user ${userId}`);

            const rewardDays = parseInt(process.env.REFERRAL_REWARD_DAYS || '7', 10);
            const rewardMs = rewardDays * 24 * 60 * 60 * 1000;

            // If referrer has no expiry yet, start from now
            let currentExpiry = referrer.keyExpiry && referrer.keyExpiry > new Date()
                ? referrer.keyExpiry.getTime()
                : Date.now();

            const newExpiryMs = currentExpiry + rewardMs;
            const newExpiryDate = new Date(newExpiryMs);

            // Update in DB
            referrer.keyExpiry = newExpiryDate;
            referrer.referralCount = (referrer.referralCount || 0) + 1;
            
            // If they are not premium yet, elevate them?
            // The requirement says "reward with 7 days of VPN Premium".
            // If they already have a key, update it. If not, they'll need one.
            // For now, let's just update the date.
            
            await referrer.save();

            // Sync with panel if they have a key
            if (referrer.uuid && referrer.inboundId) {
                await api.updateClientExpiry(
                    referrer.inboundId,
                    referrer.email,
                    referrer.uuid,
                    newExpiryMs
                );
            }

            await this.bot.telegram.sendMessage(
                referrer.telegramId,
                `🎉 *Бонус за реферала!*\n\nВаш друг только что оплатил подписку. Вам начислено *${rewardDays} дней* Premium доступа!\n\n📅 Новый срок действия: ${newExpiryDate.toLocaleString('ru-RU')}`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});

        } catch (err) {
            console.error('Error rewarding referrer:', err);
        }
    }

    async start() {
        try {
            console.log('🚀 Starting bot...');
            console.log('📊 Environment check:');
            console.log('  - BOT_TOKEN:', process.env.BOT_TOKEN ? '✅ Set' : '❌ Missing');
            console.log('  - MONGODB_URI:', process.env.MONGODB_URI ? '✅ Set' : '❌ Missing');
            console.log('  - PANEL_URL:', process.env.PANEL_URL ? '✅ Set' : '❌ Missing');
            console.log('  - TRIAL_INBOUND_ID:', process.env.TRIAL_INBOUND_ID ? '✅ Set' : '❌ Missing');
            console.log('  - PREMIUM_INBOUND_ID:', process.env.PREMIUM_INBOUND_ID ? '✅ Set' : '❌ Missing');

            console.log('\n🔌 Connecting to MongoDB...');
            await connectDB();
            console.log('✅ MongoDB connected successfully');

            this.app.listen(this.webhookPort, () => {
                console.log(`\n🌐 Webhook server listening on port ${this.webhookPort}`);
                console.log(`📡 Webhook URL: ${process.env.WEBHOOK_BASE_URL}/webhook/platega`);
            });

            console.log('\n🤖 Launching Telegram bot...');
            await this.bot.launch();
            this.startTrialReminderJob();

            console.log('✅ Bot started successfully!');
            console.log('\n✨ Bot is ready to accept commands!\n');

            process.once('SIGINT', () => this.bot.stop('SIGINT'));
            process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
        } catch (error) {
            console.error('\n❌ Failed to start bot:', error);
            console.error('Error stack:', error.stack);
            process.exit(1);
        }
    }
}

const botInstance = new TelegramBot();
botInstance.start();

module.exports = TelegramBot;
