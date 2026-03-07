require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');

const api = require('./api');
const { User, Payment, connectDB } = require('./db');
const platega = require('./platega');

/**
 * Main Telegram Bot Class
 */
class TelegramBot {
    constructor() {
        this.bot = new Telegraf(process.env.BOT_TOKEN);
        this.app = express();
        this.webhookPort = process.env.WEBHOOK_PORT || 3000;
        this.bannerPath = path.join(__dirname, 'banner.jpg');
        this.mainMenuBannerPath = path.join(__dirname, 'main_menu.jpg');

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

    normalizePaymentStatus(rawStatus) {
        const status = String(rawStatus || '').toUpperCase();

        const successStatuses = ['SUCCESS', 'SUCCEEDED', 'CONFIRMED', 'PAID', 'COMPLETED'];
        const failedStatuses = ['FAILED', 'DECLINED', 'EXPIRED'];
        const cancelledStatuses = ['CANCELLED', 'CANCELED'];

        if (successStatuses.includes(status)) return 'success';
        if (failedStatuses.includes(status)) return 'failed';
        if (cancelledStatuses.includes(status)) return 'cancelled';
        return 'pending';
    }

    statusEmojiByNormalized(normalizedStatus) {
        const map = {
            pending: '⏳',
            success: '✅',
            failed: '❌',
            cancelled: '🚫'
        };
        return map[normalizedStatus] || '❓';
    }

    setupHandlers() {
        this.bot.start(async (ctx) => {
            try {
                let user = await User.findOne({ telegramId: ctx.from.id.toString() });

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
                    console.log(`✅ New user created: ${ctx.from.id}`);
                }

                const welcomeMessage = `*Portal — твой личный выход в свободный интернет.*

Ваш доступ активирован. У вас есть 3 дня, чтобы протестировать полную скорость без ограничений.
Чтобы начать:
Нажмите кнопку «🔗 Подключиться» ниже.

*🚀 Максимальная скорость:* Смотри YouTube в 4K и забудь про долгую загрузку Instagram.

🛡 *Полная анонимность:* Мы не храним логи. Твой трафик зашифрован и невидим для провайдера.

*Наши преимущества:*
• 3 дня бесплатного теста для всех новых пользователей.
• Работает на iPhone, Android, ПК и Mac.
• Стабильный протокол, который невозможно заблокировать.
• Оплата любыми картами РФ и через СБП.

🔒 Политика конфиденциальности:
https://telegra.ph/Politika-konfidencialnosti-08-15-17

📄 Пользовательское соглашение:
https://telegra.ph/Polzovatelskoe-soglashenie-08-15-10`;

                if (fs.existsSync(this.bannerPath)) {
                    await ctx.replyWithPhoto(
                        { source: fs.createReadStream(this.bannerPath) },
                        { caption: welcomeMessage, parse_mode: 'Markdown' }
                    );
                } else {
                    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
                }

                const menuText = '*Главное меню* 🏠\nВыберите действие:';
                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback('🔗 Подключить VPN', 'get_trial_key')],
                    [Markup.button.callback('💎 Купить подписку', 'buy_premium')]
                ]);

                if (fs.existsSync(this.mainMenuBannerPath)) {
                    await ctx.replyWithPhoto(
                        { source: fs.createReadStream(this.mainMenuBannerPath) },
                        { caption: menuText, parse_mode: 'Markdown', ...keyboard }
                    );
                } else {
                    await ctx.reply(menuText, { parse_mode: 'Markdown', ...keyboard });
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
        this.bot.action('trial_info', async (ctx) => await this.handleTrialInfo(ctx));
        this.bot.action('return_main', async (ctx) => await this.handleReturnMain(ctx));

        this.bot.action('select_1_month', async (ctx) => await this.handlePaymentSelection(ctx, 1, 180));
        this.bot.action('select_3_months', async (ctx) => await this.handlePaymentSelection(ctx, 3, 400));
        this.bot.action('select_6_months', async (ctx) => await this.handlePaymentSelection(ctx, 6, 750));
        this.bot.action('select_1_year', async (ctx) => await this.handlePaymentSelection(ctx, 12, 900));

        this.bot.action(/check_payment_(.+)/, async (ctx) => await this.handleCheckPayment(ctx));
        this.bot.action('cancel_payment', async (ctx) => await ctx.reply('Оплата отменена.'));
    }

    async handleTrialKey(ctx) {
        try {
            let user = await this.getUser(ctx);

            if (user && user.trialUsed) {
                if (user.keyExpiry && new Date() > user.keyExpiry) {
                    await ctx.reply(
                        '⚠️ Ваш пробный период истек.',
                        Markup.inlineKeyboard([[Markup.button.callback('💎 Купить Premium', 'buy_premium')]])
                    );
                } else {
                    const host = this.getHost();
                    const vlessLink = `vless://${user.uuid}@${host}:443?security=reality&type=grpc&fp=chrome&sni=google.com&serviceName=grpc#Portal_${ctx.from.first_name}`;
                    await ctx.reply(
                        `✅ *Ваш пробный период активен.*\n\n🔑 Ключ:\n\`${vlessLink}\`\n\n📅 Истекает: ${user.keyExpiry ? user.keyExpiry.toLocaleString('ru-RU') : '—'}`,
                        {
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard([[Markup.button.callback('💎 Купить Premium', 'buy_premium')]])
                        }
                    );
                }
                return;
            }

            const uuid = uuidv4();
            const email = `trial_${ctx.from.id}`;
            const expiryTime = Date.now() + (3 * 24 * 60 * 60 * 1000);

            const result = await api.addClient(
                { uuid, email },
                parseInt(process.env.TRIAL_INBOUND_ID, 10),
                expiryTime
            );

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
                user.subscriptionStatus = 'trial';
                user.keyExpiry = new Date(expiryTime);
                user.uuid = uuid;
                user.email = email;
                user.inboundId = parseInt(process.env.TRIAL_INBOUND_ID, 10);
                await user.save();

                const host = this.getHost();
                const vlessLink = `vless://${uuid}@${host}:443?security=reality&type=grpc&fp=chrome&sni=google.com&serviceName=grpc#Portal_${ctx.from.first_name}`;

                const message = `🔑 *Ваш ключ доступа готов:*\n\`${vlessLink}\`\n(нажмите на код, чтобы скопировать)\n\n*Как запустить Portal:*\n1. Скачайте приложение *V2RayTun* (или Happ) из маркета.\n2. Скопируйте ключ выше.\n3. В приложении нажмите «+» или «Import» и выберите «Import from Clipboard».\n4. Нажмите на кнопку подключения.\n\nДоступ активен: *3 дня.* ⚡️`;

                await ctx.reply(message, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback('💎 Купить Premium', 'buy_premium')]])
                });
            } else {
                await ctx.reply(`❌ Не удалось создать ключ: ${result.msg || 'неизвестная ошибка'}`);
                console.error('Trial key API result:', result);
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
        const text = '*Тарифы Portal VPN:*\n\n🔹 1 месяц — 180₽\n⭐ 3 месяца — 400₽ (Выгода 140₽)\n👑 1 год — 900₽ (Выгода 50%)';
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Пробный период 📅', 'trial_info')],
            [
                Markup.button.callback('1 Месяц - 180₽', 'select_1_month'),
                Markup.button.callback('3 Месяца - 400₽', 'select_3_months')
            ],
            [
                Markup.button.callback('6 Месяцев - 750₽', 'select_6_months'),
                Markup.button.callback('12 Месяцев - 900₽', 'select_1_year')
            ],
            [Markup.button.callback('Вернуться ↩️', 'return_main')]
        ]);

        try {
            if (fs.existsSync(this.bannerPath)) {
                await ctx.deleteMessage().catch(() => { });
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
        const text = '⏳ *Пробный период*\n\nМы предоставляем 3 дня бесплатного доступа для тестирования скорости и качества нашего сервиса.\n\nПосле окончания пробного периода вы сможете выбрать любой тариф.';
        const keyboard = Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'buy_premium')]]);

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
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔗 Подключиться', 'get_trial_key')],
            [Markup.button.callback('💎 Купить Premium', 'buy_premium')]
        ]);

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
        try {
            let user = await this.getUser(ctx);

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
            }

            const description = `Portal VPN - ${months} ${months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}`;
            const base = process.env.WEBHOOK_BASE_URL || `https://t.me/${process.env.BOT_TOKEN.split(':')[0]}`;

            const paymentResult = await platega.createPayment(
                cost,
                description,
                ctx.from.id.toString(),
                `${base}/payment/success`,
                `${base}/payment/failed`
            );

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
                        firstName: ctx.from.first_name
                    }
                });
                await payment.save();

                user.lastPaymentId = paymentResult.transactionId;
                user.lastPaymentStatus = 'pending';
                await user.save();

                await ctx.reply(
                    `💳 *Оплата подписки*\n\n` +
                    `📦 Тариф: ${months} ${months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}\n` +
                    `💰 Сумма: ${cost}₽\n\n` +
                    `Нажмите кнопку ниже для оплаты. После успешной оплаты вы автоматически получите ключ доступа.\n\n` +
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
            } else {
                await ctx.reply(
                    `❌ Не удалось создать платеж.\n\nОшибка: ${paymentResult.error || 'Unknown'}`,
                    Markup.inlineKeyboard([[Markup.button.callback('🔙 Назад', 'buy_premium')]])
                );
            }
        } catch (err) {
            console.error('Payment selection error:', err);
            await ctx.reply('Произошла ошибка. Попробуйте позже.');
        }
    }

    async handleCheckPayment(ctx) {
        const transactionId = ctx.match[1];

        try {
            const statusResult = await platega.checkPaymentStatus(transactionId);

            if (statusResult.success) {
                const rawStatus = statusResult.status;
                const normalizedStatus = this.normalizePaymentStatus(rawStatus);

                await ctx.reply(
                    `${this.statusEmojiByNormalized(normalizedStatus)} *Статус платежа*\n\n` +
                    `ID: \`${transactionId}\`\n` +
                    `Статус: ${rawStatus}\n\n` +
                    (normalizedStatus === 'pending' ? 'Ожидаем подтверждения оплаты...' : ''),
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply('Не удалось проверить статус платежа.');
            }
        } catch (err) {
            console.error('Payment status check error:', err);
            await ctx.reply('Ошибка при проверке статуса.');
        }
    }

    setupWebhook() {
        this.app.post('/webhook/platega', async (req, res) => {
            try {
                console.log('Received Platega webhook:', JSON.stringify(req.body, null, 2));

                const signature = req.headers['x-signature'] || req.headers['x-platega-signature'];
                if (signature && !platega.verifyWebhookSignature(req.body, signature)) {
                    return res.status(401).json({ error: 'Invalid signature' });
                }

                const webhookData = platega.processWebhook(req.body);
                const { transactionId, status: rawStatus, userId } = webhookData;

                const payment = await Payment.findOne({ transactionId });
                if (!payment) return res.status(404).json({ error: 'Payment not found' });

                const normalizedStatus = this.normalizePaymentStatus(rawStatus);
                const isSuccess = normalizedStatus === 'success';
                const isFailed = normalizedStatus === 'failed';

                payment.status = normalizedStatus;
                if (isSuccess) payment.completedAt = new Date();
                await payment.save();

                const effectiveUserId = userId || payment.userId;
                const user = await User.findOne({ telegramId: effectiveUserId });
                if (!user) return res.status(404).json({ error: 'User not found' });

                user.lastPaymentStatus = normalizedStatus;
                if (!user.paymentHistory) user.paymentHistory = [];
                user.paymentHistory.push({
                    transactionId,
                    amount: payment.amount,
                    status: normalizedStatus,
                    createdAt: new Date()
                });
                await user.save();

                if (isSuccess) {
                    const days = payment.subscriptionMonths * 30;
                    const newExpiry = Date.now() + (days * 24 * 60 * 60 * 1000);

                    const newUuid = uuidv4();
                    const newEmail = `premium_${effectiveUserId}_${Date.now()}`;

                    const result = await api.addClient(
                        { uuid: newUuid, email: newEmail },
                        parseInt(process.env.PREMIUM_INBOUND_ID, 10),
                        newExpiry
                    );

                    if (result.success) {
                        user.subscriptionStatus = 'premium';
                        user.keyExpiry = new Date(newExpiry);
                        user.uuid = newUuid;
                        user.email = newEmail;
                        user.inboundId = parseInt(process.env.PREMIUM_INBOUND_ID, 10);
                        await user.save();

                        const host = this.getHost();
                        const vlessLink = `vless://${newUuid}@${host}:443?security=reality&type=grpc&fp=chrome&sni=google.com&serviceName=grpc#Portal_Premium_${user.firstName || 'User'}`;

                        await this.bot.telegram.sendMessage(
                            effectiveUserId,
                            `🎉 *Оплата прошла успешно!*\n\n` +
                            `💎 *Premium активирован* на ${payment.subscriptionMonths} ${payment.subscriptionMonths === 1 ? 'месяц' : payment.subscriptionMonths < 5 ? 'месяца' : 'месяцев'}\n\n` +
                            `🔑 *Ваш ключ доступа:*\n\`${vlessLink}\`\n\n` +
                            `📅 *Действует до:* ${user.keyExpiry.toLocaleString('ru-RU')}\n\n` +
                            `*Как подключиться:*\n` +
                            `1. Скачайте приложение V2RayTun или Happ\n` +
                            `2. Скопируйте ключ выше\n` +
                            `3. Импортируйте ключ в приложение\n` +
                            `4. Подключитесь к VPN`,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        await this.bot.telegram.sendMessage(
                            effectiveUserId,
                            '⚠️ Оплата прошла успешно, но возникла проблема с активацией ключа. Обратитесь в поддержку.'
                        );
                    }
                } else if (isFailed) {
                    await this.bot.telegram.sendMessage(
                        effectiveUserId,
                        '❌ *Оплата не прошла*\n\nПопробуйте еще раз или обратитесь в поддержку.',
                        { parse_mode: 'Markdown' }
                    );
                }

                return res.status(200).json({ success: true });
            } catch (error) {
                console.error('Webhook processing error:', error);
                return res.status(500).json({ error: 'Internal server error' });
            }
        });

        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
    }

    async start() {
        try {
            console.log('🚀 Starting bot...');
            await connectDB();

            this.app.listen(this.webhookPort, () => {
                console.log(`🌐 Webhook server listening on port ${this.webhookPort}`);
                console.log(`📡 Webhook URL: ${process.env.WEBHOOK_BASE_URL}/webhook/platega`);
            });

            await this.bot.launch();
            console.log('✅ Bot started successfully!');

            process.once('SIGINT', () => this.bot.stop('SIGINT'));
            process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
        } catch (error) {
            console.error('❌ Failed to start bot:', error);
            process.exit(1);
        }
    }
}

const botInstance = new TelegramBot();
botInstance.start();

module.exports = TelegramBot;
