require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const api = require('./api');
const { User, connectDB } = require('./db');

// Connect to Database
connectDB();

const bot = new Telegraf(process.env.BOT_TOKEN);

// User State Helper
const getUser = async (ctx) => {
    return await User.findOne({ telegramId: ctx.from.id.toString() });
};

// Start Command
bot.start(async (ctx) => {
    try {
        ctx.reply(
            '*Добро пожаловать в Portal!* 👋\n\nВаш доступ активирован. У вас есть *3 дня*, чтобы протестировать полную скорость без ограничений.\n\nЧтобы начать:\nНажмите кнопку «🔗 Подключиться» ниже.',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    Markup.button.callback('🔗 Подключиться', 'get_trial_key'),
                    Markup.button.callback('💎 Купить Premium', 'buy_premium')
                ])
            }
        );
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

// Buy Premium Action (Mock)
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
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
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

// Selection Handlers
bot.action('select_1_month', (ctx) => {
    ctx.reply('💳 Подтвердите оплату 180₽ за 1 Месяц.', Markup.inlineKeyboard([
        Markup.button.callback('✅ Оплатить', 'confirm_payment_1_month'),
        Markup.button.callback('❌ Отмена', 'cancel_payment')
    ]));
});

bot.action('select_3_months', (ctx) => {
    ctx.reply('💳 Подтвердите оплату 400₽ за 3 Месяца.', Markup.inlineKeyboard([
        Markup.button.callback('✅ Оплатить', 'confirm_payment_3_months'),
        Markup.button.callback('❌ Отмена', 'cancel_payment')
    ]));
});

bot.action('select_6_months', (ctx) => {
    ctx.reply('💳 Подтвердите оплату 750₽ за 6 Месяцев.', Markup.inlineKeyboard([
        Markup.button.callback('✅ Оплатить', 'confirm_payment_6_months'),
        Markup.button.callback('❌ Отмена', 'cancel_payment')
    ]));
});

bot.action('select_1_year', (ctx) => {
    ctx.reply('💳 Подтвердите оплату 900₽ за 1 Год.', Markup.inlineKeyboard([
        Markup.button.callback('✅ Оплатить', 'confirm_payment_1_year'),
        Markup.button.callback('❌ Отмена', 'cancel_payment')
    ]));
});

const handlePayment = async (ctx, months, cost) => {
    try {
        const user = await getUser(ctx);
        if (!user) return ctx.reply('Пользователь не найден. Введите /start.');

        // Mock Payment Success
        const days = months * 30; // Approximation
        const newExpiry = Date.now() + (days * 24 * 60 * 60 * 1000);

        // Generate new key on premium inbound
        const newUuid = uuidv4();
        const newEmail = `premium_${ctx.from.id}_${Date.now()}`;

        const result = await api.addClient(
            { uuid: newUuid, email: newEmail },
            parseInt(process.env.PREMIUM_INBOUND_ID),
            newExpiry
        );

        if (result.success) {
            user.subscriptionStatus = 'premium';
            user.keyExpiry = new Date(newExpiry);
            user.uuid = newUuid;
            user.email = newEmail;
            user.inboundId = parseInt(process.env.PREMIUM_INBOUND_ID);
            await user.save();

            const host = getHost();
            const vlessLink = `vless://${newUuid}@${host}:443?security=reality&type=grpc&fp=chrome&sni=google.com&serviceName=grpc#Portal_Premium_${ctx.from.first_name}`;

            ctx.reply(`🎉 *Оплата прошла успешно!*\n\n💎 *Premium активирован* на ${months} мес.\n\n🔑 *Ваш новый ключ:*\n\`${vlessLink}\`\n\n📅 *Истекает:* ${user.keyExpiry.toLocaleString()}`, { parse_mode: 'Markdown' });
        } else {
            ctx.reply('❌ Ошибка активации на сервере. Обратитесь в поддержку.');
        }

    } catch (err) {
        console.error('Payment error:', err);
        ctx.reply('Ошибка обработки платежа.');
    }
};

bot.action('confirm_payment_1_month', (ctx) => handlePayment(ctx, 1, 180));
bot.action('confirm_payment_3_months', (ctx) => handlePayment(ctx, 3, 400));
bot.action('confirm_payment_6_months', (ctx) => handlePayment(ctx, 6, 750));
bot.action('confirm_payment_1_year', (ctx) => handlePayment(ctx, 12, 900));

bot.action('cancel_payment', (ctx) => {
    ctx.reply('Оплата отменена.');
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
