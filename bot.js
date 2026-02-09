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

// Connect to Database
connectDB();

const bot = new Telegraf(process.env.BOT_TOKEN);

// User State Helper
const getUser = async (ctx) => {
    return await User.findOne({ telegramId: ctx.from.id.toString() });
};

// Start Command with Image
bot.start(async (ctx) => {
    try {
        // Ensure user exists in DB
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
            console.log(`New user created: ${ctx.from.id}`);
        }

        const welcomeMessage = `*Portal — твой личный выход в свободный интернет.*

🚀 *Максимальная скорость:* Смотри YouTube в 4K и забудь про долгую загрузку Instagram.

🛡 *Полная анонимность:* Мы не храним логи. Твой трафик зашифрован и невидим для провайдера.

🌍 *Весь мир на ладони:* Доступ к любым заблокированным ресурсам в один клик.

*Наши преимущества:*
• 3 дня бесплатного теста для всех новых пользователей.
• Работает на iPhone, Android, ПК и Mac.
• Стабильный протокол, который невозможно заблокировать.
• Оплата любыми картами РФ и через СБП.`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔗 Подключиться', 'get_trial_key')],
            [Markup.button.callback('💎 Купить Premium', 'buy_premium')],
            [Markup.button.url('🔒 Политика конфиденциальности', 'https://example.com/privacy')]
        ]);

        // Send with banner image
        const bannerPath = path.join(__dirname, 'banner.jpg');
        if (fs.existsSync(bannerPath)) {
            await ctx.replyWithPhoto(
                { source: bannerPath },
                {
                    caption: welcomeMessage,
                    parse_mode: 'Markdown',
                    ...keyboard
                }
            );
        } else {
            // Fallback to text only if image doesn't exist
            await ctx.reply(welcomeMessage, {
                parse_mode: 'Markdown',
                ...keyboard
            });
        }
    } catch (err) {
        console.error('Start error:', err);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Get Trial Key Action
bot.action('get_trial_key', async (ctx) => {
    try {
        let user = await getUser(ctx);

        if (user && user.trialUsed) {
            // Check if expired
            if (new Date() > user.keyExpiry) {
                ctx.reply('⚠️ Ваш пробный период истек.', Markup.inlineKeyboard([
                    Markup.button.callback('💎 Купить Premium', 'buy_premium')
                ]));
            } else {
                const host = getHost();
                const vlessLink = `vless://${user.uuid}@${host}:443?security=reality&type=grpc&fp=chrome&sni=google.com&serviceName=grpc#Portal_${ctx.from.first_name}`;
                ctx.reply(
                    `✅ *Ваш пробный период активен.*\n\n🔑 Ключ:\n\`${vlessLink}\`\n\n📅 Истекает: ${user.keyExpiry.toLocaleString()}`,
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            Markup.button.callback('💎 Купить Premium', 'buy_premium')
                        ])
                    }
                );
            }
            return;
        }

        // New User: Create Trial
        const uuid = uuidv4();
        const email = `trial_${ctx.from.id}`;
        const expiryTime = Date.now() + (3 * 24 * 60 * 60 * 1000); // 3 Days in ms

        // Call Panel API
        const result = await api.addClient(
            { uuid, email },
            parseInt(process.env.TRIAL_INBOUND_ID),
            expiryTime
        );

        if (result.success) {
            // Save to DB
            user = new User({
                telegramId: ctx.from.id.toString(),
                username: ctx.from.username,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name,
                trialUsed: true,
                subscriptionStatus: 'trial',
                keyExpiry: new Date(expiryTime),
                uuid: uuid,
                email: email,
                inboundId: parseInt(process.env.TRIAL_INBOUND_ID)
            });
            await user.save();

            const host = getHost();
            const vlessLink = `vless://${uuid}@${host}:443?security=reality&type=grpc&fp=chrome&sni=google.com&serviceName=grpc#Portal_${ctx.from.first_name}`;

            const message = `🔑 *Ваш ключ доступа готов:*\n\`${vlessLink}\`\n(нажмите на код, чтобы скопировать)\n\n*Как запустить Portal:*\n1. Скачайте приложение *V2RayTun* (или Happ) из маркета.\n2. Скопируйте ключ выше.\n3. В приложении нажмите «+» или «Import» и выберите «Import from Clipboard».\n4. Нажмите на кнопку подключения.\n\nДоступ активен: *3 дня.* ⚡️`;

            ctx.reply(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    Markup.button.callback('💎 Купить Premium', 'buy_premium')
                ])
            });
        } else {
            ctx.reply(`❌ Не удалось создать ключ: ${result.msg}`);
            console.error(result);
        }

    } catch (err) {
        console.error('Trial error:', err);
        ctx.reply('An error occurred. Please try again later.');
    }
});

const getHost = () => {
    try {
        return new URL(process.env.PANEL_URL).hostname;
    } catch (e) {
        return 'your-domain';
    }
};

// Buy Premium Action
bot.action('buy_premium', async (ctx) => {
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
        // Try to send with banner if exists
        const bannerPath = path.join(__dirname, 'banner.jpg');
        if (fs.existsSync(bannerPath)) {
            await ctx.deleteMessage().catch(() => { });
            await ctx.replyWithPhoto({ source: bannerPath }, { caption: text, parse_mode: 'Markdown', ...keyboard });
        } else {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        }
    } catch (e) {
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
});

// Trial Info
bot.action('trial_info', async (ctx) => {
    const text = '⏳ *Пробный период*\n\nМы предоставляем 3 дня бесплатного доступа для тестирования скорости и качества нашего сервиса.\n\nПосле окончания пробного периода вы сможете выбрать любой тариф.';
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Назад', 'buy_premium')]
    ]);

    try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
});

// Return Main
bot.action('return_main', async (ctx) => {
    try {
        await ctx.deleteMessage(); // Clean up menu
    } catch (e) { }
    // Re-send start message mechanism or just simple text
    ctx.reply(
        '*Главное меню* 🏠\nВыберите действие:',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                Markup.button.callback('🔗 Подключиться', 'get_trial_key'),
                Markup.button.callback('💎 Купить Premium', 'buy_premium')
            ])
        }
    );
});

// Selection Handlers - Generate Platega Payment Links
bot.action('select_1_month', async (ctx) => {
    await handlePaymentSelection(ctx, 1, 180);
});

bot.action('select_3_months', async (ctx) => {
    await handlePaymentSelection(ctx, 3, 400);
});

bot.action('select_6_months', async (ctx) => {
    await handlePaymentSelection(ctx, 6, 750);
});

bot.action('select_1_year', async (ctx) => {
    await handlePaymentSelection(ctx, 12, 900);
});

// Handle payment selection - Generate Platega payment link
const handlePaymentSelection = async (ctx, months, cost) => {
    try {
        let user = await getUser(ctx);

        // Auto-create user if missing
        if (!user) {
            console.log(`User ${ctx.from.id} missing in DB during payment. Creating...`);
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

        // Create payment via Platega
        const description = `Portal VPN - ${months} ${months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}`;
        const paymentResult = await platega.createPayment(
            cost,
            description,
            ctx.from.id.toString(),
            `${process.env.WEBHOOK_BASE_URL || 'https://t.me/' + process.env.BOT_TOKEN.split(':')[0]}/payment/success`,
            `${process.env.WEBHOOK_BASE_URL || 'https://t.me/' + process.env.BOT_TOKEN.split(':')[0]}/payment/failed`
        );

        if (paymentResult.success) {
            // Save payment to database
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

            // Update user's last payment info
            user.lastPaymentId = paymentResult.transactionId;
            user.lastPaymentStatus = 'pending';
            await user.save();

            // Send payment link to user
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
            ctx.reply(
                '❌ Не удалось создать платеж. Попробуйте позже или обратитесь в поддержку.\n\n' +
                `Ошибка: ${paymentResult.error}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 Назад', 'buy_premium')]
                ])
            );
        }
    } catch (err) {
        console.error('Payment selection error:', err);
        ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
};

// Check payment status
bot.action(/check_payment_(.+)/, async (ctx) => {
    const transactionId = ctx.match[1];

    try {
        const statusResult = await platega.checkPaymentStatus(transactionId);

        if (statusResult.success) {
            const statusEmoji = {
                'pending': '⏳',
                'success': '✅',
                'failed': '❌',
                'cancelled': '🚫'
            };

            ctx.reply(
                `${statusEmoji[statusResult.status] || '❓'} *Статус платежа*\n\n` +
                `ID: \`${transactionId}\`\n` +
                `Статус: ${statusResult.status}\n\n` +
                (statusResult.status === 'pending' ? 'Ожидаем подтверждения оплаты...' : ''),
                { parse_mode: 'Markdown' }
            );
        } else {
            ctx.reply('Не удалось проверить статус платежа.');
        }
    } catch (err) {
        console.error('Payment status check error:', err);
        ctx.reply('Ошибка при проверке статуса.');
    }
});

bot.action('cancel_payment', (ctx) => {
    ctx.reply('Оплата отменена.');
});

// ============================================
// WEBHOOK SERVER FOR PLATEGA PAYMENTS
// ============================================

const app = express();
app.use(bodyParser.json());

// Webhook endpoint for Platega payment notifications
app.post('/webhook/platega', async (req, res) => {
    try {
        console.log('Received Platega webhook:', JSON.stringify(req.body, null, 2));

        // Verify webhook signature if secret is configured
        const signature = req.headers['x-signature'] || req.headers['x-platega-signature'];
        if (signature && !platega.verifyWebhookSignature(req.body, signature)) {
            console.error('Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        // Process webhook data
        const webhookData = platega.processWebhook(req.body);
        const { transactionId, externalId, status, userId } = webhookData;

        // Find payment in database
        const payment = await Payment.findOne({ transactionId });
        if (!payment) {
            console.error(`Payment not found: ${transactionId}`);
            return res.status(404).json({ error: 'Payment not found' });
        }

        // Update payment status
        payment.status = status;
        if (status === 'success') {
            payment.completedAt = new Date();
        }
        await payment.save();

        // Find user
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
            console.error(`User not found: ${userId}`);
            return res.status(404).json({ error: 'User not found' });
        }

        // Update user's payment status
        user.lastPaymentStatus = status;
        if (!user.paymentHistory) {
            user.paymentHistory = [];
        }
        user.paymentHistory.push({
            transactionId,
            amount: payment.amount,
            status,
            createdAt: new Date()
        });

        // Handle successful payment
        if (status === 'success') {
            console.log(`✅ Payment successful for user ${userId}, activating subscription...`);

            // Calculate expiry
            const days = payment.subscriptionMonths * 30;
            const newExpiry = Date.now() + (days * 24 * 60 * 60 * 1000);

            // Generate VPN key
            const newUuid = uuidv4();
            const newEmail = `premium_${userId}_${Date.now()}`;

            const result = await api.addClient(
                { uuid: newUuid, email: newEmail },
                parseInt(process.env.PREMIUM_INBOUND_ID),
                newExpiry
            );

            if (result.success) {
                // Update user subscription
                user.subscriptionStatus = 'premium';
                user.keyExpiry = new Date(newExpiry);
                user.uuid = newUuid;
                user.email = newEmail;
                user.inboundId = parseInt(process.env.PREMIUM_INBOUND_ID);
                await user.save();

                // Send VPN key to user
                const host = getHost();
                const vlessLink = `vless://${newUuid}@${host}:443?security=reality&type=grpc&fp=chrome&sni=google.com&serviceName=grpc#Portal_Premium_${user.firstName}`;

                await bot.telegram.sendMessage(
                    userId,
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

                console.log(`✅ Subscription activated for user ${userId}`);
            } else {
                console.error(`Failed to create VPN key for user ${userId}:`, result.msg);
                await bot.telegram.sendMessage(
                    userId,
                    '⚠️ Оплата прошла успешно, но возникла проблема с активацией ключа. Обратитесь в поддержку.'
                );
            }
        } else if (status === 'failed') {
            console.log(`❌ Payment failed for user ${userId}`);
            await bot.telegram.sendMessage(
                userId,
                '❌ *Оплата не прошла*\n\nПопробуйте еще раз или обратитесь в поддержку.',
                { parse_mode: 'Markdown' }
            );
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start webhook server
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3000;
app.listen(WEBHOOK_PORT, () => {
    console.log(`🌐 Webhook server listening on port ${WEBHOOK_PORT}`);
    console.log(`📡 Webhook URL: ${process.env.WEBHOOK_BASE_URL}/webhook/platega`);
});


// Start Bot safely
(async () => {
    try {
        await connectDB();
        bot.launch().then(() => console.log('Bot started!'));
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
})();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
