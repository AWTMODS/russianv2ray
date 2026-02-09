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

class PortalBot {

```
constructor() {
    this.bot = new Telegraf(process.env.BOT_TOKEN);
    this.app = express();
    this.WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3000;
}

// =========================
// INIT
// =========================

async init() {
    await connectDB();
    this.setupMiddleware();
    this.setupHelpers();
    this.setupHandlers();
    this.setupWebhookServer();
    this.setupGracefulStop();
    await this.bot.launch();
    console.log('🤖 Bot started!');
}

// =========================
// MIDDLEWARE
// =========================

setupMiddleware() {
    this.app.use(bodyParser.json());

    this.bot.catch((err, ctx) => {
        console.error('Telegraf error:', err);
        ctx?.reply?.('⚠️ Unexpected error occurred.');
    });
}

// =========================
// HELPERS
// =========================

setupHelpers() {
    this.getUser = async (ctx) => {
        return await User.findOne({ telegramId: ctx.from.id.toString() });
    };

    this.getHost = () => {
        try {
            return new URL(process.env.PANEL_URL).hostname;
        } catch {
            return 'your-domain';
        }
    };

    this.mdEscape = (t = '') =>
        t.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// =========================
// TELEGRAM HANDLERS
// =========================

setupHandlers() {

    // ---------- START ----------
    this.bot.start(async (ctx) => {
        try {
            let user = await this.getUser(ctx);

            if (!user) {
                user = await User.create({
                    telegramId: ctx.from.id.toString(),
                    username: ctx.from.username,
                    firstName: ctx.from.first_name,
                    lastName: ctx.from.last_name
                });
            }

            const text = `*Portal — твой личный выход в свободный интернет.*`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🔗 Подключиться', 'get_trial_key')],
                [Markup.button.callback('💎 Купить Premium', 'buy_premium')]
            ]);

            const banner = path.join(__dirname, 'banner.jpg');

            if (fs.existsSync(banner)) {
                await ctx.replyWithPhoto({ source: banner }, {
                    caption: text,
                    parse_mode: 'Markdown',
                    ...keyboard
                });
            } else {
                await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
            }

        } catch (e) {
            console.error(e);
            ctx.reply('Error');
        }
    });

    // ---------- TRIAL ----------
    this.bot.action('get_trial_key', async (ctx) => {
        await ctx.answerCbQuery().catch(()=>{});

        let user = await this.getUser(ctx);

        if (user?.trialUsed && user.keyExpiry > new Date()) {
            const safe = this.mdEscape(ctx.from.first_name);
            const link = `vless://${user.uuid}@${this.getHost()}:443?...#Portal_${safe}`;
            return ctx.reply(`🔑 \`${link}\``, { parse_mode:'Markdown'});
        }

        const uuid = uuidv4();
        const expiry = Date.now() + 3*24*60*60*1000;

        const r = await api.addClient(
            { uuid, email:`trial_${ctx.from.id}` },
            parseInt(process.env.TRIAL_INBOUND_ID),
            expiry
        );

        if (!r.success) return ctx.reply('Panel error');

        await User.updateOne(
            { telegramId: ctx.from.id.toString() },
            { trialUsed:true, uuid, keyExpiry:new Date(expiry), subscriptionStatus:'trial' },
            { upsert:true }
        );

        ctx.reply('✅ Trial created');
    });

    // ---------- BUY ----------
    this.bot.action('buy_premium', async (ctx)=>{
        await ctx.answerCbQuery().catch(()=>{});

        ctx.reply('*Тарифы*', {
            parse_mode:'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('1 Месяц','select_1_month')]
            ])
        });
    });

    // ---------- PAYMENT SELECT ----------
    this.bot.action('select_1_month',
        (ctx)=>this.handlePayment(ctx,1,180)
    );
}

// =========================
// PAYMENT FLOW
// =========================

async handlePayment(ctx, months, cost) {
    await ctx.answerCbQuery().catch(()=>{});

    const pay = await platega.createPayment(
        cost,
        `Portal ${months}m`,
        ctx.from.id.toString()
    );

    if (!pay.success) return ctx.reply('Payment error');

    await Payment.create({
        transactionId: pay.transactionId,
        externalId: pay.externalId,
        userId: ctx.from.id.toString(),
        amount: cost,
        subscriptionMonths: months
    });

    ctx.reply('💳 Оплатить:', Markup.inlineKeyboard([
        Markup.button.url('Оплатить', pay.paymentUrl)
    ]));
}

// =========================
// WEBHOOK SERVER
// =========================

setupWebhookServer() {

    this.app.post('/webhook/platega', async (req,res)=>{
        try {
            const data = platega.processWebhook(req.body);
            const payment = await Payment.findOne({
                transactionId: data.transactionId
            });

            if (!payment) return res.sendStatus(404);

            payment.status = data.status;
            await payment.save();

            if (data.status === 'success') {
                await this.bot.telegram.sendMessage(
                    data.userId,
                    '🎉 Оплата прошла!'
                );
            }

            res.json({ok:true});
        } catch(e){
            console.error(e);
            res.sendStatus(500);
        }
    });

    this.app.listen(this.WEBHOOK_PORT, ()=>{
        console.log(`🌐 Webhook server ${this.WEBHOOK_PORT}`);
    });
}

// =========================
// STOP
// =========================

setupGracefulStop() {
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
}
```

}

// =========================
// START APP
// =========================

new PortalBot().init();
