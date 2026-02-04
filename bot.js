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
        let user = await getUser(ctx);

        if (!user) {
            // New User: Create Trial
            ctx.reply('Добро пожаловать в Portal! 👋Ваш доступ активирован. У вас есть 3 дня, чтобы протестировать полную скорость без ограничений.Чтобы начать:Нажмите кнопку «🔗 Подключиться» ниже.');

            const uuid = uuidv4();
            const email = `trial_${ctx.from.id}`;
            const expiryTime = Date.now() + (2 * 24 * 60 * 60 * 1000); // 2 Days in ms

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

                ctx.reply(`✅ *Trial Activated!*\n\n🔑 *UUID:* \`${uuid}\`\n📅 *Expires:* ${user.keyExpiry.toLocaleString()}\n\n⬇️ *Connection Link:*`, { parse_mode: 'Markdown' });
                ctx.reply(`vless://${uuid}@your-domain:443?security=reality&type=grpc&fp=chrome&sni=google.com&serviceName=grpc#Trial_${ctx.from.id}`); // Placeholder link format
            } else {
                ctx.reply(`❌ Failed to generate key: ${result.msg}`);
                console.error(result);
            }

        } else if (user.subscriptionStatus === 'trial') {
            // Check if expired
            if (new Date() > user.keyExpiry) {
                ctx.reply('⚠️ Your trial has expired.', Markup.inlineKeyboard([
                    Markup.button.callback('💎 Buy Premium ($5/Month)', 'buy_premium')
                ]));
            } else {
                ctx.reply(`✅ Your trial is active.\n\n🔑 UUID: \`${user.uuid}\`\n📅 Expires: ${user.keyExpiry.toLocaleString()}`, { parse_mode: 'Markdown' });
            }
        } else if (user.subscriptionStatus === 'premium') {
            ctx.reply(`💎 Premium Active.\n\n📅 Expires: ${user.keyExpiry.toLocaleString()}`);
        }

    } catch (err) {
        console.error('Start error:', err);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Buy Premium Action (Mock)
bot.action('buy_premium', async (ctx) => {
    ctx.reply('💳 Please confirm payment of $5 for 1 Month Access.', Markup.inlineKeyboard([
        Markup.button.callback('✅ Confirm Payment', 'confirm_payment'),
        Markup.button.callback('❌ Cancel', 'cancel_payment')
    ]));
});

bot.action('confirm_payment', async (ctx) => {
    try {
        const user = await getUser(ctx);
        if (!user) return ctx.reply('User not found. Please type /start.');

        // Mock Payment Success
        const newExpiry = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 Days

        // Update on Panel (Or add new client on Premium Inbound)
        // For simplicity, let's assume we move them to Premium Inbound
        // Note: In 3X-UI moving inbounds usually means deleting and re-adding or just adding new.
        // Let's try adding a NEW client on the PREMIUM Inbound with the SAME UUID to avoid config changes on client side if ports/protocols allow?
        // Or generate new. User requirement: "get the new bound id". 
        // So we generate a NEW KEY on the PREMIUM INBOUND.

        const newUuid = uuidv4();
        const newEmail = `premium_${ctx.from.id}`;

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

            ctx.reply(`🎉 *Payment Successful!*\n\n💎 *Premium Activated* for 1 Month.\n\n🔑 *New UUID:* \`${newUuid}\`\n📅 *Expires:* ${user.keyExpiry.toLocaleString()}`, { parse_mode: 'Markdown' });
        } else {
            ctx.reply('❌ Failed to activate premium on the server. Please contact support.');
        }

    } catch (err) {
        console.error('Payment error:', err);
        ctx.reply('Payment processing failed.');
    }
});

bot.action('cancel_payment', (ctx) => {
    ctx.reply('Payment cancelled.');
});

bot.launch().then(() => console.log('Bot started!'));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
