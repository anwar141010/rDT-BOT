// MDT Discord Bot - متعدد السيرفرات
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, 'data.json');
const { createCanvas, loadImage } = require('canvas');
const { generateMilitaryPageImage } = require('./militaryImage');

// تحميل بيانات الهويات من الملف عند بدء التشغيل
let identities = [];
let pendingRequests = []; // طلبات معلقة

// متغير لتتبع حالة البوت (تشغيل/إيقاف)
let botStatus = 'online'; // 'online' أو 'offline'

// متغير لتخزين اسم البوت الأصلي
let originalBotName = '';

// بيانات العسكر
let militaryData = {
  users: {}, // بيانات المستخدمين العسكريين
  codes: {}, // الأكواد العسكرية
  points: {} // نقاط العسكر
};

// طلبات الأكواد العسكرية المعلقة
let pendingMilitaryCodeRequests = [];

// صفحات مباشرة العسكر (كل صفحة فيها 10 عسكري)
let militaryActivePages = [];
// بيانات كل عسكري (userId: { fullName, code, rank, status })
let militaryUsers = {};

// نظام التحذيرات العسكرية
let militaryWarnings = {}; // { guildId: { userId: [{ id, warningNumber, reason, adminId, adminName, adminRank, date, evidence, removed, removalReason, removalDate, removalAdminId, removalAdminName }] } }

// قائمة المطورين المصرح لهم (أيدياتهم)
const DEVELOPER_IDS = [
  '1337512375355707412', // المطور الأول
  '1291805249815711826', // المطور الثاني  
  '1355958988524622076', // المطور الثالث
  '1319791882389164072'  // المطور الرابع
];

try {
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    identities = data.identities || [];
    pendingRequests = data.pendingRequests || [];
    botStatus = data.botStatus || 'online'; // تحميل حالة البوت
    originalBotName = data.originalBotName || ''; // تحميل اسم البوت الأصلي
    militaryData = data.militaryData || { users: {}, codes: {}, points: {} }; // تحميل بيانات العسكر
    pendingMilitaryCodeRequests = data.pendingMilitaryCodeRequests || []; // تحميل طلبات الأكواد العسكرية المعلقة
    militaryActivePages = data.militaryActivePages || [];
    militaryUsers = data.militaryUsers || {};
    militaryWarnings = data.militaryWarnings || {};
  }
  } catch (e) {
  identities = [];
  pendingRequests = [];
  botStatus = 'online'; // الحالة الافتراضية
  originalBotName = '';
  militaryData = { users: {}, codes: {}, points: {} };
  pendingMilitaryCodeRequests = [];
  militaryActivePages = [];
  militaryUsers = {};
  militaryWarnings = {};
}

// --- إعدادات السيرفرات ---
let guildSettings = {};
try {
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    guildSettings = data.guildSettings || {};
  }
} catch (e) {
  guildSettings = {};
}

// دالة حفظ موحدة لكل البيانات
function saveAllData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    identities,
    pendingRequests,
    guildSettings,
    botStatus,
    originalBotName,
    militaryData,
    pendingMilitaryCodeRequests,
    militaryActivePages,
    militaryUsers,
    militaryWarnings
  }, null, 2), 'utf8');
}

// دالة إضافة خيار إعادة تعيين للقوائم المنسدلة
function addResetOption(options) {
  if (Array.isArray(options)) {
    return [...options, { label: 'إعادة تعيين', value: 'reset_page', description: 'تحديث الصفحة' }];
  } else {
    return [options, { label: 'إعادة تعيين', value: 'reset_page', description: 'تحديث الصفحة' }];
  }
}

// دالة إضافة زر إعادة تعيين للمكونات
function addResetButton(components) {
  if (Array.isArray(components)) {
    return components;
  } else {
    return [components];
  }
}

// ترقية المخالفات القديمة ليكون لكل مخالفة id فريد
let updated = false;
identities.forEach(identity => {
  if (identity.violations && Array.isArray(identity.violations)) {
    identity.violations.forEach(v => {
      if (!v.id) {
        v.id = Date.now().toString() + Math.random().toString().slice(2,8);
        updated = true;
      }
    });
  }
});
if (updated) saveAllData();

function saveGuildSettings() {
  // دمج مع بيانات الهويات والطلبات
  let data = {};
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  data.guildSettings = guildSettings;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// متغير لتخزين خطوات المستخدم
let userSteps = {};

// دالة للتحقق من وجود طلب معلق
function hasPendingRequest(userId, guildId) {
  return pendingRequests.some(req => req.userId === userId && req.guildId === guildId);
}

// دالة للتحقق من وجود هوية مقبولة
function hasApprovedIdentity(userId, guildId) {
  return identities.some(id => id.userId === userId && id.guildId === guildId);
}

// دالة للتحقق من أن المستخدم مطور مصرح له
function isDeveloper(userId) {
  return DEVELOPER_IDS.includes(userId);
}

// دالة مساعدة للتحقق من روم الإنشاء
function isInCreateRoom(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) return false;
  const settings = guildSettings[guildId];
  if (!settings || !settings.createRoomChannelId) return false;
  return interaction.channelId === settings.createRoomChannelId;
}

// دالة مساعدة للتحقق من رتبة الشرطة
function hasPoliceRole(member, guildId) {
  const policeRoleId = guildSettings[guildId]?.policeRoleId;
  return policeRoleId && member.roles.cache.has(policeRoleId);
}

// دالة التحقق من رتبة مسؤول الشرطة
function hasPoliceAdminRole(member, guildId) {
  const policeAdminRoleId = guildSettings[guildId]?.policeAdminRoleId;
  return policeAdminRoleId && member.roles.cache.has(policeAdminRoleId);
}

// دالة تغيير حالة البوت
async function toggleBotStatus() {
  const newStatus = botStatus === 'online' ? 'offline' : 'online';
  
  // حفظ اسم البوت الأصلي إذا كان هذا أول تشغيل
  if (!originalBotName) {
    originalBotName = client.user.username;
  }
  
  // تغيير اسم البوت حسب الحالة
  try {
    if (newStatus === 'offline') {
      await client.user.setUsername(`${originalBotName} متوقف`);
    } else {
      await client.user.setUsername(originalBotName);
    }
  } catch (error) {
    console.error('خطأ في تغيير اسم البوت:', error);
  }
  
  botStatus = newStatus;
  saveAllData(); // حفظ الحالة في الملف
  return botStatus;
}

// دالة الحصول على حالة البوت
function getBotStatus() {
  return botStatus;
}

// دالة للتحقق من حالة البوت قبل تنفيذ أي أمر
function checkBotStatus() {
  return botStatus === 'online';
}

// دوال مساعدة للعسكر
function isMilitaryUser(userId, guildId) {
  return militaryUsers[userId] && militaryUsers[userId].guildId === guildId;
}

function getMilitaryUser(userId, guildId) {
  return militaryUsers[userId] || null;
}

function getMilitaryPoints(userId, guildId) {
  return militaryData.points[guildId]?.[userId] || 0;
}

function addMilitaryPoints(userId, guildId, points) {
  if (!militaryData.points[guildId]) militaryData.points[guildId] = {};
  if (!militaryData.points[guildId][userId]) militaryData.points[guildId][userId] = 0;
  militaryData.points[guildId][userId] += points;
  saveAllData();
}

function removeMilitaryPoints(userId, guildId, points) {
  if (!militaryData.points[guildId]) militaryData.points[guildId] = {};
  if (!militaryData.points[guildId][userId]) militaryData.points[guildId][userId] = 0;
  militaryData.points[guildId][userId] = Math.max(0, militaryData.points[guildId][userId] - points);
  saveAllData();
}

function setMilitaryPoints(userId, guildId, points) {
  if (!militaryData.points[guildId]) militaryData.points[guildId] = {};
  militaryData.points[guildId][userId] = Math.max(0, points);
  saveAllData();
}

function getAllMilitaryPoints(guildId) {
  if (!militaryData.points[guildId]) return [];
  return Object.entries(militaryData.points[guildId])
    .map(([userId, points]) => ({ userId, points }))
    .sort((a, b) => b.points - a.points); // ترتيب تنازلي حسب النقاط
}

function setMilitaryCode(userId, guildId, code) {
  if (!militaryData.codes[guildId]) militaryData.codes[guildId] = {};
  militaryData.codes[guildId][userId] = code;
  saveAllData();
}

function getMilitaryCode(userId, guildId) {
  return militaryData.codes[guildId]?.[userId] || null;
}

// دالة للتحقق من وجود طلب كود عسكري معلق
function hasPendingMilitaryCodeRequest(userId, guildId) {
  return pendingMilitaryCodeRequests.some(req => req.userId === userId && req.guildId === guildId);
}

// === دوال نظام التحذيرات العسكرية ===

// دالة لإضافة تحذير عسكري
function addMilitaryWarning(userId, guildId, warningNumber, reason, adminId, adminName, adminRank) {
  if (!militaryWarnings[guildId]) militaryWarnings[guildId] = {};
  if (!militaryWarnings[guildId][userId]) militaryWarnings[guildId][userId] = [];
  
  // توليد معرف من 4 أرقام
  let warningId;
  do {
    warningId = Math.floor(1000 + Math.random() * 9000).toString(); // 1000-9999
  } while (militaryWarnings[guildId][userId].some(w => w.id === warningId));
  
  const warning = {
    id: warningId,
    warningNumber: warningNumber,
    reason: reason,
    adminId: adminId,
    adminName: adminName,
    adminRank: adminRank,
    date: new Date().toISOString(),
    evidence: null,
    removed: false,
    removalReason: null,
    removalDate: null,
    removalAdminId: null,
    removalAdminName: null
  };
  
  militaryWarnings[guildId][userId].push(warning);
  saveAllData();
  return warning;
}

// دالة لجلب تحذيرات العسكري
function getMilitaryWarnings(userId, guildId) {
  if (!militaryWarnings[guildId] || !militaryWarnings[guildId][userId]) return [];
  return militaryWarnings[guildId][userId].filter(w => !w.removed);
}

// دالة لجلب جميع التحذيرات (النشطة والمحذوفة)
function getAllMilitaryWarnings(userId, guildId) {
  if (!militaryWarnings[guildId] || !militaryWarnings[guildId][userId]) return [];
  return militaryWarnings[guildId][userId];
}

// دالة لإضافة دليل تحذير
function addWarningEvidence(warningId, userId, guildId, evidenceUrl) {
  if (!militaryWarnings[guildId] || !militaryWarnings[guildId][userId]) return false;
  
  const warning = militaryWarnings[guildId][userId].find(w => w.id === warningId);
  if (warning) {
    warning.evidence = evidenceUrl;
    saveAllData();
    return true;
  }
  return false;
}

// دالة لحذف تحذير
function removeMilitaryWarning(warningId, userId, guildId, removalReason, removalAdminId, removalAdminName) {
  if (!militaryWarnings[guildId] || !militaryWarnings[guildId][userId]) return false;
  
  const warning = militaryWarnings[guildId][userId].find(w => w.id === warningId);
  if (warning) {
    warning.removed = true;
    warning.removalReason = removalReason;
    warning.removalDate = new Date().toISOString();
    warning.removalAdminId = removalAdminId;
    warning.removalAdminName = removalAdminName;
    saveAllData();
    return true;
  }
  return false;
}

// === دوال نظام مباشرة العسكر ===

// دالة لتحديث حالة العسكري
function updateMilitaryUserStatus(userId, guildId, status) {
  if (!militaryUsers[userId]) {
    // إنشاء عسكري جديد
    const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
    if (!identity) return false;
    
    militaryUsers[userId] = {
      fullName: identity.fullName,
      code: getMilitaryCode(userId, guildId) || 'غير محدد',
      rank: 'عسكري', // يمكن تحديثها لاحقاً
      status: status,
      lastUpdate: new Date().toISOString(),
      guildId: guildId
    };
  } else {
    // تحديث حالة العسكري الموجود
    militaryUsers[userId].status = status;
    militaryUsers[userId].lastUpdate = new Date().toISOString();
    
    // التأكد من وجود الرتبة العسكرية
    if (!militaryUsers[userId].rank) {
      militaryUsers[userId].rank = 'عسكري';
    }
  }
  
  saveAllData();
  return true;
}

// دالة لتحديث الصورة في روم مباشرة العسكر
async function updateMilitaryPageImage(guildId) {
  try {
    const directRoomId = guildSettings[guildId]?.directMilitaryRoomId;
    if (!directRoomId) return false;
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    
    const channel = guild.channels.cache.get(directRoomId);
    if (!channel) return false;
    
    // جلب جميع العسكريين النشطين في هذا السيرفر
    const activeUsers = Object.values(militaryUsers).filter(user => user.guildId === guildId);
    
    // حساب العدادات
    const counters = {
      in: activeUsers.filter(u => u.status === 'in').length,
      out: activeUsers.filter(u => u.status === 'out').length,
      ended: activeUsers.filter(u => u.status === 'ended').length
    };
    
                        // تقسيم العسكريين إلى صفحات (10 عسكري لكل صفحة)
                    const pageSize = 10;
    const pages = [];
    for (let i = 0; i < activeUsers.length; i += pageSize) {
      pages.push(activeUsers.slice(i, i + pageSize));
    }
    
                                            // إذا لم تكن هناك صفحات، أنشئ صفحة فارغة
                    if (pages.length === 0) {
                      pages.push([]);
                    }
                    
                    // تحديث أو إنشاء الصفحات (كل صفحة تحتوي على 10 عساكر)
                    for (let i = 0; i < pages.length; i++) {
                      const pageUsers = pages[i];
                      const pageIndex = i;
                      
                      // البحث عن الصفحة الموجودة
                      let page = militaryActivePages.find(p => p.guildId === guildId && p.pageIndex === pageIndex);
                      
                      if (page && page.messageId) {
                        // تحديث الصفحة الموجودة
                        try {
                          const message = await channel.messages.fetch(page.messageId);
                          const imageBuffer = await generateMilitaryPageImage(pageUsers, counters);
                          const attachment = new AttachmentBuilder(imageBuffer, { name: 'military_page.png' });
                          
                          await message.edit({ 
                            content: `**صفحة ${pageIndex + 1} من ${pages.length}**`,
                            files: [attachment] 
                          });
                        } catch (e) {
                          console.error('خطأ في تحديث الصفحة:', e);
                          // إذا فشل التحديث، احذف الصفحة من القائمة
                          militaryActivePages = militaryActivePages.filter(p => p.messageId !== page.messageId);
                          page = null;
                        }
                      }
                      
                      if (!page) {
                        // إنشاء صفحة جديدة (عندما تكتمل الصفحة بـ 10 عساكر)
        try {
          const imageBuffer = await generateMilitaryPageImage(pageUsers, counters);
          const attachment = new AttachmentBuilder(imageBuffer, { name: 'military_page.png' });
          
          const message = await channel.send({ 
            content: `**صفحة ${pageIndex + 1} من ${pages.length}**`,
            files: [attachment] 
          });
          
          // حفظ معرف الرسالة
          militaryActivePages.push({
            guildId: guildId,
            pageIndex: pageIndex,
            messageId: message.id,
            users: pageUsers.map(u => u.userId)
          });
          
          saveAllData();
        } catch (e) {
          console.error('خطأ في إنشاء صفحة جديدة:', e);
        }
      }
    }
    
    return true;
  } catch (e) {
    console.error('خطأ في تحديث صورة مباشرة العسكر:', e);
    return false;
  }
}

// دالة لإضافة عسكري جديد أو تحديث بياناته
function addOrUpdateMilitaryUser(userId, guildId, data) {
  if (!militaryUsers[userId]) {
    militaryUsers[userId] = {
      fullName: data.fullName,
      code: data.code || getMilitaryCode(userId, guildId) || 'غير محدد',
      rank: data.rank || 'عسكري',
      status: data.status || 'in',
      lastUpdate: new Date().toISOString(),
      guildId: guildId
    };
  } else {
    // تحديث البيانات الموجودة
    Object.assign(militaryUsers[userId], {
      ...data,
      lastUpdate: new Date().toISOString()
    });
    
    // التأكد من وجود الرتبة العسكرية
    if (!militaryUsers[userId].rank) {
      militaryUsers[userId].rank = 'عسكري';
    }
  }
  
  saveAllData();
  return true;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// --- إضافة تسجيل أمر /بطاقة عند تشغيل البوت ---
const commands = [
  new SlashCommandBuilder()
    .setName('بطاقة')
    .setDescription('إنشاء بطاقة هوية')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  // إضافة أمر /الادارة
  new SlashCommandBuilder()
    .setName('الادارة')
    .setDescription('إعدادات إدارة الهويات')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  // إضافة أمر /هويتي
  new SlashCommandBuilder()
    .setName('هويتي')
    .setDescription('عرض هويتك ومخالفاتك')
    .toJSON(),
  // إضافة أمر /الشرطة
  new SlashCommandBuilder()
    .setName('الشرطة')
    .setDescription('أوامر الشرطة')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  // إضافة أمر /المطور
  new SlashCommandBuilder()
    .setName('المطور')
    .setDescription('أوامر خاصة بمطورين البوت')
    .toJSON(),
  // إضافة أمر /العسكر
  new SlashCommandBuilder()
    .setName('العسكر')
    .setDescription('نظام العسكر - للأدمن فقط')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON()
];

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🔧 حالة البوت: ${getBotStatus() === 'online' ? '🟢 متصل' : '🔴 غير متصل'}`);
  
  // إضافة خادم HTTP بسيط للـ port binding
  const http = require('http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MDT Bot is running!');
  });
  
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
  });
  
  // حفظ اسم البوت الأصلي إذا لم يكن محفوظاً
  if (!originalBotName) {
    originalBotName = client.user.username;
    saveAllData();
  }
  
  // تغيير اسم البوت حسب الحالة المحفوظة
  if (getBotStatus() === 'offline' && originalBotName) {
    try {
      await client.user.setUsername(`${originalBotName} متوقف`);
      console.log(`🔧 تم تغيير اسم البوت إلى: ${originalBotName} متوقف`);
    } catch (error) {
      console.error('❌ خطأ في تغيير اسم البوت:', error);
    }
  }
  
  // تسجيل الأمر في جميع السيرفرات التي يوجد بها البوت
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ تم تسجيل أمر /بطاقة بنجاح');
  } catch (error) {
    console.error('❌ فشل تسجيل الأمر:', error);
  }
});

client.on('messageCreate', message => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    message.reply('🏓 Pong!');
  }
});

client.on('interactionCreate', async interaction => {
  try {
    // --- التحقق من حالة البوت أولاً ---
    if (!checkBotStatus() && interaction.commandName !== 'المطور' && 
        !interaction.customId?.startsWith('dev_') && 
        !interaction.customId?.startsWith('toggle_bot_') && 
        !interaction.customId?.startsWith('change_embed_')) {
      // الحصول على أول مطور في السيرفر
      let developerMention = '';
      try {
        const guild = interaction.guild;
        if (guild) {
          const owner = await guild.fetchOwner();
          developerMention = owner ? `<@${owner.id}>` : 'المطور';
        }
      } catch (e) {
        developerMention = 'المطور';
      }
      
      await interaction.reply({ 
        content: `🔴 البوت حالياً متوقف من أحد المطورين يرجى التواصل مع المطور ${developerMention}`, 
        ephemeral: true 
      });
      return;
    }

    // --- التحقق من الإعدادات قبل أي إجراء هوية ---
    function checkGuildSettings(guildId) {
      const s = guildSettings[guildId];
      return s && s.logChannelId && s.reviewChannelId && s.approvalRoleId;
    }

    // معالجة أمر /بطاقة
    if (interaction.isChatInputCommand() && interaction.commandName === 'بطاقة') {
      // تحقق من الإعدادات
      if (!checkGuildSettings(interaction.guildId)) {
        await interaction.reply({ content: '❌ يجب تعيين جميع الإعدادات أولاً من خلال /الادارة.', ephemeral: true });
        return;
      }
      // تحقق من روم الإنشاء
      if (!isInCreateRoom(interaction)) {
        await interaction.reply({ content: '❌ لا يمكن إنشاء الهوية إلا في روم الإنشاء المخصص.', ephemeral: true });
        return;
      }
      // Embed مع الصورة المطلوبة
      const customImage = guildSettings[interaction.guildId]?.customEmbedImage || 'https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless';
      const embed = new EmbedBuilder()
        .setTitle('بطاقة الهوية')
        .setDescription('اضغط على الزر أدناه لبدء إنشاء بطاقة الهوية الخاصة بك.')
        .setImage(customImage)
        .setColor('#00ff00');
      // زر بدء الإنشاء
      const button = new ButtonBuilder()
        .setCustomId('start_id_card')
        .setLabel('بدء إنشاء بطاقة هوية')
        .setStyle(ButtonStyle.Primary);
      const row = new ActionRowBuilder().addComponents(button);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
      return;
    }
    
    // عند الضغط على زر بدء الإنشاء في الروم
    if (interaction.isButton() && interaction.customId === 'start_id_card') {
      // تحقق من وجود طلب معلق أو هوية مقبولة
      if (hasPendingRequest(interaction.user.id, interaction.guildId)) {
        await interaction.reply({ 
          content: '❌ لديك طلب هوية معلق بالفعل. يرجى الانتظار حتى يتم مراجعته.', 
          ephemeral: true 
        });
        return;
      }
      if (hasApprovedIdentity(interaction.user.id, interaction.guildId)) {
        await interaction.reply({ 
          content: '❌ لديك هوية مقبولة بالفعل. لا يمكنك إنشاء هوية جديدة.', 
          ephemeral: true 
        });
        return;
      }
      // زر الاسم الكامل مباشرة في نفس الروم
      const nameButton = new ButtonBuilder()
        .setCustomId('full_name')
        .setLabel('الاسم الكامل')
        .setStyle(ButtonStyle.Secondary);
      const nameRow = new ActionRowBuilder().addComponents(nameButton);
      await interaction.reply({ content: 'اضغط على الزر لإدخال اسمك الكامل:', components: [nameRow], ephemeral: true });
      return;
    }
    
    // معالجة الضغط على الأزرار
    if (interaction.isButton()) {
      // في بداية كل خطوة تفاعل تخص الهوية (الأزرار، القوائم، المودالات)
      // أضف التحقق التالي:
      if (
        (interaction.isButton() && [
          'start_id_card', 'begin_id_card', 'full_name'
        ].some(id => interaction.customId.startsWith(id))) ||
        (interaction.isStringSelectMenu() && [
          'select_gender', 'select_city', 'select_year', 'select_month', 'select_day'
        ].includes(interaction.customId)) ||
        (interaction.isModalSubmit() && [
          'modal_full_name'
        ].includes(interaction.customId))
      ) {
        if (!isInCreateRoom(interaction)) {
          await interaction.reply({ content: '❌ لا يمكن إكمال خطوات الهوية إلا في روم الإنشاء المخصص.', ephemeral: true });
          return;
        }
      }
      
      // تحقق من الرتبة عند قبول أو رفض الهوية أو الأكواد العسكرية
      if (interaction.isButton() && (interaction.customId.startsWith('accept_') || interaction.customId.startsWith('reject_'))) {
        const guild = interaction.guild;
        const member = interaction.member;
        
        // التحقق من نوع الطلب (هوية أم كود عسكري)
        if (interaction.customId.includes('military_code_')) {
          // طلب كود عسكري - يحتاج رتبة مسؤول الشرطة
          const policeAdminRoleId = guildSettings[interaction.guildId]?.policeAdminRoleId;
          if (!policeAdminRoleId || !member.roles.cache.has(policeAdminRoleId)) {
            await interaction.reply({ content: '❌ ليس لديك صلاحية القبول أو الرفض. يجب أن تحمل رتبة مسؤول الشرطة.', ephemeral: true });
            return;
          }
        } else {
          // طلب هوية - يحتاج رتبة القبول/الرفض
          const approvalRoleId = guildSettings[interaction.guildId]?.approvalRoleId;
          if (!approvalRoleId || !member.roles.cache.has(approvalRoleId)) {
            await interaction.reply({ content: '❌ ليس لديك صلاحية القبول أو الرفض. يجب أن تحمل رتبة القبول/الرفض.', ephemeral: true });
            return;
          }
        }
      }
      
      // عند الضغط على زر begin_id_card في الخاص
      if (interaction.customId === 'begin_id_card') {
        // تحقق من وجود guildId في userSteps
        const guildId = userSteps[interaction.user.id]?.guildId;
        if (!guildId) {
          await interaction.reply({ content: '❌ لا يمكن العثور على السيرفر الأصلي لهذا الطلب. يرجى إعادة البدء من السيرفر.', ephemeral: true });
          return;
        }
        // زر الاسم الكامل
        const nameButton = new ButtonBuilder()
          .setCustomId('full_name')
          .setLabel('الاسم الكامل')
          .setStyle(ButtonStyle.Secondary);
        const nameRow = new ActionRowBuilder().addComponents(nameButton);
        // حفظ guildId في userSteps (احتياط)
        userSteps[interaction.user.id].guildId = guildId;
        await interaction.reply({ content: 'اضغط على الزر لإدخال اسمك الكامل:', components: [nameRow], ephemeral: true });
      }
      
      // معالجة أزرار القبول والرفض
      if (interaction.customId.startsWith('accept_')) {
        const isMilitaryCode = interaction.customId.includes('military_code_');
        let requestId;
        if (isMilitaryCode) {
          requestId = interaction.customId.replace('accept_military_code_', '');
        } else {
          requestId = interaction.customId.replace('accept_', '');
        }
        const modal = new ModalBuilder()
          .setCustomId(`accept_modal_${requestId}`)
          .setTitle(isMilitaryCode ? 'سبب قبول الكود العسكري' : 'سبب القبول');
        const reasonInput = new TextInputBuilder()
          .setCustomId('accept_reason')
          .setLabel('سبب القبول')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(isMilitaryCode ? 'اكتب سبب قبول الكود العسكري هنا...' : 'اكتب سبب قبول الهوية هنا...')
          .setRequired(true);
        const modalRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(modalRow);
        await interaction.showModal(modal);
      }
      
      if (interaction.customId.startsWith('reject_')) {
        const isMilitaryCode = interaction.customId.includes('military_code_');
        let requestId;
        if (isMilitaryCode) {
          requestId = interaction.customId.replace('reject_military_code_', '');
        } else {
          requestId = interaction.customId.replace('reject_', '');
        }
        const modal = new ModalBuilder()
          .setCustomId(`reject_modal_${requestId}`)
          .setTitle(isMilitaryCode ? 'سبب رفض الكود العسكري' : 'سبب الرفض');
        const reasonInput = new TextInputBuilder()
          .setCustomId('reject_reason')
          .setLabel('سبب الرفض')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(isMilitaryCode ? 'اكتب سبب رفض الكود العسكري هنا...' : 'اكتب سبب رفض الهوية هنا...')
          .setRequired(true);
        const modalRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(modalRow);
        await interaction.showModal(modal);
      }
      
      // عند الضغط على زر 'full_name' في الروم
      if (interaction.isButton() && interaction.customId === 'full_name') {
        const modal = new ModalBuilder()
          .setCustomId('modal_full_name')
          .setTitle('إدخال الاسم الكامل');
        const nameInput = new TextInputBuilder()
          .setCustomId('input_full_name')
          .setLabel('الاسم الكامل')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب اسمك الكامل هنا')
          .setRequired(true);
        const modalRow = new ActionRowBuilder().addComponents(nameInput);
        modal.addComponents(modalRow);
        await interaction.showModal(modal);
        return;
      }

    // معالج زر حذف دليل تحذير
    if (interaction.isButton() && interaction.customId === 'remove_warning_evidence') {
      // جلب هوية الشخص من آخر بحث
      const lastSearch = interaction.message.embeds[0]?.description;
      const nameMatch = lastSearch?.match(/\*\*الاسم:\*\* (.+)/);
      const nationalIdMatch = lastSearch?.match(/\*\*الرقم الوطني:\*\* (.+)/);
      if (!nameMatch || !nationalIdMatch) {
        await interaction.reply({ content: '❌ لا يمكن تحديد الشخص المستهدف.', ephemeral: true });
        return;
      }
      const fullName = nameMatch[1].split('\n')[0].trim();
      const nationalId = nationalIdMatch[1].split('\n')[0].trim();
      const guildId = interaction.guildId;
      const foundIdentity = identities.find(id => id.fullName === fullName && id.nationalId === nationalId && id.guildId === guildId);
      if (!foundIdentity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الشخص.', ephemeral: true });
        return;
      }
      const warnings = getAllMilitaryWarnings(foundIdentity.userId, guildId).filter(w => !w.removed && w.evidence);
      if (warnings.length === 0) {
        await interaction.reply({ content: '❌ لا توجد تحذيرات تحتوي على دليل.', ephemeral: true });
        return;
      }
      // بناء قائمة منسدلة
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_warning_evidence_to_remove')
        .setPlaceholder('اختر التحذير الذي تريد حذف دليله')
        .addOptions(warnings.map(w => ({
          label: `تحذير رقم ${w.warningNumber} - ${w.id}`,
          value: w.id,
          description: w.reason.slice(0, 50)
        })));
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({ content: 'اختر التحذير الذي تريد حذف دليله:', components: [row], ephemeral: true });
      return;
    }

    // معالج القائمة المنسدلة لاختيار تحذير لحذف دليله
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_warning_evidence_to_remove') {
      const warningId = interaction.values[0];
      const guildId = interaction.guildId;
      // البحث عن التحذير
      let foundWarning = null;
      let foundUserId = null;
      if (militaryWarnings[guildId]) {
        Object.entries(militaryWarnings[guildId]).forEach(([userId, warnings]) => {
          const warning = warnings.find(w => w.id === warningId);
          if (warning) {
            foundWarning = warning;
            foundUserId = userId;
          }
        });
      }
      if (!foundWarning) {
        await interaction.reply({ content: '❌ لم يتم العثور على التحذير.', ephemeral: true });
        return;
      }
      // عرض التفاصيل وزر حذف الدليل
      const embed = new EmbedBuilder()
        .setTitle('🗑️ حذف دليل تحذير')
        .setDescription(`**رقم التحذير:** ${foundWarning.warningNumber}\n**السبب:** ${foundWarning.reason}\n**الدليل الحالي:** [رابط الدليل](${foundWarning.evidence})`)
        .setColor('#ff9900')
        .setTimestamp();
      const removeEvidenceBtn = new ButtonBuilder()
        .setCustomId(`confirm_remove_warning_evidence_${warningId}_${foundUserId}`)
        .setLabel('تأكيد حذف الدليل')
        .setStyle(ButtonStyle.Danger);
      const row = new ActionRowBuilder().addComponents(removeEvidenceBtn);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // معالج زر تأكيد حذف الدليل
    if (interaction.isButton() && interaction.customId.startsWith('confirm_remove_warning_evidence_')) {
      const [ , warningId, userId ] = interaction.customId.split('_').slice(-3);
      const guildId = interaction.guildId;
      // عرض مودال سبب الحذف
      const modal = new ModalBuilder()
        .setCustomId(`modal_remove_warning_evidence_${warningId}_${userId}`)
        .setTitle('سبب حذف الدليل');
      const reasonInput = new TextInputBuilder()
        .setCustomId('input_remove_evidence_reason')
        .setLabel('سبب حذف الدليل')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);
      const row = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }

    // معالج مودال حذف دليل التحذير
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_remove_warning_evidence_')) {
      const [ , warningId, userId ] = interaction.customId.split('_').slice(-3);
      const guildId = interaction.guildId;
      const reason = interaction.fields.getTextInputValue('input_remove_evidence_reason');
      // البحث عن التحذير
      const warningsArr = militaryWarnings[guildId]?.[userId] || [];
      const warning = warningsArr.find(w => w.id === warningId);
      if (!warning || !warning.evidence) {
        await interaction.reply({ content: '❌ لم يتم العثور على الدليل أو تم حذفه مسبقاً.', ephemeral: true });
        return;
      }
      const oldEvidence = warning.evidence;
      warning.evidence = null;
      if (!warning.evidenceHistory) warning.evidenceHistory = [];
      warning.evidenceHistory.push({ url: oldEvidence, removedBy: interaction.user.id, removedAt: new Date().toISOString(), reason });
      saveAllData();
      // إرسال تأكيد
      const embed = new EmbedBuilder()
        .setTitle('✅ تم حذف دليل التحذير')
        .setDescription(`تم حذف دليل التحذير بنجاح.\n\n**رقم التحذير:** ${warning.warningNumber}\n**سبب الحذف:** ${reason}`)
        .setColor('#00ff00')
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('🗑️ حذف دليل تحذير عسكري')
              .setDescription(`**المستخدم:** <@${userId}>\n**رقم التحذير:** ${warning.warningNumber}\n**الدليل المحذوف:** ${oldEvidence}\n**سبب الحذف:** ${reason}\n**تم الحذف بواسطة:** ${interaction.user}`)
              .setColor('#ff0000')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      return;
    }
        if (interaction.customId === 'select_gender') {
          const selectedGender = interaction.values[0];
          userSteps[interaction.user.id] = userSteps[interaction.user.id] || {};
          userSteps[interaction.user.id].gender = selectedGender;
          // قائمة منسدلة لاختيار مدينة الولادة
          const citySelect = new (require('discord.js').StringSelectMenuBuilder)()
            .setCustomId('select_city')
            .setPlaceholder('اختر مدينة الولادة')
            .addOptions([
              { label: 'لوس سانتوس', value: 'los_santos' },
              { label: 'ساندي شور', value: 'sandy_shore' },
              { label: 'بوليتو', value: 'paleto' }
            ]);
          const cityRow = new ActionRowBuilder().addComponents(citySelect);
          await interaction.reply({ content: 'يرجى اختيار مدينة الولادة من القائمة أدناه:', components: [cityRow], ephemeral: true });
        }

        if (interaction.customId === 'select_city') {
          const selectedCity = interaction.values[0];
          userSteps[interaction.user.id] = userSteps[interaction.user.id] || {};
          userSteps[interaction.user.id].city = selectedCity;
          // إنشاء خيارات السنوات من 1990 إلى 2010
          const years = Array.from({length: 2010 - 1990 + 1}, (_, i) => 1990 + i);
          const yearOptions = years.map(year => ({ label: year.toString(), value: year.toString() }));
          const yearSelect = new (require('discord.js').StringSelectMenuBuilder)()
            .setCustomId('select_year')
            .setPlaceholder('اختر سنة ميلادك')
            .addOptions(yearOptions);
          const yearRow = new ActionRowBuilder().addComponents(yearSelect);
          await interaction.reply({ content: 'يرجى اختيار سنة ميلادك من القائمة أدناه:', components: [yearRow], ephemeral: true });
        }

        if (interaction.customId === 'select_year') {
          const selectedYear = interaction.values[0];
          userSteps[interaction.user.id] = userSteps[interaction.user.id] || {};
          userSteps[interaction.user.id].year = selectedYear;
          // خيارات الأشهر
          const months = [
            { label: 'يناير', value: '1' },
            { label: 'فبراير', value: '2' },
            { label: 'مارس', value: '3' },
            { label: 'أبريل', value: '4' },
            { label: 'مايو', value: '5' },
            { label: 'يونيو', value: '6' },
            { label: 'يوليو', value: '7' },
            { label: 'أغسطس', value: '8' },
            { label: 'سبتمبر', value: '9' },
            { label: 'أكتوبر', value: '10' },
            { label: 'نوفمبر', value: '11' },
            { label: 'ديسمبر', value: '12' }
          ];
          const monthSelect = new (require('discord.js').StringSelectMenuBuilder)()
            .setCustomId('select_month')
            .setPlaceholder('اختر شهر ميلادك')
            .addOptions(months);
          const monthRow = new ActionRowBuilder().addComponents(monthSelect);
          await interaction.reply({ content: 'يرجى اختيار شهر ميلادك من القائمة أدناه:', components: [monthRow], ephemeral: true });
        }

        if (interaction.customId === 'select_month') {
          const selectedMonth = interaction.values[0];
          userSteps[interaction.user.id] = userSteps[interaction.user.id] || {};
          userSteps[interaction.user.id].month = selectedMonth;
          const monthNames = {
            '1': 'يناير', '2': 'فبراير', '3': 'مارس', '4': 'أبريل', '5': 'مايو', '6': 'يونيو',
            '7': 'يوليو', '8': 'أغسطس', '9': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر'
          };
          // قائمة منسدلة لاختيار اليوم
          const days = Array.from({length: 24}, (_, i) => ({ label: (i+1).toString(), value: (i+1).toString() }));
          const daySelect = new (require('discord.js').StringSelectMenuBuilder)()
            .setCustomId('select_day')
            .setPlaceholder('اختر يوم ميلادك')
            .addOptions(days);
          const dayRow = new ActionRowBuilder().addComponents(daySelect);
          await interaction.reply({ content: 'يرجى اختيار يوم ميلادك من القائمة أدناه:', components: [dayRow], ephemeral: true });
        }

        // عند استقبال اختيار اليوم (الخطوة الأخيرة)
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_day') {
          const selectedDay = interaction.values[0];
          userSteps[interaction.user.id] = userSteps[interaction.user.id] || {};
          userSteps[interaction.user.id].day = selectedDay;

          // توليد رقم وطني عشوائي من 4 أرقام
          const nationalId = Math.floor(1000 + Math.random() * 9000).toString();
          userSteps[interaction.user.id].nationalId = nationalId;

          // استرجاع جميع بيانات المستخدم
          const data = userSteps[interaction.user.id];
          const monthNames = {
            '1': 'يناير', '2': 'فبراير', '3': 'مارس', '4': 'أبريل', '5': 'مايو', '6': 'يونيو',
            '7': 'يوليو', '8': 'أغسطس', '9': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر'
          };
          const cityNames = {
            'los_santos': 'لوس سانتوس',
            'sandy_shore': 'ساندي شور',
            'paleto': 'بوليتو'
          };
          const birthDate = `${data.day} / ${monthNames[data.month]} / ${data.year}`;
          const city = cityNames[data.city] || data.city;

          // --- جلب السيرفر الصحيح ---
          const guild = client.guilds.cache.get(interaction.guildId);
          if (!guild) {
            await interaction.reply({ content: '❌ لا يمكن العثور على السيرفر الأصلي لهذا الطلب.', ephemeral: true });
            delete userSteps[interaction.user.id];
            return;
          }
          // تحقق من الإعدادات
          if (!checkGuildSettings(interaction.guildId)) {
            await interaction.reply({ content: '❌ يجب تعيين جميع الإعدادات أولاً من خلال /الادارة في السيرفر.', ephemeral: true });
            delete userSteps[interaction.user.id];
            return;
          }

          try {
            // إنشاء بطاقة هوية جديدة من الصفر
            const cardWidth = 600;
            const cardHeight = 400;
            const canvas = createCanvas(cardWidth, cardHeight);
            const ctx = canvas.getContext('2d');

            // رسم الخلفية الرئيسية (رمادي فاتح)
            ctx.fillStyle = '#f5f5f5';
            ctx.fillRect(0, 0, cardWidth, cardHeight);

            // رسم الهيدر الأزرق
            ctx.fillStyle = '#1e3a8a';
            ctx.fillRect(0, 0, cardWidth, 60);
            
            // رسم الفوتر الأزرق
            ctx.fillStyle = '#1e3a8a';
            ctx.fillRect(0, cardHeight - 50, cardWidth, 50);

            // عنوان البطاقة
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('بطاقة الهوية الرسمية', cardWidth / 2, 35);

            // تحميل صورة الأفاتار ووضعها في دائرة
            const avatarURL = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });
            const avatar = await loadImage(avatarURL);
            const avatarSize = 120;
            const avatarX = 50;
            const avatarY = 80;
            
            // رسم خلفية دائرية للصورة
            ctx.fillStyle = '#e5e7eb';
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2 + 5, 0, Math.PI * 2);
            ctx.fill();
            
            // قص الصورة بشكل دائري
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();

            // إعداد النصوص
            ctx.fillStyle = '#1f2937';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'right';
            
            // العناوين (على اليمين)
            const labels = [
              { text: 'الاسم الكامل', y: 100 },
              { text: 'المدينة', y: 140 },
              { text: 'تاريخ الميلاد', y: 180 },
              { text: 'الجنسية', y: 220 },
              { text: 'رقم الهوية', y: 260 }
            ];
            
            labels.forEach(label => {
              ctx.fillText(label.text, 280, label.y);
            });

            // القيم (على اليسار)
            ctx.textAlign = 'left';
            ctx.font = '16px Arial';
            
            // الاسم الكامل
            ctx.fillText(data.fullName, 300, 100);
            
            // المدينة
            ctx.fillText(city, 300, 140);
            
            // تاريخ الميلاد
            const birthTextAr = `${data.day} / ${monthNames[data.month]} / ${data.year}`;
            ctx.fillText(birthTextAr, 300, 180);
            
            // الجنسية
            const genderText = data.gender === 'male' ? 'ذكر' : 'أنثى';
            ctx.fillText(genderText, 300, 220);
            
            // رقم الهوية
            ctx.fillText(nationalId, 300, 260);

            // تاريخ الإصدار في الفوتر
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px Arial';
            ctx.textAlign = 'right';
            ctx.fillText('تاريخ الإصدار :', cardWidth - 20, cardHeight - 20);
            ctx.textAlign = 'left';
            ctx.fillText(birthTextAr, 20, cardHeight - 20);

            // إضافة شعار في الزاوية السفلية اليسرى
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#1e3a8a';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('MDT', 50, cardHeight - 75);

            // حفظ الصورة
            const buffer = canvas.toBuffer('image/png');
            
            // إضافة طلب معلق بدلاً من هوية مباشرة
            const requestId = Date.now().toString();
            const pendingRequest = {
              requestId: requestId,
              guildId: interaction.guildId,
              userId: interaction.user.id,
              username: interaction.user.username,
              fullName: data.fullName,
              gender: data.gender,
              city: data.city,
              year: data.year,
              month: data.month,
              day: data.day,
              nationalId: nationalId,
              createdAt: new Date().toISOString(),
              status: 'pending'
            };
            
            pendingRequests.push(pendingRequest);
            saveAllData();
            
            // إرسال الطلب لروم المراجعة في السيرفر الصحيح
            const reviewChannelId = guildSettings[interaction.guildId].reviewChannelId;
            const reviewChannel = guild.channels.cache.get(reviewChannelId);
            
            if (reviewChannel) {
              const reviewEmbed = new EmbedBuilder()
                .setTitle('طلب هوية جديد')
                .setDescription(`**المستخدم:** ${interaction.user} (${interaction.user.username})\n**الاسم:** ${data.fullName}\n**الجنس:** ${data.gender === 'male' ? 'ذكر' : 'أنثى'}\n**المدينة:** ${city}\n**تاريخ الميلاد:** ${birthTextAr}\n**رقم الهوية:** ${nationalId}\n**رقم الطلب:** ${requestId}`)
                .setThumbnail(interaction.user.displayAvatarURL())
                .setColor('#ffa500') // برتقالي
                .setTimestamp();

              const acceptButton = new ButtonBuilder()
                .setCustomId(`accept_${requestId}`)
                .setLabel('قبول')
                .setStyle(ButtonStyle.Success);

              const rejectButton = new ButtonBuilder()
                .setCustomId(`reject_${requestId}`)
                .setLabel('رفض')
                .setStyle(ButtonStyle.Danger);

              const row = new ActionRowBuilder().addComponents(acceptButton, rejectButton);

              await reviewChannel.send({
                embeds: [reviewEmbed],
                components: [row],
                files: [{ attachment: buffer, name: 'id_card.png' }]
              });
            }
            
            await interaction.reply({
              content: `✅ تم إرسال طلب إنشاء هويتك بنجاح! رقم طلبك: **${requestId}**\nسيتم مراجعة طلبك قريباً.`,
              files: [{ attachment: buffer, name: 'id_card.png' }],
              ephemeral: true
            });
            
            // حذف بيانات المستخدم بعد الإنشاء
            delete userSteps[interaction.user.id];
          } catch (err) {
            console.error('خطأ في إنشاء البطاقة:', err);
            await interaction.reply({ content: 'حدث خطأ أثناء إنشاء البطاقة، حاول مرة أخرى.', ephemeral: true });
            delete userSteps[interaction.user.id];
          }
          return;
        }
      }

      // معالجة أمر /الادارة
      if (interaction.isChatInputCommand() && interaction.commandName === 'الادارة') {
        // تحقق من صلاحية الأدمن (احتياط)
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({ content: '❌ هذا الأمر مخصص فقط للأدمن.', ephemeral: true });
          return;
        }
        // نفس الإيمبيد الخاص بـ /بطاقة
        const customImage = guildSettings[interaction.guildId]?.customEmbedImage || 'https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless';
        const embed = new EmbedBuilder()
          .setTitle('إدارة الهوية')
          .setDescription('يمكنك من هنا إدارة إعدادات الهوية. اختر من القائمة أدناه الإجراء المطلوب.')
          .setImage(customImage)
          .setColor('#00ff00');
        // قائمة منسدلة
        const { StringSelectMenuBuilder } = require('discord.js');
        const menuOptions = [
          { label: 'تعيين روم اللوق', value: 'set_log_channel' },
          { label: 'تعيين روم المراجعة', value: 'set_review_channel' },
          { label: 'تعيين رتبة القبول والرفض', value: 'set_approval_role' },
          { label: 'تعيين الرتبة العسكرية/الشرطية', value: 'set_police_role' },
          { label: 'إضافة رتبة مسؤول الشرطة', value: 'set_police_admin_role' },
        { label: 'تعيين روم إنشاء الهوية', value: 'set_create_room_channel' },
        { label: 'تعيين روم مباشرة العسكر', value: 'set_direct_military_room' },
        { label: 'تعيين روم قبول الاكواد العسكرية', value: 'set_military_code_review_room' },
        { label: 'أكواد العساكر قيد المراجعة', value: 'check_military_codes' },
        { label: 'تعديل | حذف الهوية', value: 'edit_delete_identity' }
      ];
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('admin_settings_menu')
        .setPlaceholder('اختر إجراء...')
        .addOptions(addResetOption(menuOptions));
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // معالجة مودالات تعيين الإعدادات الإدارية
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_log_channel') {
      const logChannelId = interaction.fields.getTextInputValue('input_log_channel');
      const guildId = interaction.guildId;
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      const oldLog = guildSettings[guildId].logChannelId;
      guildSettings[guildId].logChannelId = logChannelId;
      saveGuildSettings();
      // إرسال إيمبيد في روم اللوق الجديد
      try {
        const guildLog = interaction.guild;
        if (!guildLog) {
          await interaction.reply({ content: '❌ لا يمكن تنفيذ هذا الإجراء إلا من داخل سيرفر.', ephemeral: true });
          return;
        }
        const logChannel = guildLog.channels.cache.get(logChannelId);
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setTitle('📋 تم تعيين روم اللوق')
            .setDescription(`قام <@${interaction.user.id}> بتعيين روم اللوق إلى: <#${logChannelId}>\n${oldLog && oldLog !== logChannelId ? `\n(الروم السابق: <#${oldLog}>)` : ''}`)
            .setColor('#1e3a8a')
            .setTimestamp();
          logChannel.send({ embeds: [embed] });
        }
      } catch (e) { /* تجاهل الخطأ */ }
      await interaction.reply({ content: '✅ تم تعيين روم اللوق بنجاح!', ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_review_channel') {
      const reviewChannelId = interaction.fields.getTextInputValue('input_review_channel');
      const guildId = interaction.guildId;
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      guildSettings[guildId].reviewChannelId = reviewChannelId;
      saveGuildSettings();
      // إرسال لوق في روم اللوق إذا كان معينًا
      const logChannelId = guildSettings[guildId].logChannelId;
      if (logChannelId) {
        try {
          const guildLog2 = interaction.guild;
          if (!guildLog2) {
            await interaction.reply({ content: '❌ لا يمكن تنفيذ هذا الإجراء إلا من داخل سيرفر.', ephemeral: true });
            return;
          }
          const logChannel2 = guildLog2.channels.cache.get(logChannelId);
          if (logChannel2) {
            const embed = new EmbedBuilder()
              .setTitle('📋 تم تعيين روم المراجعة')
              .setDescription(`قام <@${interaction.user.id}> بتعيين روم المراجعة إلى: <#${reviewChannelId}>`)
              .setColor('#1e3a8a')
              .setTimestamp();
            logChannel2.send({ embeds: [embed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم تعيين روم المراجعة بنجاح!', ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_approval_role') {
      const approvalRoleId = interaction.fields.getTextInputValue('input_approval_role');
      const guildId = interaction.guildId;
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      guildSettings[guildId].approvalRoleId = approvalRoleId;
      saveGuildSettings();
      // إرسال لوق في روم اللوق إذا كان معينًا
      const logChannelId = guildSettings[guildId].logChannelId;
      if (logChannelId) {
        try {
          const guildLog3 = interaction.guild;
          if (!guildLog3) {
            await interaction.reply({ content: '❌ لا يمكن تنفيذ هذا الإجراء إلا من داخل سيرفر.', ephemeral: true });
            return;
          }
          const logChannel3 = guildLog3.channels.cache.get(logChannelId);
          if (logChannel3) {
            const embed = new EmbedBuilder()
              .setTitle('📋 تم تعيين رتبة القبول والرفض')
              .setDescription(`قام <@${interaction.user.id}> بتعيين رتبة القبول والرفض إلى: <@&${approvalRoleId}>`)
              .setColor('#1e3a8a')
              .setTimestamp();
            logChannel3.send({ embeds: [embed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم تعيين رتبة القبول والرفض بنجاح!', ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_police_role') {
      const policeRoleId = interaction.fields.getTextInputValue('input_police_role');
      const guildId = interaction.guildId;
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      guildSettings[guildId].policeRoleId = policeRoleId;
      saveGuildSettings();
      // إرسال لوق في روم اللوق إذا كان معينًا
      const logChannelId = guildSettings[guildId].logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('📋 تم تعيين رتبة الشرطة')
              .setDescription(`قام <@${interaction.user.id}> بتعيين رتبة الشرطة إلى: <@&${policeRoleId}>`)
              .setColor('#1e3a8a')
              .setTimestamp();
            logChannel.send({ embeds: [embed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم تعيين رتبة الشرطة بنجاح!', ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_create_room_channel') {
      const createRoomChannelId = interaction.fields.getTextInputValue('input_create_room_channel');
      const guildId = interaction.guildId;
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      guildSettings[guildId].createRoomChannelId = createRoomChannelId;
      saveGuildSettings();
      // إرسال لوق في روم اللوق إذا كان معينًا
      const logChannelId = guildSettings[guildId].logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('📋 تم تعيين روم إنشاء الهوية')
              .setDescription(`قام <@${interaction.user.id}> بتعيين روم إنشاء الهوية إلى: <#${createRoomChannelId}>`)
              .setColor('#1e3a8a')
              .setTimestamp();
            logChannel.send({ embeds: [embed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم تعيين روم إنشاء الهوية بنجاح!', ephemeral: true });
      return;
    }
    // مودال تعيين روم مباشرة العسكر
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_direct_military_room') {
      const directRoomId = interaction.fields.getTextInputValue('input_direct_military_room');
      const guildId = interaction.guildId;
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      guildSettings[guildId].directMilitaryRoomId = directRoomId;
      saveGuildSettings();
      
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[guildId].logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('📋 تم تعيين روم مباشرة العسكر')
              .setDescription(`قام <@${interaction.user.id}> بتعيين روم مباشرة العسكر إلى: <#${directRoomId}>`)
              .setColor('#1e3a8a')
              .setTimestamp();
            logChannel.send({ embeds: [embed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      
      await interaction.reply({ content: `✅ تم تعيين روم مباشرة العسكر: <#${directRoomId}> بنجاح!`, ephemeral: true });
      return;
    }
    // مودال تعيين روم قبول الاكواد العسكرية
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_military_code_review_room') {
      const reviewRoomId = interaction.fields.getTextInputValue('input_military_code_review_room');
      const guildId = interaction.guildId;
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      guildSettings[guildId].militaryCodeReviewRoomId = reviewRoomId;
      saveGuildSettings();
      
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[guildId].logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('📋 تم تعيين روم قبول الاكواد العسكرية')
              .setDescription(`قام <@${interaction.user.id}> بتعيين روم قبول الاكواد العسكرية إلى: <#${reviewRoomId}>`)
              .setColor('#1e3a8a')
              .setTimestamp();
            logChannel.send({ embeds: [embed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      
      await interaction.reply({ content: `✅ تم تعيين روم قبول الاكواد العسكرية: <#${reviewRoomId}> بنجاح!`, ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_police_admin_role') {
      const policeAdminRoleId = interaction.fields.getTextInputValue('input_police_admin_role');
      const guildId = interaction.guildId;
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      guildSettings[guildId].policeAdminRoleId = policeAdminRoleId;
      saveGuildSettings();
      // إرسال لوق في روم اللوق إذا كان معينًا
      const logChannelId = guildSettings[guildId].logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('📋 تم تعيين رتبة مسؤول الشرطة')
              .setDescription(`قام <@${interaction.user.id}> بتعيين رتبة مسؤول الشرطة إلى: <@&${policeAdminRoleId}>`)
              .setColor('#1e3a8a')
              .setTimestamp();
            logChannel.send({ embeds: [embed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم تعيين رتبة مسؤول الشرطة بنجاح!', ephemeral: true });
      return;
    }
    
    // مودال البحث عن الكود العسكري
    if (interaction.isModalSubmit() && interaction.customId === 'modal_check_military_codes') {
      const searchTerm = interaction.fields.getTextInputValue('input_search_military_code');
      const guildId = interaction.guildId;
      
      // البحث في الهويات بالاسم الكامل أو الرقم الوطني
      const foundIdentity = identities.find(id => 
        id.guildId === guildId && 
        (id.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
         id.nationalId === searchTerm)
      );
      
      if (!foundIdentity) {
        await interaction.reply({ content: '❌ لم يتم العثور على هوية بهذا الاسم أو الرقم الوطني.', ephemeral: true });
        return;
      }
      
      const userId = foundIdentity.userId;
      
      // البحث عن طلب معلق
      const pendingRequest = pendingMilitaryCodeRequests.find(req => 
        req.userId === userId && req.guildId === guildId
      );
      
      // البحث عن كود مقبول
      const approvedCode = getMilitaryCode(userId, guildId);
      
      // إنشاء الإيمبيد
      const embed = new EmbedBuilder()
        .setTitle('🔍 معلومات الكود العسكري')
        .setDescription(`**الاسم:** ${foundIdentity.fullName}\n**الرقم الوطني:** ${foundIdentity.nationalId}\n**المستخدم:** <@${userId}>`)
        .setColor('#1e3a8a')
        .setTimestamp();
      
      if (pendingRequest) {
        // طلب معلق
        embed.addFields(
          { name: '📋 حالة الكود العسكري', value: '⏳ **طلب معلق قيد المراجعة**', inline: false },
          { name: '🔐 الكود المطلوب', value: `\`${pendingRequest.code}\``, inline: true },
          { name: '📅 تاريخ الطلب', value: `<t:${Math.floor(new Date(pendingRequest.requestedAt).getTime() / 1000)}:F>`, inline: true },
          { name: '🆔 معرف الطلب', value: `\`${pendingRequest.requestId}\``, inline: true }
        );
        
        // زر حذف الطلب المعلق
        const deleteButton = new ButtonBuilder()
          .setCustomId(`delete_pending_military_code_${pendingRequest.requestId}`)
          .setLabel('🗑️ حذف الطلب المعلق')
          .setStyle(ButtonStyle.Danger);
        
        const row = new ActionRowBuilder().addComponents(deleteButton);
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        return;
      } else if (approvedCode) {
        // كود مقبول
        embed.addFields(
          { name: '📋 حالة الكود العسكري', value: '✅ **كود عسكري مقبول**', inline: false },
          { name: '🔐 الكود العسكري', value: `\`${approvedCode}\``, inline: true }
        );
        embed.setColor('#00ff00');
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      } else {
        // لا يوجد كود
        embed.addFields(
          { name: '📋 حالة الكود العسكري', value: '❌ **لا يوجد كود عسكري**', inline: false }
        );
        embed.setColor('#ff0000');
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    }



    if (interaction.isModalSubmit() && interaction.customId === 'modal_request_military_code') {
      const code = interaction.fields.getTextInputValue('input_military_code');
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      // إنشاء طلب كود عسكري جديد
      const requestId = Date.now().toString() + Math.random().toString().slice(2,8);
      const request = {
        requestId,
        userId,
        guildId,
        code,
        username: interaction.user.username,
        fullName: identities.find(id => id.userId === userId && id.guildId === guildId)?.fullName || 'غير معروف',
        requestedAt: new Date().toISOString()
      };
      
      // إضافة الطلب إلى القائمة المعلقة
      pendingMilitaryCodeRequests.push(request);
      saveAllData();
      
      // إرسال الطلب إلى روم قبول الأكواد العسكرية
      const reviewRoomId = guildSettings[guildId]?.militaryCodeReviewRoomId;
      if (reviewRoomId) {
        try {
          const reviewChannel = interaction.guild.channels.cache.get(reviewRoomId);
          if (reviewChannel) {
            const embed = new EmbedBuilder()
              .setTitle('🔐 طلب كود عسكري جديد')
              .setDescription(`**المستخدم:** ${interaction.user} (${request.username})\n**الاسم:** ${request.fullName}\n**الكود المطلوب:** \`${code}\`\n**وقت الطلب:** <t:${Math.floor(Date.now() / 1000)}:F>\n**معرف الطلب:** ${requestId}`)
              .setColor('#fbbf24')
              .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
              .setTimestamp();
            
            const acceptButton = new ButtonBuilder()
              .setCustomId(`accept_military_code_${requestId}`)
              .setLabel('قبول')
              .setStyle(ButtonStyle.Success);
            
            const rejectButton = new ButtonBuilder()
              .setCustomId(`reject_military_code_${requestId}`)
              .setLabel('رفض')
              .setStyle(ButtonStyle.Danger);
            
            const row = new ActionRowBuilder().addComponents(acceptButton, rejectButton);
            await reviewChannel.send({ embeds: [embed], components: [row] });
          }
        } catch (e) {
          console.error('خطأ في إرسال طلب الكود العسكري:', e);
        }
      }
      
      await interaction.reply({ content: '✅ تم إرسال طلب الكود العسكري بنجاح! سيتم مراجعته من قبل مسؤولي الشرطة.', ephemeral: true });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_add_military_points') {
      const searchTerm = interaction.fields.getTextInputValue('input_target_user');
      const pointsToAdd = parseInt(interaction.fields.getTextInputValue('input_points_to_add'));
      const guildId = interaction.guildId;
      
      if (isNaN(pointsToAdd) || pointsToAdd <= 0) {
        await interaction.reply({ content: '❌ يرجى إدخال عدد صحيح موجب من النقاط.', ephemeral: true });
        return;
      }
      
      // البحث عن الهوية بالاسم أو الرقم الوطني
      const foundIdentity = identities.find(id => 
        id.guildId === guildId && 
        (id.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
         id.nationalId === searchTerm)
      );
      
      if (!foundIdentity) {
        await interaction.reply({ content: '❌ لم يتم العثور على شخص بهذا الاسم أو الرقم الوطني.', ephemeral: true });
        return;
      }
      
      const userId = foundIdentity.userId;
      const currentPoints = getMilitaryPoints(userId, guildId);
      const newTotalPoints = currentPoints + pointsToAdd;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const militaryCode = getMilitaryCode(userId, guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('📋 تأكيد إضافة النقاط العسكرية')
          .setDescription('**مراجعة المعلومات قبل الإضافة:**')
          .setColor('#fbbf24')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${foundIdentity.fullName}\n**الرقم الوطني:** ${foundIdentity.nationalId}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '🎖️ **المعلومات العسكرية**', value: `**الكود العسكري:** ${militaryCode ? `\`${militaryCode}\`` : 'غير محدد'}`, inline: false },
            { name: '⭐ **النقاط**', value: `**النقاط الحالية:** \`${currentPoints} نقطة\`\n**النقاط المراد إضافتها:** \`+${pointsToAdd} نقطة\`\n**النقاط الإجمالية بعد الإضافة:** \`${newTotalPoints} نقطة\``, inline: false }
          )
          .setFooter({ text: 'اضغط زر التأكيد لإضافة النقاط رسمياً' })
          .setTimestamp();
        
        const confirmButton = new ButtonBuilder()
          .setCustomId(`confirm_add_points_${userId}_${pointsToAdd}`)
          .setLabel('✅ تأكيد الإضافة')
          .setStyle(ButtonStyle.Success);
        
        const cancelButton = new ButtonBuilder()
          .setCustomId('cancel_add_points')
          .setLabel('❌ إلغاء')
          .setStyle(ButtonStyle.Danger);
        
        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
        
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في جلب معلومات المستخدم.', ephemeral: true });
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_remove_military_points') {
      const searchTerm = interaction.fields.getTextInputValue('input_target_user_remove');
      const pointsToRemove = parseInt(interaction.fields.getTextInputValue('input_points_to_remove'));
      const guildId = interaction.guildId;
      
      if (isNaN(pointsToRemove) || pointsToRemove <= 0) {
        await interaction.reply({ content: '❌ يرجى إدخال عدد صحيح موجب من النقاط.', ephemeral: true });
        return;
      }
      
      // البحث عن الهوية بالاسم أو الرقم الوطني
      const foundIdentity = identities.find(id => 
        id.guildId === guildId && 
        (id.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
         id.nationalId === searchTerm)
      );
      
      if (!foundIdentity) {
        await interaction.reply({ content: '❌ لم يتم العثور على شخص بهذا الاسم أو الرقم الوطني.', ephemeral: true });
        return;
      }
      
      const userId = foundIdentity.userId;
      const currentPoints = getMilitaryPoints(userId, guildId);
      
      if (currentPoints < pointsToRemove) {
        await interaction.reply({ content: '❌ النقاط الحالية أقل من النقاط المراد خصمها.', ephemeral: true });
        return;
      }
      
      const newTotalPoints = currentPoints - pointsToRemove;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const militaryCode = getMilitaryCode(userId, guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('📋 تأكيد خصم النقاط العسكرية')
          .setDescription('**مراجعة المعلومات قبل الخصم:**')
          .setColor('#ff6b35')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${foundIdentity.fullName}\n**الرقم الوطني:** ${foundIdentity.nationalId}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '🎖️ **المعلومات العسكرية**', value: `**الكود العسكري:** ${militaryCode ? `\`${militaryCode}\`` : 'غير محدد'}`, inline: false },
            { name: '⭐ **النقاط**', value: `**النقاط الحالية:** \`${currentPoints} نقطة\`\n**النقاط المراد خصمها:** \`-${pointsToRemove} نقطة\`\n**النقاط المتبقية بعد الخصم:** \`${newTotalPoints} نقطة\``, inline: false }
          )
          .setFooter({ text: 'اضغط زر التأكيد لخصم النقاط رسمياً' })
          .setTimestamp();
        
        const confirmButton = new ButtonBuilder()
          .setCustomId(`confirm_remove_points_${userId}_${pointsToRemove}`)
          .setLabel('✅ تأكيد الخصم')
          .setStyle(ButtonStyle.Success);
        
        const cancelButton = new ButtonBuilder()
          .setCustomId('cancel_remove_points')
          .setLabel('❌ إلغاء')
          .setStyle(ButtonStyle.Danger);
        
        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
        
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في جلب معلومات المستخدم.', ephemeral: true });
      }
      return;
    }
    // منطق إعادة تعيين الإعدادات
    if (
      interaction.isStringSelectMenu() &&
      (interaction.customId === 'admin_settings_menu' || interaction.customId === 'identity_select_menu_page_1') &&
      (interaction.values[0] === 'reset' || interaction.values[0] === 'reset_identities')
    ) {
      // إعادة إرسال نفس الإيمبيد بدون أي تغيير في البيانات
      const embed = new EmbedBuilder()
        .setTitle('إدارة الهويات')
        .setDescription('اختر هوية من القائمة أدناه لعرضها أو تعديلها أو حذفها.')
        .setImage('https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless')
        .setColor('#00ff00');
      // إعادة بناء القائمة المنسدلة بنفس الأسماء (أول 22 هوية)
      const guildIdentities = identities.filter(i => i.guildId === interaction.guildId);
      const page = 1;
      const pageSize = 22;
      const totalPages = Math.ceil(guildIdentities.length / pageSize) || 1;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageIdentities = guildIdentities.slice(start, end);
      const options = pageIdentities.map(i => ({ label: i.fullName, value: `identity_${i.userId}` }));
      if (totalPages > 1) {
        options.push({ label: 'رؤية المزيد', value: 'see_more_identities' });
      }
      options.push({ label: 'إعادة تعيين', value: 'reset_identities', description: 'إعادة تعيين القائمة' });
      const menu = new StringSelectMenuBuilder()
        .setCustomId('identity_select_menu_page_1')
        .setPlaceholder('اختر هوية...')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // عند اختيار 'تعديل | حذف الهوية' من القائمة المنسدلة
    if (interaction.isStringSelectMenu() && interaction.customId === 'identity_select_menu_page_1' && interaction.values[0].startsWith('identity_')) {
      const userId = interaction.values[0].replace('identity_', '');
      const identity = identities.find(i => i.userId === userId);

      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('تفاصيل الهوية')
        .setDescription(`**المستخدم:** <@${identity.userId}>\n**الاسم الكامل:** ${identity.fullName}\n**الجنس:** ${identity.gender === 'male' ? 'ذكر' : 'أنثى'}\n**المدينة:** ${identity.city}\n**تاريخ الميلاد:** ${identity.day} / ${identity.month} / ${identity.year}\n**رقم الهوية:** ${identity.nationalId}\n**تاريخ القبول:** ${identity.approvedAt}\n**تم القبول من قبل:** <@${identity.approvedBy}>`)
        .setThumbnail(await client.users.fetch(identity.userId).then(u => u.displayAvatarURL({ dynamic: true })))
        .setColor('#00ff00')
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`edit_identity_${identity.userId}`)
            .setLabel('تعديل الهوية')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`delete_identity_${identity.userId}`)
            .setLabel('حذف الهوية')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('back_to_admin_menu')
            .setLabel('رجوع إلى القائمة')
            .setStyle(ButtonStyle.Secondary)
        );

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // عند الضغط على زر 'رجوع إلى القائمة' في تفاصيل الهوية
    if (interaction.isButton() && interaction.customId.startsWith('back_to_admin_menu')) {
      const customImage = guildSettings[interaction.guildId]?.customEmbedImage || 'https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless';
      const embed = new EmbedBuilder()
        .setTitle('بطاقة الهوية')
        .setDescription('يمكنك من هنا إدارة إعدادات الهويات. اختر من القائمة أدناه الإجراء المطلوب.')
        .setImage(customImage)
        .setColor('#00ff00');
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('admin_settings_menu')
        .setPlaceholder('اختر إجراء...')
        .addOptions([
          { label: 'تعيين روم اللوق', value: 'set_log_channel' },
          { label: 'تعيين روم المراجعة', value: 'set_review_channel' },
          { label: 'تعيين رتبة القبول والرفض', value: 'set_approval_role' },
          { label: 'تعيين الرتبة العسكرية/الشرطية', value: 'set_police_role' },
          { label: 'إضافة رتبة مسؤول الشرطة', value: 'set_police_admin_role' },
          { label: 'تعيين روم إنشاء الهوية', value: 'set_create_room_channel' },
          { label: 'تعديل | حذف الهوية', value: 'edit_delete_identity' },
          { label: 'إعادة تعيين', value: 'reset', description: 'إعادة تعيين جميع الإعدادات' }
        ]);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // عند الضغط على زر 'تعديل الهوية' في تفاصيل الهوية
    if (interaction.isButton() && interaction.customId.startsWith('edit_identity_')) {
      try {
        const userId = interaction.customId.replace('edit_identity_', '');
        const identity = identities.find(i => i.userId === userId);
        if (!identity) {
          await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
          return;
        }
        // فتح مودال التعديل مباشرة مع الحقول المطلوبة (بدون المدينة)
        const modal = new ModalBuilder()
          .setCustomId(`edit_identity_modal_${identity.userId}`)
          .setTitle('تعديل معلومات الهوية');
        const nameInput = new TextInputBuilder()
          .setCustomId('edit_full_name')
          .setLabel('الاسم الكامل')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(identity.fullName);
        const genderInput = new TextInputBuilder()
          .setCustomId('edit_gender')
          .setLabel('الجنس (ذكر أو أنثى)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(identity.gender === 'male' ? 'ذكر' : 'أنثى');
        const birthInput = new TextInputBuilder()
          .setCustomId('edit_birth')
          .setLabel('تاريخ الميلاد (يوم/شهر/سنة)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(`${identity.day}/${identity.month}/${identity.year}`);
        const row1 = new ActionRowBuilder().addComponents(nameInput);
        const row2 = new ActionRowBuilder().addComponents(genderInput);
        const row3 = new ActionRowBuilder().addComponents(birthInput);
        modal.addComponents(row1, row2, row3);
        await interaction.showModal(modal);
        return;
  } catch (error) {
        console.error('❌ خطأ في تفاعل زر تعديل الهوية:', error);
    if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ حدث خطأ أثناء معالجة الطلب: ' + error.message, ephemeral: true });
    } else {
          await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة الطلب: ' + error.message, ephemeral: true });
        }
        return;
      }
    }

    // عند استقبال مودال التعديل، أرسل إيمبيد فيه معلومات الهوية بعد التعديل مع زرين: تأكيد التعديل وإلغاء التعديل
    if (interaction.isModalSubmit() && interaction.customId.startsWith('edit_identity_modal_')) {
      const userId = interaction.customId.replace('edit_identity_modal_', '');
      const fullName = interaction.fields.getTextInputValue('edit_full_name');
      const genderText = interaction.fields.getTextInputValue('edit_gender');
      const birth = interaction.fields.getTextInputValue('edit_birth');
      // معالجة تاريخ الميلاد
      let day = '', month = '', year = '';
      const birthParts = birth.split('/');
      if (birthParts.length === 3) {
        day = birthParts[0].trim();
        month = birthParts[1].trim();
        year = birthParts[2].trim();
      }
      const gender = (genderText === 'ذكر' || genderText === 'male') ? 'male' : 'female';
      const identity = identities.find(i => i.userId === userId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
        return;
      }
      // بناء إيمبيد المعاينة
      const user = await client.users.fetch(identity.userId).catch(() => null);
      const avatar = user ? user.displayAvatarURL({ dynamic: true }) : null;
      const embed = new EmbedBuilder()
        .setTitle('تأكيد تعديل الهوية')
        .setDescription(`**المستخدم:** <@${identity.userId}>\n**الاسم الكامل:** ${fullName}\n**الجنس:** ${gender === 'male' ? 'ذكر' : 'أنثى'}\n**المدينة:** ${identity.city}\n**تاريخ الميلاد:** ${day} / ${month} / ${year}\n**رقم الهوية:** ${identity.nationalId}`)
        .setColor('#00ff00')
        .setTimestamp();
      if (avatar) embed.setThumbnail(avatar);
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_edit_identity_final_${identity.userId}`)
            .setLabel('تأكيد التعديل')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`cancel_edit_identity_final_${identity.userId}`)
            .setLabel('إلغاء التعديل')
            .setStyle(ButtonStyle.Secondary)
        );
      // حفظ البيانات المؤقتة في userSteps
      userSteps[interaction.user.id] = {
        editPreview: { userId, fullName, gender, day, month, year }
      };
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // عند الضغط على زر 'تأكيد التعديل' بعد المعاينة
    if (interaction.isButton() && interaction.customId.startsWith('confirm_edit_identity_final_')) {
      const userId = interaction.customId.replace('confirm_edit_identity_final_', '');
      const preview = userSteps[interaction.user.id]?.editPreview;
      if (!preview || preview.userId !== userId) {
        await interaction.reply({ content: '❌ لا توجد بيانات تعديل محفوظة.', ephemeral: true });
        return;
      }
      const identity = identities.find(i => i.userId === userId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
        return;
      }
      // حفظ التعديلات
      identity.fullName = preview.fullName;
      identity.gender = preview.gender;
      identity.day = preview.day;
      identity.month = preview.month;
      identity.year = preview.year;
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('✏️ تم تعديل هوية')
              .setDescription(`**تم تعديل هوية المستخدم:** <@${identity.userId}>\n**تم التعديل من قبل:** <@${interaction.user.id}>\n**الاسم الكامل:** ${identity.fullName}\n**الجنس:** ${identity.gender === 'male' ? 'ذكر' : 'أنثى'}\n**المدينة:** ${identity.city}\n**تاريخ الميلاد:** ${identity.day} / ${identity.month} / ${identity.year}`)
              .setColor('#fbbf24')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      delete userSteps[interaction.user.id];
      await interaction.reply({ content: '✅ تم حفظ التعديلات بنجاح!', ephemeral: true });
      return;
    }

    // عند الضغط على زر 'حذف الهوية' في تفاصيل الهوية
    if (interaction.isButton() && interaction.customId.startsWith('delete_identity_')) {
      try {
        const userId = interaction.customId.replace('delete_identity_', '');
        const identity = identities.find(i => i.userId === userId);
        if (!identity) {
          await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
          return;
        }
        const user = await client.users.fetch(identity.userId).catch(() => null);
        const avatar = user ? user.displayAvatarURL({ dynamic: true }) : null;
        // مودال سبب الحذف
        const modal = new ModalBuilder()
          .setCustomId(`delete_identity_modal_${userId}`)
          .setTitle('سبب حذف الهوية');
        const reasonInput = new TextInputBuilder()
          .setCustomId('delete_reason')
          .setLabel('سبب الحذف')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('اكتب سبب حذف الهوية هنا...')
          .setRequired(true);
        const modalRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(modalRow);
        await interaction.showModal(modal);
        return;
      } catch (error) {
        console.error('❌ خطأ في تفاعل زر حذف الهوية:', error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ حدث خطأ أثناء معالجة الطلب: ' + error.message, ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة الطلب: ' + error.message, ephemeral: true });
        }
        return;
      }
    }

    // عند تأكيد الحذف (مودال)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('delete_identity_modal_')) {
      const userId = interaction.customId.replace('delete_identity_modal_', '');
      const reason = interaction.fields.getTextInputValue('delete_reason');
      const identity = identities.find(i => i.userId === userId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
        return;
      }
      identities = identities.filter(i => i.userId !== userId);
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('🗑️ تم حذف هوية')
              .setDescription(`**تم حذف هوية المستخدم:** <@${identity.userId}>
**الاسم:** ${identity.fullName}
**تم الحذف من قبل:** <@${interaction.user.id}>
**السبب:** ${reason}`)
              .setColor('#ff0000')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم حذف الهوية بنجاح!', ephemeral: true });
      return;
    }

    // عند حفظ التعديل (مودال تعديل الهوية)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('edit_identity_modal_')) {
      const userId = interaction.customId.replace('edit_identity_modal_', '');
      const fullName = interaction.fields.getTextInputValue(`edit_full_name_${userId}`);
      const identity = identities.find(i => i.userId === userId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
        return;
      }
      const oldName = identity.fullName;
      identity.fullName = fullName;
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('✏️ تم تعديل هوية')
              .setDescription(`**تم تعديل هوية المستخدم:** <@${identity.userId}>
**الاسم السابق:** ${oldName}
**الاسم الجديد:** ${identity.fullName}
**تم التعديل من قبل:** <@${interaction.user.id}>`)
              .setColor('#fbbf24')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم تعديل الهوية بنجاح!', ephemeral: true });
      return;
    }

    // معالجة أمر /هويتي
    if (interaction.isChatInputCommand() && interaction.commandName === 'هويتي') {
      // تحقق من صلاحية الأدمن
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ هذا الأمر مخصص فقط للأدمن.', ephemeral: true });
        return;
      }
      // نفس إيمبيد /بطاقة
      const customImage = guildSettings[interaction.guildId]?.customEmbedImage || 'https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless';
      const embed = new EmbedBuilder()
        .setTitle('هويتك')
        .setDescription('يمكنك من هنا عرض بطاقتك أو مخالفاتك.')
        .setImage(customImage)
        .setColor('#00ff00');
      // قائمة منسدلة
      const menuOptions = [
        { label: 'بطاقتي', value: 'my_card' },
        { label: 'مخالفاتي', value: 'my_violations' }
      ];
      const menu = new StringSelectMenuBuilder()
        .setCustomId('my_identity_menu')
        .setPlaceholder('اختر إجراء...')
        .addOptions(addResetOption(menuOptions));
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
      return;
    }

    // عند اختيار 'بطاقتي' من قائمة /هويتي
    if (interaction.isStringSelectMenu() && interaction.customId === 'my_identity_menu' && interaction.values[0] === 'my_card') {
      const identity = identities.find(i => i.userId === interaction.user.id && i.guildId === interaction.guildId);
      if (!identity) {
        await interaction.reply({ content: '❌ لا تملك هوية بعد. يمكنك إنشاء هوية من خلال أمر /بطاقة.', ephemeral: true });
        return;
      }
      // توليد صورة البطاقة (canvas)
      try {
        const cardWidth = 600;
        const cardHeight = 400;
        const canvas = createCanvas(cardWidth, cardHeight);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, cardWidth, cardHeight);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, 0, cardWidth, 60);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, cardHeight - 50, cardWidth, 50);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('بطاقة الهوية الرسمية', cardWidth / 2, 35);
        const user = await client.users.fetch(identity.userId).catch(() => null);
        const avatarURL = user ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
        if (avatarURL) {
          const avatar = await loadImage(avatarURL);
          const avatarSize = 120;
          const avatarX = 50;
          const avatarY = 80;
          ctx.fillStyle = '#e5e7eb';
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2 + 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2, true);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
          ctx.restore();
        }
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'right';
        const labels = [
          { text: 'الاسم الكامل', y: 100 },
          { text: 'المدينة', y: 140 },
          { text: 'تاريخ الميلاد', y: 180 },
          { text: 'الجنسية', y: 220 },
          { text: 'رقم الهوية', y: 260 }
        ];
        labels.forEach(label => {
          ctx.fillText(label.text, 280, label.y);
        });
        ctx.textAlign = 'left';
        ctx.font = '16px Arial';
        ctx.fillText(identity.fullName, 300, 100);
        ctx.fillText(identity.city, 300, 140);
        const monthNames = {
          '1': 'يناير', '2': 'فبراير', '3': 'مارس', '4': 'أبريل', '5': 'مايو', '6': 'يونيو',
          '7': 'يوليو', '8': 'أغسطس', '9': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر'
        };
        const birthTextAr = `${identity.day} / ${monthNames[identity.month] || identity.month} / ${identity.year}`;
        ctx.fillText(birthTextAr, 300, 180);
        const genderText = identity.gender === 'male' ? 'ذكر' : 'أنثى';
        ctx.fillText(genderText, 300, 220);
        ctx.fillText(identity.nationalId, 300, 260);
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px Arial';
        ctx.textAlign = 'right';
        ctx.fillText('تاريخ الإصدار :', cardWidth - 20, cardHeight - 20);
        ctx.textAlign = 'left';
        ctx.fillText(birthTextAr, 20, cardHeight - 20);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('MDT', 50, cardHeight - 75);
        const buffer = canvas.toBuffer('image/png');
        const embed = new EmbedBuilder()
          .setTitle('بطاقتك الشخصية')
          .setDescription(`**الاسم:** ${identity.fullName}\n**المدينة:** ${identity.city}\n**تاريخ الميلاد:** ${birthTextAr}\n**الجنس:** ${genderText}\n**رقم الهوية:** ${identity.nationalId}`)
          .setColor('#00ff00')
          .setImage('attachment://id_card.png');
        await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'id_card.png' }], ephemeral: true });
      } catch (err) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء توليد البطاقة.', ephemeral: true });
      }
      return;
    }

    // عند اختيار 'مخالفاتي' من قائمة /هويتي
    if (interaction.isStringSelectMenu() && interaction.customId === 'my_identity_menu' && interaction.values[0] === 'my_violations') {
      const identity = identities.find(i => i.userId === interaction.user.id && i.guildId === interaction.guildId);
      if (!identity) {
        await interaction.reply({ content: '❌ لا تملك هوية بعد. يمكنك إنشاء هوية من خلال أمر /بطاقة.', ephemeral: true });
        return;
      }
      // استخدم المخالفات الحقيقية
      const violations = identity.violations || [];
      // صفحة 1
      const page = 1;
      const perPage = 3;
      const totalPages = Math.ceil(violations.length / perPage);
      const pageViolations = violations.slice((page-1)*perPage, page*perPage);
      try {
        const cardWidth = 600;
        const cardHeight = 400;
        const canvas = createCanvas(cardWidth, cardHeight);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, cardWidth, cardHeight);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, 0, cardWidth, 60);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('المخالفات', cardWidth / 2, 35);
        const user = await client.users.fetch(identity.userId).catch(() => null);
        const avatarURL = user ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
        if (avatarURL) {
          const avatar = await loadImage(avatarURL);
          const avatarSize = 100;
          const avatarX = 30;
          const avatarY = 80;
          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
          ctx.restore();
        }
        ctx.fillStyle = '#222';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(identity.fullName, 150, 120);
        // إذا لا يوجد مخالفات
        if (violations.length === 0) {
          ctx.font = 'bold 32px Arial';
          ctx.fillStyle = '#ff0000';
          ctx.textAlign = 'center';
          ctx.fillText('لايوجد مخالفات', cardWidth/2, cardHeight/2);
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1e3a8a';
          ctx.font = 'bold 14px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('MDT', 50, cardHeight - 75);
          const buffer = canvas.toBuffer('image/png');
          const embed = new EmbedBuilder()
            .setTitle('مخالفاتك')
            .setDescription(`**الاسم:** ${identity.fullName}\n**عدد المخالفات:** 0`)
            .setColor('#ff0000')
            .setImage('attachment://violations_card.png');
          await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'violations_card.png' }], ephemeral: true });
          return;
        }
        // رسم مربعات المخالفات (حتى 3)
        for (let i = 0; i < pageViolations.length; i++) {
          const v = pageViolations[i];
          const y = 160 + i*90;
          // إذا كان المربع الثالث (i === 2) اجعله أصغر أكثر
          const boxHeight = (i === 2) ? 45 : 80;
          // لون خلفية المربع حسب حالة المخالفة
          const boxBg = v.status === 'مسددة' ? '#d1fae5' : '#fee2e2';
          ctx.fillStyle = boxBg;
          ctx.strokeStyle = '#1e3a8a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(150, y, 400, boxHeight, 15);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#1e3a8a';
          ctx.font = 'bold 18px Arial';
          ctx.fillText(v.name, 170, y+25);
          ctx.font = '16px Arial';
          ctx.fillStyle = v.status === 'مسددة' ? '#00ff00' : '#ff0000';
          ctx.fillText(v.status, 170, y+boxHeight-10);
          // وصف المخالفة
          ctx.font = '14px Arial';
          ctx.fillStyle = '#222';
          ctx.fillText(v.desc || '', 350, y+25);
        }
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('MDT', 50, cardHeight - 75);
        const buffer = canvas.toBuffer('image/png');
        const customImage = guildSettings[interaction.guildId]?.customEmbedImage;
        const embed = new EmbedBuilder()
          .setTitle('مخالفاتك')
          .setDescription(`**الاسم:** ${identity.fullName}\n**عدد المخالفات:** ${violations.length}\n\n${pageViolations.map(v => `- ${v.name}: ${v.status}`).join('\n')}`)
          .setColor('#ff0000')
          .setImage('attachment://violations_card.png');
        if (customImage) embed.setThumbnail(customImage);
        // زر رؤية المزيد إذا كان هناك صفحات أخرى
        let components = [];
        if (totalPages > 1) {
          const moreRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('my_violations_next_page')
              .setLabel('رؤية المزيد')
              .setStyle(ButtonStyle.Primary)
          );
          components = [moreRow];
        }
        await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'violations_card.png' }], components, ephemeral: true });
      } catch (err) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء توليد صورة المخالفات.', ephemeral: true });
      }
      return;
    }
    // عند الضغط على زر 'رؤية المزيد' في مخالفاتي
    if (interaction.isButton() && interaction.customId.startsWith('my_violations_next_page')) {
      const identity = identities.find(i => i.userId === interaction.user.id && i.guildId === interaction.guildId);
      if (!identity) {
        await interaction.reply({ content: '❌ لا تملك هوية بعد. يمكنك إنشاء هوية من خلال أمر /بطاقة.', ephemeral: true });
        return;
      }
      // استخراج رقم الصفحة من customId (يدعم صفحات مستقبلية)
      let page = 2;
      const match = interaction.customId.match(/^my_violations_next_page_(\d+)$/);
      if (match) page = parseInt(match[1]);
      const violations = identity.violations || [];
      const perPage = 3;
      const totalPages = Math.ceil(violations.length / perPage);
      const pageViolations = violations.slice((page-1)*perPage, page*perPage);
      try {
        const cardWidth = 600;
        const cardHeight = 400;
        const canvas = createCanvas(cardWidth, cardHeight);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, cardWidth, cardHeight);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, 0, cardWidth, 60);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('المخالفات', cardWidth / 2, 35);
        const user = await client.users.fetch(identity.userId).catch(() => null);
        const avatarURL = user ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
        if (avatarURL) {
          const avatar = await loadImage(avatarURL);
          const avatarSize = 100;
          const avatarX = 30;
          const avatarY = 80;
          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
          ctx.restore();
        }
        ctx.fillStyle = '#222';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(identity.fullName, 150, 120);
        // إذا لا يوجد مخالفات في هذه الصفحة
        if (pageViolations.length === 0) {
          ctx.font = 'bold 32px Arial';
          ctx.fillStyle = '#ff0000';
          ctx.textAlign = 'center';
          ctx.fillText('لايوجد مخالفات في هذه الصفحة', cardWidth/2, cardHeight/2);
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1e3a8a';
          ctx.font = 'bold 14px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('MDT', 50, cardHeight - 75);
          const buffer = canvas.toBuffer('image/png');
          const embed = new EmbedBuilder()
            .setTitle(`مخالفاتك (صفحة ${page})`)
            .setDescription(`**الاسم:** ${identity.fullName}\n**عدد المخالفات:** ${violations.length}`)
            .setColor('#ff0000')
            .setImage('attachment://violations_card.png');
          await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'violations_card.png' }], ephemeral: true });
          return;
        }
        // رسم مربعات المخالفات (حتى 3)
        for (let i = 0; i < pageViolations.length; i++) {
          const v = pageViolations[i];
          const y = 160 + i*90;
          const boxHeight = (i === 2) ? 45 : 80;
          const boxBg = v.status === 'مسددة' ? '#d1fae5' : '#fee2e2';
          ctx.fillStyle = boxBg;
          ctx.strokeStyle = '#1e3a8a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(150, y, 400, boxHeight, 15);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#1e3a8a';
          ctx.font = 'bold 18px Arial';
          ctx.fillText(v.name, 170, y+25);
          ctx.font = '16px Arial';
          ctx.fillStyle = v.status === 'مسددة' ? '#00ff00' : '#ff0000';
          ctx.fillText(v.status, 170, y+boxHeight-10);
        }
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('MDT', 50, cardHeight - 75);
        const buffer = canvas.toBuffer('image/png');
        const customImage = guildSettings[interaction.guildId]?.customEmbedImage;
        const embed = new EmbedBuilder()
          .setTitle(`مخالفاتك (صفحة ${page})`)
          .setDescription(`**الاسم:** ${identity.fullName}\n**عدد المخالفات:** ${violations.length}\n\n${pageViolations.map(v => `- ${v.name}: ${v.status}`).join('\n')}`)
          .setColor('#ff0000')
          .setImage('attachment://violations_card.png');
        if (customImage) embed.setThumbnail(customImage);
        // زر رؤية المزيد إذا كان هناك صفحات أخرى
        let components = [];
        if (page < totalPages) {
          const moreRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`my_violations_next_page_${page+1}`)
              .setLabel('رؤية المزيد')
              .setStyle(ButtonStyle.Primary)
          );
          components = [moreRow];
        }
        await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'violations_card.png' }], components, ephemeral: true });
      } catch (err) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء توليد صورة المخالفات.', ephemeral: true });
      }
      return;
    }
    // عند حفظ التعديل (مودال تعديل الهوية)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('edit_identity_modal_')) {
      const userId = interaction.customId.replace('edit_identity_modal_', '');
      const fullName = interaction.fields.getTextInputValue(`edit_full_name_${userId}`);
      const identity = identities.find(i => i.userId === userId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
        return;
      }
      const oldName = identity.fullName;
      identity.fullName = fullName;
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('✏️ تم تعديل هوية')
              .setDescription(`**تم تعديل هوية المستخدم:** <@${identity.userId}>
**الاسم السابق:** ${oldName}
**الاسم الجديد:** ${identity.fullName}
**تم التعديل من قبل:** <@${interaction.user.id}>`)
              .setColor('#fbbf24')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم تعديل الهوية بنجاح!', ephemeral: true });
      return;
    }
    // معالجة إعادة تعيين من قائمة /هويتي فقط
    if (interaction.isStringSelectMenu() && interaction.customId === 'my_identity_menu' && interaction.values[0] === 'reset') {
      const embed = new EmbedBuilder()
        .setTitle('هويتك')
        .setDescription('يمكنك من هنا عرض بطاقتك أو مخالفاتك.')
        .setImage('https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless')
        .setColor('#00ff00');
      const menu = new StringSelectMenuBuilder()
        .setCustomId('my_identity_menu')
        .setPlaceholder('اختر إجراء...')
        .addOptions([
          { label: 'بطاقتي', value: 'my_card' },
          { label: 'مخالفاتي', value: 'my_violations' },
          { label: 'إعادة تعيين', value: 'reset', description: 'تحديث الصفحة' }
        ]);
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }
    // منطق إعادة تعيين الإعدادات الإدارية فقط
    if (interaction.isStringSelectMenu() && (interaction.customId === 'admin_settings_menu' || interaction.customId === 'identity_select_menu_page_1') && (interaction.values[0] === 'reset' || interaction.values[0] === 'reset_identities')) {
      // إعادة إرسال نفس إيمبيد إدارة الهويات
      const embed = new EmbedBuilder()
        .setTitle('إدارة الهويات')
        .setDescription('اختر هوية من القائمة أدناه لعرضها أو تعديلها أو حذفها.')
        .setImage('https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless')
        .setColor('#00ff00');
      const guildIdentities = identities.filter(i => i.guildId === interaction.guildId);
      const page = 1;
      const pageSize = 22;
      const totalPages = Math.ceil(guildIdentities.length / pageSize) || 1;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageIdentities = guildIdentities.slice(start, end);
      const options = pageIdentities.map(i => ({ label: i.fullName, value: `identity_${i.userId}` }));
      if (totalPages > 1) {
        options.push({ label: 'رؤية المزيد', value: 'see_more_identities' });
      }
      options.push({ label: 'إعادة تعيين', value: 'reset_identities', description: 'إعادة تعيين القائمة' });
      const menu = new StringSelectMenuBuilder()
        .setCustomId('identity_select_menu_page_1')
        .setPlaceholder('اختر هوية...')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }

    // معالجة أمر /العسكر
    if (interaction.isChatInputCommand() && interaction.commandName === 'العسكر') {
      // تحقق من صلاحية الأدمن
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ هذا الأمر مخصص فقط للأدمن.', ephemeral: true });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('نظام العسكر')
        .setDescription('مرحباً بك في نظام العسكر. اختر من القائمة أدناه الإجراء المطلوب.')
        .setImage('https://i.postimg.cc/VvC7rqnV/image.png')
        .setColor('#1e3a8a')
        .setTimestamp();
      
      const menuOptions = [
        { label: 'تسجيل دخول', value: 'military_login', description: 'تسجيل دخول للعسكر' },
        { label: 'تعيين الكود العسكري', value: 'set_military_code', description: 'تعيين كود عسكري جديد' },
        { label: 'نقاطي', value: 'my_military_points', description: 'عرض نقاطك العسكرية' },
        { label: 'ادارة النقاط | الاكواد العسكرية', value: 'manage_military', description: 'إدارة النظام العسكري' },
        { label: 'إعادة تعيين', value: 'reset_military', description: 'تحديث الصفحة' }
      ];
      
      const militaryMenu = new StringSelectMenuBuilder()
        .setCustomId('military_menu')
        .setPlaceholder('اختر إجراء...')
        .addOptions(addResetOption(menuOptions));
      
      const row = new ActionRowBuilder().addComponents(militaryMenu);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
      return;
    }

    // معالجة أمر /الشرطة
    if (interaction.isChatInputCommand() && interaction.commandName === 'الشرطة') {
      // تحقق من صلاحية الأدمن (احتياط)
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ هذا الأمر مخصص فقط للأدمن.', ephemeral: true });
        return;
      }
      // نفس إيمبيد /بطاقة
      const customImage = guildSettings[interaction.guildId]?.customEmbedImage || 'https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless';
      const embed = new EmbedBuilder()
        .setTitle('الشرطة')
        .setDescription('قائمة أوامر الشرطة. اختر من القائمة أدناه الإجراء المطلوب.')
        .setImage(customImage)
        .setColor('#00ff00');
      const menuOptions = [
        { label: 'بحث عن شخص', value: 'search_person' },
        { label: 'سجل الجرائم', value: 'crime_record' },
        { label: 'المخالفات', value: 'violations' },
        { label: 'ادارة النظام', value: 'system_admin' }
      ];
      const policeMenu = new StringSelectMenuBuilder()
        .setCustomId('police_menu')
        .setPlaceholder('اختر إجراء...')
        .addOptions(addResetOption(menuOptions));
      const row = new ActionRowBuilder().addComponents(policeMenu);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
      return;
    }
    // معالجة قائمة العسكر
    if (interaction.isStringSelectMenu() && interaction.customId === 'military_menu') {
      const selected = interaction.values[0];
      
      if (selected === 'reset_page') {
        // إعادة نفس القائمة (تحديث الصفحة فقط)
        const embed = new EmbedBuilder()
          .setTitle('نظام العسكر')
          .setDescription('مرحباً بك في نظام العسكر. اختر من القائمة أدناه الإجراء المطلوب.')
          .setImage('https://i.postimg.cc/VvC7rqnV/image.png')
          .setColor('#1e3a8a')
          .setTimestamp();
        
        const menuOptions = [
          { label: 'تسجيل دخول', value: 'military_login', description: 'تسجيل دخول للعسكر' },
          { label: 'تعيين الكود العسكري', value: 'set_military_code', description: 'تعيين كود عسكري جديد' },
          { label: 'نقاطي', value: 'my_military_points', description: 'عرض نقاطك العسكرية' },
          { label: 'ادارة النقاط | الاكواد العسكرية', value: 'manage_military', description: 'إدارة النظام العسكري' },
          { label: 'إعادة تعيين', value: 'reset_page', description: 'تحديث الصفحة' }
        ];
        
        const militaryMenu = new StringSelectMenuBuilder()
          .setCustomId('military_menu')
          .setPlaceholder('اختر إجراء...')
          .addOptions(menuOptions);
        
        const row = new ActionRowBuilder().addComponents(militaryMenu);
        await interaction.update({ embeds: [embed], components: [row] });
        return;
      }
      
      if (selected === 'military_login') {
        // التحقق من الشروط المطلوبة
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        
        // 1. التحقق من رتبة الشرطة
        if (!hasPoliceRole(interaction.member, guildId)) {
          await interaction.reply({ content: '❌ يجب أن تحمل رتبة الشرطة لاستخدام هذا الإجراء.', ephemeral: true });
          return;
        }
        
        // 2. التحقق من وجود هوية مقبولة
        if (!hasApprovedIdentity(userId, guildId)) {
          await interaction.reply({ content: '❌ يجب أن تملك هوية مقبولة لاستخدام هذا الإجراء.', ephemeral: true });
          return;
        }
        
        // 3. التحقق من وجود كود عسكري
        const militaryCode = getMilitaryCode(userId, guildId);
        if (!militaryCode) {
          await interaction.reply({ content: '❌ يجب أن يكون لديك كود عسكري معين. استخدم "تعيين الكود العسكري" أولاً.', ephemeral: true });
          return;
        }
        
        // إذا اجتمعت جميع الشروط، عرض قائمة تسجيل الدخول
        const embed = new EmbedBuilder()
          .setTitle('نظام تسجيل الدخول العسكري')
          .setDescription(`**المستخدم:** ${interaction.user}\n**الكود العسكري:** \`${militaryCode}\`\n\nاختر من القائمة أدناه الإجراء المطلوب:`)
          .setColor('#1e3a8a')
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        const loginOptions = [
          { label: 'تسجيل دخول', value: 'military_clock_in', description: 'تسجيل دخول للعمل العسكري' },
          { label: 'تسجيل خروج', value: 'military_clock_out', description: 'تسجيل خروج من العمل العسكري' },
          { label: 'انهاء عمل', value: 'military_end_shift', description: 'انهاء المناوبة العسكرية' }
        ];
        
        const loginMenu = new StringSelectMenuBuilder()
          .setCustomId('military_login_menu')
          .setPlaceholder('اختر إجراء تسجيل الدخول...')
          .addOptions(loginOptions);
        
        const row = new ActionRowBuilder().addComponents(loginMenu);
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        return;
      }
      
      if (selected === 'set_military_code') {
        // التحقق من الشروط المطلوبة
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        
        // التحقق من وجود هوية مقبولة
        if (!hasApprovedIdentity(userId, guildId)) {
          await interaction.reply({ content: '❌ يجب أن تكون لديك هوية مقبولة أولاً قبل طلب كود عسكري.', ephemeral: true });
          return;
        }
        
        // التحقق من رتبة الشرطة
        if (!hasPoliceRole(interaction.member, guildId)) {
          await interaction.reply({ content: '❌ يجب أن تكون لديك رتبة الشرطة أولاً قبل طلب كود عسكري.', ephemeral: true });
          return;
        }
        
        // التحقق من وجود كود عسكري بالفعل
        if (getMilitaryCode(userId, guildId)) {
          await interaction.reply({ content: '❌ لايمكنك تقديم طلب كود عسكري اخر لديك كود عسكري ب الفعل', ephemeral: true });
          return;
        }
        
        // التحقق من وجود طلب معلق
        if (hasPendingMilitaryCodeRequest(userId, guildId)) {
          await interaction.reply({ content: '❌ لديك طلب قيد المراجعة الى الان يرجى الانتضار في حال التاخير تواصل مع مسوؤلين الشرطة', ephemeral: true });
          return;
        }
        
        // فتح مودال طلب الكود العسكري
        const modal = new ModalBuilder()
          .setCustomId('modal_request_military_code')
          .setTitle('طلب كود عسكري');
        
        const codeInput = new TextInputBuilder()
          .setCustomId('input_military_code')
          .setLabel('اكتب كودك العسكري')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب كودك العسكري هنا')
          .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(codeInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
        return;
      }
      
      if (selected === 'my_military_points') {
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        
        // التحقق من وجود هوية مقبولة
        if (!hasApprovedIdentity(userId, guildId)) {
          await interaction.reply({ content: '❌ يجب أن تكون لديك هوية مقبولة أولاً لعرض نقاطك العسكرية.', ephemeral: true });
          return;
        }
        
        const points = getMilitaryPoints(userId, guildId);
        const militaryCode = getMilitaryCode(userId, guildId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const militaryUser = getMilitaryUser(userId, guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('🎖️ نقاطك العسكرية')
          .setDescription(`**مرحباً بك في نظام النقاط العسكرية!**`)
          .setColor('#fbbf24')
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}`, inline: false },
            { name: '🎖️ **المعلومات العسكرية**', value: `**الكود العسكري:** ${militaryCode ? `\`${militaryCode}\`` : 'غير محدد'}\n**الرتبة:** ${militaryUser?.rank || 'عسكري'}`, inline: false },
            { name: '⭐ **النقاط العسكرية**', value: `**إجمالي النقاط:** \`${points} نقطة\``, inline: false }
          )
          .setFooter({ text: 'نظام النقاط العسكرية' })
          .setTimestamp();
        
        // إضافة معلومات إضافية حسب مستوى النقاط
        if (points >= 100) {
          embed.addFields({ name: '🏆 **مستوى متقدم**', value: 'أنت من العسكريين المتميزين!', inline: false });
        } else if (points >= 50) {
          embed.addFields({ name: '🥉 **مستوى متوسط**', value: 'أداؤك جيد، استمر في التقدم!', inline: false });
        } else if (points >= 10) {
          embed.addFields({ name: '🆕 **مستوى مبتدئ**', value: 'أنت في بداية رحلتك العسكرية!', inline: false });
        } else {
          embed.addFields({ name: '🌱 **مستوى جديد**', value: 'ابدأ رحلتك العسكرية واكتسب نقاطك الأولى!', inline: false });
        }
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      
      if (selected === 'manage_military') {
        // التحقق من وجود هوية مقبولة ورتبة الشرطة
        if (!hasApprovedIdentity(interaction.user.id, interaction.guildId) || !hasPoliceRole(interaction.member, interaction.guildId)) {
          await interaction.reply({ content: '❌ يجب أن تملك هوية مقبولة وأن تحمل رتبة الشرطة لاستخدام هذه الأوامر.', ephemeral: true });
          return;
        }
        
        // قائمة إدارة العسكر
        const embed = new EmbedBuilder()
          .setTitle('إدارة النظام العسكري')
          .setDescription('اختر من القائمة أدناه الإجراء المطلوب لإدارة النظام العسكري.')
          .setColor('#1e3a8a')
          .setTimestamp();
        
        const manageOptions = [
          { label: 'إضافة نقاط لشخص', value: 'add_points_to_user', description: 'إضافة نقاط عسكرية لشخص معين' },
          { label: 'خصم نقاط من شخص', value: 'remove_points_from_user', description: 'خصم نقاط عسكرية من شخص معين' },
          { label: 'عرض جميع النقاط', value: 'view_all_points', description: 'عرض نقاط جميع العسكريين' },
          { label: 'إدارة الأكواد العسكرية', value: 'manage_military_codes', description: 'إدارة الأكواد العسكرية' },
          { label: 'إدارة تحذيرات العسكري', value: 'manage_military_warnings', description: 'إدارة تحذيرات العسكري' }
        ];
        
        const manageMenu = new StringSelectMenuBuilder()
          .setCustomId('manage_military_menu')
          .setPlaceholder('اختر إجراء إداري...')
          .addOptions(addResetOption(manageOptions));
        
        const row = new ActionRowBuilder().addComponents(manageMenu);
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        return;
      }

      if (selected === 'reset_military') {
        // إعادة تعيين القائمة الرئيسية
        const embed = new EmbedBuilder()
          .setTitle('نظام العسكر')
          .setDescription('مرحباً بك في نظام العسكر. اختر من القائمة أدناه الإجراء المطلوب.')
          .setImage('https://i.postimg.cc/VvC7rqnV/image.png')
          .setColor('#1e3a8a')
          .setTimestamp();
        
        const menuOptions = [
          { label: 'تسجيل دخول', value: 'military_login', description: 'تسجيل دخول للعسكر' },
          { label: 'تعيين الكود العسكري', value: 'set_military_code', description: 'تعيين كود عسكري جديد' },
          { label: 'نقاطي', value: 'my_military_points', description: 'عرض نقاطك العسكرية' },
          { label: 'ادارة النقاط | الاكواد العسكرية', value: 'manage_military', description: 'إدارة النظام العسكري' },
          { label: 'إعادة تعيين', value: 'reset_military', description: 'تحديث الصفحة' }
        ];
        
        const militaryMenu = new StringSelectMenuBuilder()
          .setCustomId('military_menu')
          .setPlaceholder('اختر إجراء...')
          .addOptions(menuOptions);
        
        const row = new ActionRowBuilder().addComponents(militaryMenu);
        await interaction.update({ embeds: [embed], components: [row] });
        return;
      }


    }

    // معالجة قائمة تسجيل الدخول العسكري
    if (interaction.isStringSelectMenu() && interaction.customId === 'military_login_menu') {
      const selected = interaction.values[0];
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      
      if (selected === 'military_clock_in') {
        // تسجيل دخول للعمل العسكري
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        
        // التحقق من وجود هوية مقبولة
        if (!hasApprovedIdentity(userId, guildId)) {
          await interaction.reply({ content: '❌ يجب أن تكون لديك هوية مقبولة أولاً.', ephemeral: true });
          return;
        }
        
        // التحقق من وجود كود عسكري
        const militaryCode = getMilitaryCode(userId, guildId);
        if (!militaryCode) {
          await interaction.reply({ content: '❌ يجب أن يكون لديك كود عسكري مقبول أولاً.', ephemeral: true });
          return;
        }
        
        // تحديث حالة العسكري
        const success = updateMilitaryUserStatus(userId, guildId, 'in');
        if (!success) {
          await interaction.reply({ content: '❌ فشل في تحديث الحالة.', ephemeral: true });
          return;
        }
        
        // تحديث الصورة في روم مباشرة العسكر
        await updateMilitaryPageImage(guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ تم تسجيل الدخول بنجاح')
          .setDescription(`**المستخدم:** ${interaction.user}\n**وقت الدخول:** <t:${Math.floor(Date.now() / 1000)}:F>\n**الحالة:** متصل للعمل العسكري\n**الكود العسكري:** \`${militaryCode}\``)
          .setColor('#00ff00')
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      
      if (selected === 'military_clock_out') {
        // تسجيل خروج من العمل العسكري
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        
        // التحقق من وجود هوية مقبولة
        if (!hasApprovedIdentity(userId, guildId)) {
          await interaction.reply({ content: '❌ يجب أن تكون لديك هوية مقبولة أولاً.', ephemeral: true });
          return;
        }
        
        // التحقق من وجود كود عسكري
        const militaryCode = getMilitaryCode(userId, guildId);
        if (!militaryCode) {
          await interaction.reply({ content: '❌ يجب أن يكون لديك كود عسكري مقبول أولاً.', ephemeral: true });
          return;
        }
        
        // تحديث حالة العسكري
        const success = updateMilitaryUserStatus(userId, guildId, 'out');
        if (!success) {
          await interaction.reply({ content: '❌ فشل في تحديث الحالة.', ephemeral: true });
          return;
        }
        
        // تحديث الصورة في روم مباشرة العسكر
        await updateMilitaryPageImage(guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('🔄 تم تسجيل الخروج بنجاح')
          .setDescription(`**المستخدم:** ${interaction.user}\n**وقت الخروج:** <t:${Math.floor(Date.now() / 1000)}:F>\n**الحالة:** خارج من العمل العسكري\n**الكود العسكري:** \`${militaryCode}\``)
          .setColor('#ff9900')
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      
      if (selected === 'military_end_shift') {
        // انهاء المناوبة العسكرية
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        
        // التحقق من وجود هوية مقبولة
        if (!hasApprovedIdentity(userId, guildId)) {
          await interaction.reply({ content: '❌ يجب أن تكون لديك هوية مقبولة أولاً.', ephemeral: true });
          return;
        }
        
        // التحقق من وجود كود عسكري
        const militaryCode = getMilitaryCode(userId, guildId);
        if (!militaryCode) {
          await interaction.reply({ content: '❌ يجب أن يكون لديك كود عسكري مقبول أولاً.', ephemeral: true });
          return;
        }
        
        // تحديث حالة العسكري
        const success = updateMilitaryUserStatus(userId, guildId, 'ended');
        if (!success) {
          await interaction.reply({ content: '❌ فشل في تحديث الحالة.', ephemeral: true });
          return;
        }
        
        // تحديث الصورة في روم مباشرة العسكر
        await updateMilitaryPageImage(guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('🏁 تم انهاء المناوبة بنجاح')
          .setDescription(`**المستخدم:** ${interaction.user}\n**وقت انهاء المناوبة:** <t:${Math.floor(Date.now() / 1000)}:F>\n**الحالة:** مناوبة منتهية\n**الكود العسكري:** \`${militaryCode}\``)
          .setColor('#ff0000')
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    }

    // معالجة قائمة إدارة العسكر
    if (interaction.isStringSelectMenu() && interaction.customId === 'manage_military_menu') {
      const selected = interaction.values[0];
      
      if (selected === 'reset_page') {
        // إعادة نفس القائمة
        const embed = new EmbedBuilder()
          .setTitle('إدارة النظام العسكري')
          .setDescription('اختر من القائمة أدناه الإجراء المطلوب لإدارة النظام العسكري.')
          .setColor('#1e3a8a')
          .setTimestamp();
        
        const manageOptions = [
          { label: 'إضافة نقاط لشخص', value: 'add_points_to_user', description: 'إضافة نقاط عسكرية لشخص معين' },
          { label: 'خصم نقاط من شخص', value: 'remove_points_from_user', description: 'خصم نقاط عسكرية من شخص معين' },
          { label: 'عرض جميع النقاط', value: 'view_all_points', description: 'عرض نقاط جميع العسكريين' },
          { label: 'إدارة الأكواد العسكرية', value: 'manage_military_codes', description: 'إدارة الأكواد العسكرية' },
          { label: 'إدارة تحذيرات العسكري', value: 'manage_military_warnings', description: 'إدارة تحذيرات العسكري' },
          { label: 'إعادة تعيين', value: 'reset_page', description: 'تحديث الصفحة' }
        ];
        
        const manageMenu = new StringSelectMenuBuilder()
          .setCustomId('manage_military_menu')
          .setPlaceholder('اختر إجراء إداري...')
          .addOptions(manageOptions);
        
        const row = new ActionRowBuilder().addComponents(manageMenu);
        await interaction.update({ embeds: [embed], components: [row] });
        return;
      }
      
      if (selected === 'add_points_to_user') {
        const modal = new ModalBuilder()
          .setCustomId('modal_add_military_points')
          .setTitle('إضافة نقاط عسكرية');
        
        const userInput = new TextInputBuilder()
          .setCustomId('input_target_user')
          .setLabel('اسم الشخص أو الرقم الوطني')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الاسم الكامل أو الرقم الوطني')
          .setRequired(true);
        
        const pointsInput = new TextInputBuilder()
          .setCustomId('input_points_to_add')
          .setLabel('عدد النقاط')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب عدد النقاط المراد إضافتها')
          .setRequired(true);
        
        const row1 = new ActionRowBuilder().addComponents(userInput);
        const row2 = new ActionRowBuilder().addComponents(pointsInput);
        modal.addComponents(row1, row2);
        
        await interaction.showModal(modal);
        return;
      }
      
      if (selected === 'remove_points_from_user') {
        const modal = new ModalBuilder()
          .setCustomId('modal_remove_military_points')
          .setTitle('خصم نقاط عسكرية');
        
        const userInput = new TextInputBuilder()
          .setCustomId('input_target_user_remove')
          .setLabel('اسم الشخص أو الرقم الوطني')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الاسم الكامل أو الرقم الوطني')
          .setRequired(true);
        
        const pointsInput = new TextInputBuilder()
          .setCustomId('input_points_to_remove')
          .setLabel('عدد النقاط')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب عدد النقاط المراد خصمها')
          .setRequired(true);
        
        const row1 = new ActionRowBuilder().addComponents(userInput);
        const row2 = new ActionRowBuilder().addComponents(pointsInput);
        modal.addComponents(row1, row2);
        
        await interaction.showModal(modal);
        return;
      }
      
      if (selected === 'view_all_points') {
        const guildId = interaction.guildId;
        const allPoints = getAllMilitaryPoints(guildId);
        
        if (allPoints.length === 0) {
          await interaction.reply({ content: '❌ لا توجد نقاط عسكرية مسجلة حالياً.', ephemeral: true });
          return;
        }
        
        const embed = new EmbedBuilder()
          .setTitle('📊 جميع النقاط العسكرية')
          .setDescription('قائمة بجميع النقاط العسكرية في السيرفر (مرتبة حسب النقاط)')
          .setColor('#1e3a8a')
          .setTimestamp();
        
        let description = '';
        let rank = 1;
        
        for (const { userId, points } of allPoints) {
          try {
            const user = await client.users.fetch(userId);
            const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
            const militaryCode = getMilitaryCode(userId, guildId);
            
            // إضافة رتبة حسب النقاط
            let rankEmoji = '🥇';
            if (rank === 2) rankEmoji = '🥈';
            else if (rank === 3) rankEmoji = '🥉';
            else if (rank > 3) rankEmoji = `**${rank}.**`;
            
            description += `${rankEmoji} **${user.username}**\n`;
            description += `   👤 **الاسم:** ${identity?.fullName || 'غير محدد'}\n`;
            description += `   🎖️ **الكود:** ${militaryCode ? `\`${militaryCode}\`` : 'غير محدد'}\n`;
            description += `   ⭐ **النقاط:** \`${points} نقطة\`\n\n`;
            
            rank++;
          } catch (e) {
            description += `**مستخدم غير معروف (${userId}):** ${points} نقطة\n\n`;
            rank++;
          }
        }
        
        embed.setDescription(description);
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
      
      if (selected === 'manage_military_codes') {
        const modal = new ModalBuilder()
          .setCustomId('modal_manage_military_codes')
          .setTitle('إدارة الأكواد العسكرية');
        
        const userInput = new TextInputBuilder()
          .setCustomId('input_search_military_code')
          .setLabel('اسم الشخص أو الرقم الوطني')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الاسم الكامل أو الرقم الوطني')
          .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(userInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
        return;
      }

      if (selected === 'manage_military_warnings') {
        const modal = new ModalBuilder()
          .setCustomId('modal_manage_military_warnings')
          .setTitle('إدارة تحذيرات العسكري');
        
        const userInput = new TextInputBuilder()
          .setCustomId('input_search_military_warnings')
          .setLabel('اسم الشخص أو الرقم الوطني')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الاسم الكامل أو الرقم الوطني')
          .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(userInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
        return;
      }
    }

    // معالجة قائمة الشرطة
    if (interaction.isStringSelectMenu() && interaction.customId === 'police_menu') {
      // تحقق من رتبة الشرطة وهوية مقبولة
      if (!hasPoliceRole(interaction.member, interaction.guildId) || !hasApprovedIdentity(interaction.user.id, interaction.guildId)) {
        await interaction.reply({ content: '❌ يجب أن تملك هوية وأن تحمل رتبة الشرطة لاستخدام هذه الأوامر.', ephemeral: true });
        return;
      }
      const selected = interaction.values[0];
      if (selected === 'reset_police') {
        // إعادة نفس القائمة (تحديث الصفحة فقط)
        const embed = new EmbedBuilder()
          .setTitle('الشرطة')
          .setDescription('قائمة أوامر الشرطة. اختر من القائمة أدناه الإجراء المطلوب.')
          .setImage(customImage)
          .setColor('#00ff00');
        const policeMenu = new StringSelectMenuBuilder()
          .setCustomId('police_menu')
          .setPlaceholder('اختر إجراء...')
          .addOptions([
            { label: 'بحث عن شخص', value: 'search_person' },
            { label: 'سجل الجرائم', value: 'crime_record' },
            { label: 'المخالفات', value: 'violations' },
            { label: 'ادارة النظام', value: 'system_admin' },
            { label: 'إعادة تعيين', value: 'reset_police', description: 'تحديث الصفحة' }
          ]);
        const row = new ActionRowBuilder().addComponents(policeMenu);
        await interaction.update({ embeds: [embed], components: [row] });
        return;
      }
      if (selected === 'search_person') {
        // فتح مودال اسم أو رقم هوية
        const modal = new ModalBuilder()
          .setCustomId('modal_search_person')
          .setTitle('بحث عن شخص');
        const input = new TextInputBuilder()
          .setCustomId('input_search_person')
          .setLabel('اسم الشخص أو رقم الهوية')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الاسم الأول أو الكامل أو الرقم الوطني')
          .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
        await interaction.showModal(modal);
        return;
      }
      if (selected === 'crime_record') {
        // فقط افتح المودال ولا تنفذ أي منطق آخر هنا
        const modal = new ModalBuilder()
          .setCustomId('modal_crime_record')
          .setTitle('بحث سجل الجرائم');
        const input = new TextInputBuilder()
          .setCustomId('input_crime_record')
          .setLabel('اسم الشخص الكامل أو رقم الهوية')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الاسم الكامل أو الرقم الوطني')
          .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
        await interaction.showModal(modal);
        return;
      }
      if (selected === 'violations') {
        // فتح مودال اسم أو رقم هوية (بحث مخالفات)
        const modal = new ModalBuilder()
          .setCustomId('modal_police_violations')
          .setTitle('بحث مخالفات شخص');
        const input = new TextInputBuilder()
          .setCustomId('input_police_violations')
          .setLabel('اسم الشخص الكامل أو رقم الهوية')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الاسم الكامل أو الرقم الوطني')
          .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
        await interaction.showModal(modal);
        return;
      }
      if (selected === 'system_admin') {
        // تحقق من وجود هوية ورُتبة الشرطة فقط (وليس مسؤول الشرطة)
        const policeRoleId = guildSettings[interaction.guildId]?.policeRoleId;
        if (!hasApprovedIdentity(interaction.user.id, interaction.guildId) || !policeRoleId || !interaction.member.roles.cache.has(policeRoleId)) {
          await interaction.reply({ content: '❌ يجب أن تملك هوية وأن تحمل رتبة الشرطة لاستخدام هذا الإجراء.', ephemeral: true });
          return;
        }
        // فتح مودال لكتابة اسم الشخص أو رقمه الوطني
        const modal = new ModalBuilder()
          .setCustomId('modal_system_admin_search_person')
          .setTitle('بحث عن شخص لإدارة النظام');
        const input = new TextInputBuilder()
          .setCustomId('input_system_admin_search_person')
          .setLabel('اسم الشخص أو رقم الهوية')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الاسم الكامل أو الرقم الوطني')
          .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
        await interaction.showModal(modal);
        return;
      }
      // باقي الأزرار (سجل الجرائم، المخالفات، ادارة النظام) منطقها لاحقاً
      await interaction.reply({ content: '🚧 سيتم تنفيذ هذا الزر لاحقاً.', ephemeral: true });
      return;
    }
    // معالجة مودال بحث عن شخص
    if (interaction.isModalSubmit() && interaction.customId === 'modal_search_person') {
      // تحقق من رتبة الشرطة
      if (!hasPoliceRole(interaction.member, interaction.guildId)) {
        await interaction.reply({ content: '❌ هذا الإجراء مخصص فقط لحاملي رتبة الشرطة.', ephemeral: true });
        return;
      }
      const value = interaction.fields.getTextInputValue('input_search_person').trim();
      // بحث بالاسم أو الرقم الوطني
      let found = null;
      if (/^\d+$/.test(value)) {
        found = identities.find(i => i.nationalId === value && i.guildId === interaction.guildId);
      } else {
        found = identities.find(i => (i.fullName.includes(value) || i.fullName.split(' ')[0] === value) && i.guildId === interaction.guildId);
      }
      if (!found) {
        await interaction.reply({ content: 'لايوجد شخص بهذا الاسم او الرقم الوطني هذا', ephemeral: true });
        return;
      }
      // إرسال المعلومات كرد خاص في الروم (وليس في الخاص)
      try {
        const user = await client.users.fetch(found.userId);
        const embed = new EmbedBuilder()
          .setTitle('معلومات الشخص')
          .setDescription(`**الاسم:** ${found.fullName}\n**الجنس:** ${found.gender === 'male' ? 'ذكر' : 'أنثى'}\n**المدينة:** ${found.city}\n**تاريخ الميلاد:** ${found.day} / ${found.month} / ${found.year}\n**رقم الهوية:** ${found.nationalId}`)
          .setColor('#00ff00')
          .setThumbnail(user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء عرض المعلومات.', ephemeral: true });
      }
      return;
    }
    // معالجة مودال سجل الجرائم
    if (interaction.isModalSubmit() && interaction.customId === 'modal_crime_record') {
      // تحقق من رتبة الشرطة وهوية مقبولة
      if (!hasPoliceRole(interaction.member, interaction.guildId) || !hasApprovedIdentity(interaction.user.id, interaction.guildId)) {
        await interaction.reply({ content: '❌ يجب أن تملك هوية وأن تحمل رتبة الشرطة لاستخدام هذه الأوامر.', ephemeral: true });
        return;
      }
      const value = interaction.fields.getTextInputValue('input_crime_record').trim();
      // بحث بالاسم الكامل أو الرقم الوطني
      let found = null;
      if (/^\d+$/.test(value)) {
        found = identities.find(i => i.nationalId === value && i.guildId === interaction.guildId);
      } else {
        found = identities.find(i => i.fullName === value && i.guildId === interaction.guildId);
      }
      if (!found) {
        await interaction.reply({ content: 'لايوجد شخص بهذا الاسم او الرقم الوطني هذا', ephemeral: true });
        return;
      }
      // توليد صورة سجل الجرائم مع بيانات العسكري والشخص المستعلم عنه وجرائم حقيقية
      try {
        // بيانات العسكري
        const officerUser = await client.users.fetch(interaction.user.id);
        const officerAvatar = officerUser.displayAvatarURL({ extension: 'png', size: 128 });
        const officerIdentity = identities.find(i => i.userId === interaction.user.id && i.guildId === interaction.guildId);
        const officerName = officerIdentity ? officerIdentity.fullName : officerUser.username;
        // بيانات الشخص
        const targetUser = await client.users.fetch(found.userId);
        const targetAvatar = targetUser.displayAvatarURL({ extension: 'png', size: 128 });
        const targetName = found.fullName;
        // جرائم حقيقية
        const crimes = found.crimes || [];
        // منطق الصفحات
        const page = 1;
        const perPage = 5;
        const totalPages = Math.ceil(crimes.length / perPage);
        const pageCrimes = crimes.slice((page-1)*perPage, page*perPage);
        // إعداد الصورة
        const cardWidth = 800;
        const cardHeight = 600;
        const canvas = createCanvas(cardWidth, cardHeight);
        const ctx = canvas.getContext('2d');
        // خلفية سوداء
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cardWidth, cardHeight);
        // اسم العسكري وصورته (أعلى يسار)
        const officerImg = await loadImage(officerAvatar);
        ctx.save();
          ctx.beginPath();
        ctx.arc(60, 60, 40, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(officerImg, 20, 20, 80, 80);
        ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(officerName, 110, 65);
        // اسم وصورة الشخص (أعلى يمين)
        const targetImg = await loadImage(targetAvatar);
          ctx.save();
          ctx.beginPath();
        ctx.arc(cardWidth-60, 60, 40, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
        ctx.drawImage(targetImg, cardWidth-100, 20, 80, 80);
          ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(targetName, cardWidth-110, 65);
        // عنوان سجل الجرائم (أعلى منتصف)
        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#00ff00';
        ctx.fillText('سجل الجرائم', cardWidth/2, 60);
        // إذا لا يوجد جرائم لهذا الشخص
        if (pageCrimes.length === 0) {
          ctx.font = 'bold 36px Arial';
          ctx.fillStyle = '#ff2222';
          ctx.textAlign = 'center';
          ctx.fillText('لايوجد سجل اجرامي للشخص', cardWidth/2, cardHeight/2);
          const buffer = canvas.toBuffer('image/png');
          await interaction.reply({ files: [{ attachment: buffer, name: 'crime_record.png' }], ephemeral: true });
          return;
        }
        // مربعات الجرائم
        const boxStartY = 130;
        const boxHeight = 65;
        const boxMargin = 20;
        for (let i = 0; i < pageCrimes.length; i++) {
          const y = boxStartY + i * (boxHeight + boxMargin);
          const isDone = pageCrimes[i].done;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(60 + 18, y);
          ctx.lineTo(60 + cardWidth-120 - 18, y);
          ctx.quadraticCurveTo(60 + cardWidth-120, y, 60 + cardWidth-120, y + 18);
          ctx.lineTo(60 + cardWidth-120, y + boxHeight - 18);
          ctx.quadraticCurveTo(60 + cardWidth-120, y + boxHeight, 60 + cardWidth-120 - 18, y + boxHeight);
          ctx.lineTo(60 + 18, y + boxHeight);
          ctx.quadraticCurveTo(60, y + boxHeight, 60, y + boxHeight - 18);
          ctx.lineTo(60, y + 18);
          ctx.quadraticCurveTo(60, y, 60 + 18, y);
          ctx.closePath();
          ctx.fillStyle = isDone ? '#1a4d1a' : '#4d1a1a';
          ctx.strokeStyle = isDone ? '#00ff00' : '#ff0000';
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          // عنوان الجريمة
          ctx.save();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'left';
          ctx.fillText(pageCrimes[i].title, 80, y+30);
        ctx.font = '16px Arial';
          ctx.fillStyle = '#ccc';
          ctx.fillText(pageCrimes[i].desc, 80, y+55);
          ctx.restore();
        }
        // زر رؤية المزيد إذا كان هناك صفحات أخرى
        let components = [];
        if (totalPages > 1) {
          const moreRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`crime_record_next_page_${found.userId}_2`)
              .setLabel('رؤية المزيد')
              .setStyle(ButtonStyle.Primary)
          );
          components = [moreRow];
        }
        const buffer = canvas.toBuffer('image/png');
        await interaction.reply({ files: [{ attachment: buffer, name: 'crime_record.png' }], components, ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء توليد صورة سجل الجرائم.', ephemeral: true });
      }
      return;
    }
    // زر رؤية المزيد لصفحات سجل الجرائم
    if (interaction.isButton() && interaction.customId.startsWith('crime_record_next_page_')) {
      // تحقق من رتبة الشرطة وهوية مقبولة
      if (!hasPoliceRole(interaction.member, interaction.guildId) || !hasApprovedIdentity(interaction.user.id, interaction.guildId)) {
        await interaction.reply({ content: '❌ يجب أن تملك هوية وأن تحمل رتبة الشرطة لاستخدام هذه الأوامر.', ephemeral: true });
        return;
      }
      // استخراج userId والصفحة
      const parts = interaction.customId.split('_');
      const userId = parts[4];
      const page = parseInt(parts[5]);
      const found = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!found) {
        await interaction.reply({ content: 'لايوجد شخص بهذا الرقم الوطني', ephemeral: true });
        return;
      }
      try {
        // بيانات العسكري
        const officerUser = await client.users.fetch(interaction.user.id);
        const officerAvatar = officerUser.displayAvatarURL({ extension: 'png', size: 128 });
        const officerIdentity = identities.find(i => i.userId === interaction.user.id && i.guildId === interaction.guildId);
        const officerName = officerIdentity ? officerIdentity.fullName : officerUser.username;
        // بيانات الشخص
        const targetUser = await client.users.fetch(found.userId);
        const targetAvatar = targetUser.displayAvatarURL({ extension: 'png', size: 128 });
        const targetName = found.fullName;
        // جرائم حقيقية
        const crimes = found.crimes || [];
        const perPage = 5;
        const totalPages = Math.ceil(crimes.length / perPage);
        const pageCrimes = crimes.slice((page-1)*perPage, page*perPage);
        // إعداد الصورة
        const cardWidth = 800;
        const cardHeight = 600;
        const canvas = createCanvas(cardWidth, cardHeight);
        const ctx = canvas.getContext('2d');
        // خلفية سوداء
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cardWidth, cardHeight);
        // اسم العسكري وصورته (أعلى يسار)
        const officerImg = await loadImage(officerAvatar);
        ctx.save();
        ctx.beginPath();
        ctx.arc(60, 60, 40, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(officerImg, 20, 20, 80, 80);
        ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(officerName, 110, 65);
        // اسم وصورة الشخص (أعلى يمين)
        const targetImg = await loadImage(targetAvatar);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cardWidth-60, 60, 40, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(targetImg, cardWidth-100, 20, 80, 80);
        ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(targetName, cardWidth-110, 65);
        // عنوان سجل الجرائم (أعلى منتصف)
        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#00ff00';
        ctx.fillText('سجل الجرائم', cardWidth/2, 60);
        // مربعات الجرائم
        const boxStartY = 130;
        const boxHeight = 65;
        const boxMargin = 20;
        for (let i = 0; i < pageCrimes.length; i++) {
          const y = boxStartY + i * (boxHeight + boxMargin);
          const isDone = pageCrimes[i].done;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(60 + 18, y);
          ctx.lineTo(60 + cardWidth-120 - 18, y);
          ctx.quadraticCurveTo(60 + cardWidth-120, y, 60 + cardWidth-120, y + 18);
          ctx.lineTo(60 + cardWidth-120, y + boxHeight - 18);
          ctx.quadraticCurveTo(60 + cardWidth-120, y + boxHeight, 60 + cardWidth-120 - 18, y + boxHeight);
          ctx.lineTo(60 + 18, y + boxHeight);
          ctx.quadraticCurveTo(60, y + boxHeight, 60, y + boxHeight - 18);
          ctx.lineTo(60, y + 18);
          ctx.quadraticCurveTo(60, y, 60 + 18, y);
          ctx.closePath();
          ctx.fillStyle = isDone ? '#1a4d1a' : '#4d1a1a';
          ctx.strokeStyle = isDone ? '#00ff00' : '#ff0000';
        ctx.fill();
          ctx.stroke();
          ctx.restore();
          // عنوان الجريمة
          ctx.save();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 20px Arial';
          ctx.textAlign = 'left';
          ctx.fillText(pageCrimes[i].title, 80, y+30);
          ctx.font = '16px Arial';
          ctx.fillStyle = '#ccc';
          ctx.fillText(pageCrimes[i].desc, 80, y+55);
          ctx.restore();
        }
        // زر رؤية المزيد إذا كان هناك صفحات أخرى
        let components = [];
        if (page < totalPages) {
          const moreRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`crime_record_next_page_${found.userId}_${page+1}`)
              .setLabel('رؤية المزيد')
              .setStyle(ButtonStyle.Primary)
          );
          components = [moreRow];
        }
        const buffer = canvas.toBuffer('image/png');
        await interaction.reply({ files: [{ attachment: buffer, name: 'crime_record.png' }], components, ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء توليد صورة سجل الجرائم.', ephemeral: true });
      }
      return;
    }
    // عند حفظ التعديل (مودال تعديل الهوية)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('edit_identity_modal_')) {
      const userId = interaction.customId.replace('edit_identity_modal_', '');
      const fullName = interaction.fields.getTextInputValue(`edit_full_name_${userId}`);
      const identity = identities.find(i => i.userId === userId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
        return;
      }
      const oldName = identity.fullName;
      identity.fullName = fullName;
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('✏️ تم تعديل هوية')
              .setDescription(`**تم تعديل هوية المستخدم:** <@${identity.userId}>
**الاسم السابق:** ${oldName}
**الاسم الجديد:** ${identity.fullName}
**تم التعديل من قبل:** <@${interaction.user.id}>`)
              .setColor('#fbbf24')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم تعديل الهوية بنجاح!', ephemeral: true });
      return;
    }
    // معالجة إعادة تعيين من قائمة /هويتي فقط
    if (interaction.isStringSelectMenu() && interaction.customId === 'my_identity_menu' && interaction.values[0] === 'reset') {
      const embed = new EmbedBuilder()
        .setTitle('هويتك')
        .setDescription('يمكنك من هنا عرض بطاقتك أو مخالفاتك.')
        .setImage('https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless')
        .setColor('#00ff00');
      const menu = new StringSelectMenuBuilder()
        .setCustomId('my_identity_menu')
        .setPlaceholder('اختر إجراء...')
        .addOptions([
          { label: 'بطاقتي', value: 'my_card' },
          { label: 'مخالفاتي', value: 'my_violations' },
          { label: 'إعادة تعيين', value: 'reset', description: 'تحديث الصفحة' }
        ]);
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }
    // منطق إعادة تعيين الإعدادات الإدارية فقط
    if (interaction.isStringSelectMenu() && (interaction.customId === 'admin_settings_menu' || interaction.customId === 'identity_select_menu_page_1') && (interaction.values[0] === 'reset' || interaction.values[0] === 'reset_identities')) {
      // إعادة إرسال نفس إيمبيد إدارة الهويات
      const embed = new EmbedBuilder()
        .setTitle('إدارة الهويات')
        .setDescription('اختر هوية من القائمة أدناه لعرضها أو تعديلها أو حذفها.')
        .setImage('https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless')
        .setColor('#00ff00');
      const guildIdentities = identities.filter(i => i.guildId === interaction.guildId);
      const page = 1;
      const pageSize = 22;
      const totalPages = Math.ceil(guildIdentities.length / pageSize) || 1;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageIdentities = guildIdentities.slice(start, end);
      const options = pageIdentities.map(i => ({ label: i.fullName, value: `identity_${i.userId}` }));
      if (totalPages > 1) {
        options.push({ label: 'رؤية المزيد', value: 'see_more_identities' });
      }
      options.push({ label: 'إعادة تعيين', value: 'reset_identities', description: 'إعادة تعيين القائمة' });
      const menu = new StringSelectMenuBuilder()
        .setCustomId('identity_select_menu_page_1')
        .setPlaceholder('اختر هوية...')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'modal_police_violations') {
      // تحقق من رتبة الشرطة وهوية مقبولة
      if (!hasPoliceRole(interaction.member, interaction.guildId) || !hasApprovedIdentity(interaction.user.id, interaction.guildId)) {
        await interaction.reply({ content: '❌ يجب أن تملك هوية وأن تحمل رتبة الشرطة لاستخدام هذه الأوامر.', ephemeral: true });
        return;
      }
      const value = interaction.fields.getTextInputValue('input_police_violations').trim();
      // بحث بالاسم الكامل أو الرقم الوطني
      let found = null;
      if (/^\d+$/.test(value)) {
        found = identities.find(i => i.nationalId === value && i.guildId === interaction.guildId);
      } else {
        found = identities.find(i => i.fullName === value && i.guildId === interaction.guildId);
      }
      if (!found) {
        await interaction.reply({ content: 'لايوجد شخص بهذا الاسم او الرقم الوطني هذا', ephemeral: true });
        return;
      }
      // توليد صورة المخالفات للشخص المطلوب
      try {
        const cardWidth = 600;
        const cardHeight = 400;
        const canvas = createCanvas(cardWidth, cardHeight);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, cardWidth, cardHeight);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, 0, cardWidth, 60);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, cardHeight - 50, cardWidth, 50);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('المخالفات', cardWidth / 2, 35);
        const user = await client.users.fetch(found.userId).catch(() => null);
        const avatarURL = user ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
        if (avatarURL) {
          const avatar = await loadImage(avatarURL);
          const avatarSize = 100;
          const avatarX = 30;
          const avatarY = 80;
          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
          ctx.restore();
        }
        ctx.fillStyle = '#222';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(found.fullName, 150, 120);
        // جلب مخالفات الشخص (حاليًا فارغة)
        const violations = found.violations || [];
        const page = 1;
        const perPage = 3;
        const totalPages = Math.ceil(violations.length / perPage);
        const pageViolations = violations.slice((page-1)*perPage, page*perPage);
        // إذا لا يوجد مخالفات
        if (violations.length === 0) {
          ctx.font = 'bold 32px Arial';
          ctx.fillStyle = '#ff0000';
          ctx.textAlign = 'center';
          ctx.fillText('لايوجد مخالفات', cardWidth/2, cardHeight/2);
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1e3a8a';
          ctx.font = 'bold 14px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('MDT', 50, cardHeight - 75);
          const buffer = canvas.toBuffer('image/png');
          await interaction.reply({ files: [{ attachment: buffer, name: 'violations_card.png' }], ephemeral: true });
          return;
        }
        // رسم مربعات المخالفات (حتى 3)
        for (let i = 0; i < Math.min(pageViolations.length, 3); i++) {
          const v = pageViolations[i];
          const y = 160 + i*90;
          const boxHeight = (i === 2) ? 45 : 80;
          const boxBg = v.status === 'مسددة' ? '#d1fae5' : '#fee2e2';
          ctx.fillStyle = boxBg;
          ctx.strokeStyle = '#1e3a8a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(150, y, 400, boxHeight, 15);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#1e3a8a';
          ctx.font = 'bold 18px Arial';
          ctx.fillText(v.name, 170, y+25);
          ctx.font = '16px Arial';
          ctx.fillStyle = v.status === 'مسددة' ? '#00ff00' : '#ff0000';
          ctx.fillText(v.status, 170, y+boxHeight-10);
          ctx.font = '14px Arial';
          ctx.fillStyle = '#222';
          ctx.fillText(v.desc || '', 350, y+25);
        }
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('MDT', 50, cardHeight - 75);
        const buffer = canvas.toBuffer('image/png');
        const customImage = guildSettings[interaction.guildId]?.customEmbedImage;
        const embed = new EmbedBuilder()
          .setTitle('مخالفات الشخص')
          .setDescription(`**الاسم:** ${found.fullName}\n**عدد المخالفات:** ${violations.length}\n\n${pageViolations.map(v => `- ${v.name}: ${v.status}`).join('\n')}`)
          .setColor('#ff0000')
          .setImage('attachment://violations_card.png');
        if (customImage) embed.setThumbnail(customImage);
        // زر رؤية المزيد إذا كان هناك صفحات أخرى
        let components = [];
      if (totalPages > 1) {
        const moreRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
              .setCustomId(`police_violations_next_page_${found.userId}_2`)
            .setLabel('رؤية المزيد')
            .setStyle(ButtonStyle.Primary)
        );
          components = [moreRow];
        }
        await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'violations_card.png' }], components, ephemeral: true });
      } catch (err) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء توليد صورة المخالفات.', ephemeral: true });
      }
      return;
    }
    // زر رؤية المزيد لصفحات مخالفات شخص من الشرطة
    if (interaction.isButton() && interaction.customId.startsWith('police_violations_next_page_')) {
      // استخراج userId والصفحة
      const parts = interaction.customId.split('_');
      const userId = parts[4];
      const page = parseInt(parts[5]);
      const found = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!found) {
        await interaction.reply({ content: 'لايوجد شخص بهذا الرقم الوطني', ephemeral: true });
        return;
      }
      try {
        const cardWidth = 600;
        const cardHeight = 400;
        const canvas = createCanvas(cardWidth, cardHeight);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, cardWidth, cardHeight);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, 0, cardWidth, 60);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, cardHeight - 50, cardWidth, 50);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('المخالفات', cardWidth / 2, 35);
        const user = await client.users.fetch(found.userId).catch(() => null);
        const avatarURL = user ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
        if (avatarURL) {
          const avatar = await loadImage(avatarURL);
          const avatarSize = 100;
          const avatarX = 30;
          const avatarY = 80;
          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
          ctx.restore();
        }
        ctx.fillStyle = '#222';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(found.fullName, 150, 120);
        const violations = found.violations || [];
        const perPage = 3;
        const totalPages = Math.ceil(violations.length / perPage);
        const pageViolations = violations.slice((page-1)*perPage, page*perPage);
        // إذا لا يوجد مخالفات في هذه الصفحة
        if (pageViolations.length === 0) {
          ctx.font = 'bold 32px Arial';
          ctx.fillStyle = '#ff0000';
          ctx.textAlign = 'center';
          ctx.fillText('لايوجد مخالفات في هذه الصفحة', cardWidth/2, cardHeight/2);
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1e3a8a';
          ctx.font = 'bold 14px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('MDT', 50, cardHeight - 75);
          const buffer = canvas.toBuffer('image/png');
          const embed = new EmbedBuilder()
            .setTitle(`مخالفات الشخص (صفحة ${page})`)
            .setDescription(`**الاسم:** ${found.fullName}\n**عدد المخالفات:** ${violations.length}`)
            .setColor('#ff0000')
            .setImage('attachment://violations_card.png');
          await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'violations_card.png' }], ephemeral: true });
          return;
        }
        // رسم مربعات المخالفات (حتى 3)
        for (let i = 0; i < pageViolations.length; i++) {
          const v = pageViolations[i];
          const y = 160 + i*90;
          const boxHeight = (i === 2) ? 45 : 80;
          const boxBg = v.status === 'مسددة' ? '#d1fae5' : '#fee2e2';
          ctx.fillStyle = boxBg;
          ctx.strokeStyle = '#1e3a8a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(150, y, 400, boxHeight, 15);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#1e3a8a';
          ctx.font = 'bold 18px Arial';
          ctx.fillText(v.name, 170, y+25);
          ctx.font = '16px Arial';
          ctx.fillStyle = v.status === 'مسددة' ? '#00ff00' : '#ff0000';
          ctx.fillText(v.status, 170, y+boxHeight-10);
          ctx.font = '14px Arial';
          ctx.fillStyle = '#222';
          ctx.fillText(v.desc || '', 350, y+25);
        }
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('MDT', 50, cardHeight - 75);
        const buffer = canvas.toBuffer('image/png');
        const customImage = guildSettings[interaction.guildId]?.customEmbedImage;
        const embed = new EmbedBuilder()
          .setTitle(`مخالفات الشخص (صفحة ${page})`)
          .setDescription(`**الاسم:** ${found.fullName}\n**عدد المخالفات:** ${violations.length}\n\n${pageViolations.map(v => `- ${v.name}: ${v.status}`).join('\n')}`)
          .setColor('#ff0000')
          .setImage('attachment://violations_card.png');
        if (customImage) embed.setThumbnail(customImage);
        // زر رؤية المزيد إذا كان هناك صفحات أخرى
        let components = [];
        if (page < totalPages) {
          const moreRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`police_violations_next_page_${found.userId}_${page+1}`)
              .setLabel('رؤية المزيد')
              .setStyle(ButtonStyle.Primary)
          );
          components = [moreRow];
        }
        await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'violations_card.png' }], components, ephemeral: true });
      } catch (err) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء توليد صورة المخالفات.', ephemeral: true });
      }
      return;
    }
    // معالجة مودال إدارة النظام (بحث عن شخص)
    if (interaction.isModalSubmit() && interaction.customId === 'modal_system_admin_search_person') {
      const value = interaction.fields.getTextInputValue('input_system_admin_search_person').trim();
      // بحث بالاسم الكامل أو الرقم الوطني
      let found = null;
      if (/^\d+$/.test(value)) {
        found = identities.find(i => i.nationalId === value && i.guildId === interaction.guildId);
    } else {
        found = identities.find(i => i.fullName === value && i.guildId === interaction.guildId);
      }
      if (!found) {
        await interaction.reply({ content: 'لايوجد شخص بهذا الاسم او الرقم الوطني هذا', ephemeral: true });
      return;
    }
      // توليد صورة الهوية (مثل زر بطاقتي)
      try {
        console.log('بيانات الهوية:', found);
        const user = await client.users.fetch(found.userId).catch(() => null);
        const avatarURL = user ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
        console.log('avatarURL:', avatarURL);
        const cardWidth = 600;
        const cardHeight = 400;
        const canvas = createCanvas(cardWidth, cardHeight);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, cardWidth, cardHeight);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, 0, cardWidth, 60);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, cardHeight - 50, cardWidth, 50);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('بطاقة الهوية الرسمية', cardWidth / 2, 35);
        if (avatarURL) {
          const avatar = await loadImage(avatarURL);
          const avatarSize = 120;
          const avatarX = 50;
          const avatarY = 80;
          ctx.fillStyle = '#e5e7eb';
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2 + 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2, true);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
          ctx.restore();
        }
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'right';
        const labels = [
          { text: 'الاسم الكامل', y: 100 },
          { text: 'المدينة', y: 140 },
          { text: 'تاريخ الميلاد', y: 180 },
          { text: 'الجنسية', y: 220 },
          { text: 'رقم الهوية', y: 260 }
        ];
        labels.forEach(label => {
          ctx.fillText(label.text, 280, label.y);
        });
        ctx.textAlign = 'left';
        ctx.font = '16px Arial';
        ctx.fillText(found.fullName, 300, 100);
        ctx.fillText(found.city, 300, 140);
        const monthNames = {
          '1': 'يناير', '2': 'فبراير', '3': 'مارس', '4': 'أبريل', '5': 'مايو', '6': 'يونيو',
          '7': 'يوليو', '8': 'أغسطس', '9': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر'
        };
        const birthTextAr = `${found.day} / ${monthNames[found.month] || found.month} / ${found.year}`;
        ctx.fillText(birthTextAr, 300, 180);
        const genderText = found.gender === 'male' ? 'ذكر' : 'أنثى';
        ctx.fillText(genderText, 300, 220);
        ctx.fillText(found.nationalId, 300, 260);
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px Arial';
        ctx.textAlign = 'right';
        ctx.fillText('تاريخ الإصدار :', cardWidth - 20, cardHeight - 20);
        ctx.textAlign = 'left';
        ctx.fillText(birthTextAr, 20, cardHeight - 20);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(50, cardHeight - 80, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('MDT', 50, cardHeight - 75);
        const buffer = canvas.toBuffer('image/png');
        // أزرار الإدارة
        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`add_violation_${found.userId}`).setLabel('إضافة مخالفة').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`add_crime_${found.userId}`).setLabel('إضافة جريمة').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`delete_violation_${found.userId}`).setLabel('حذف مخالفة').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`delete_crime_${found.userId}`).setLabel('حذف جريمة').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`edit_violation_${found.userId}`).setLabel('تعديل مخالفة').setStyle(ButtonStyle.Primary)
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`edit_crime_${found.userId}`).setLabel('تعديل جريمة').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`add_evidence_${found.userId}`).setLabel('إضافة الأدلة').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`view_evidence_details_${found.userId}`).setLabel('رؤية التفاصيل').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`delete_evidence_${found.userId}`).setLabel('حذف الأدلة').setStyle(ButtonStyle.Danger)
        );
        const embed = new EmbedBuilder()
          .setTitle('هوية الشخص')
          .setDescription(`**الاسم:** ${found.fullName}\n**المدينة:** ${found.city}\n**تاريخ الميلاد:** ${birthTextAr}\n**الجنس:** ${genderText}\n**رقم الهوية:** ${found.nationalId}`)
          .setColor('#00ff00')
          .setImage('attachment://id_card.png');
        await interaction.reply({ embeds: [embed], files: [{ attachment: buffer, name: 'id_card.png' }], components: [row1, row2], ephemeral: true });
      } catch (e) {
        console.error('❌ خطأ أثناء توليد صورة الهوية:', e);
        await interaction.reply({ content: '❌ حدث خطأ أثناء توليد صورة الهوية: ' + e.message, ephemeral: true });
      }
    }
    // زر حذف الأدلة - فقط لمسؤول الشرطة
if (interaction.isButton() && interaction.customId.startsWith('delete_evidence_')) {
  if (!hasPoliceAdminRole(interaction.member, interaction.guildId)) {
    await interaction.reply({ content: '❌ هذا الزر مخصص فقط لمسؤول الشرطة.', ephemeral: true });
    return;
  }
  const userId = interaction.customId.replace('delete_evidence_', '');
  const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
  if (!identity || !identity.crimes) {
    await interaction.reply({ content: 'لا توجد جرائم لهذا الشخص.', ephemeral: true });
    return;
  }
  const crimesWithEvidence = identity.crimes.filter(c => Array.isArray(c.evidence) && c.evidence.length > 0);
  if (crimesWithEvidence.length === 0) {
    await interaction.reply({ content: 'لا توجد جرائم تحتوي على أدلة.', ephemeral: true });
    return;
  }
  const page = 1;
  const pageSize = 23;
  const totalPages = Math.ceil(crimesWithEvidence.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageCrimes = crimesWithEvidence.slice(start, end);
  const options = pageCrimes.map((c, idx) => ({
    label: `${c.title} - ${c.desc || ''}`.slice(0, 90),
    value: `delete_evidence_crime_${c.id}_${userId}_${page}`
  }));
  if (totalPages > 1) {
    options.push({ label: 'رؤية المزيد', value: `delete_evidence_more_${userId}_${page+1}` });
  }
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`delete_evidence_select_${userId}_${page}`)
    .setPlaceholder('اختر جريمة لحذف دليل منها')
    .addOptions(options);
  const row = new ActionRowBuilder().addComponents(selectMenu);
  const embed = new EmbedBuilder()
    .setTitle('حذف الأدلة')
    .setDescription('اختر جريمة من القائمة أدناه لحذف دليل منها')
    .setColor('#ff0000');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

// صفحات حذف الأدلة
if (interaction.isStringSelectMenu() && interaction.customId.startsWith('delete_evidence_select_') && interaction.values[0].startsWith('delete_evidence_more_')) {
  const parts = interaction.values[0].split('_');
  const userId = parts[3];
  const page = parseInt(parts[4]);
  const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
  if (!identity || !identity.crimes) {
    await interaction.reply({ content: 'لا توجد جرائم لهذا الشخص.', ephemeral: true });
        return;
      }
  const crimesWithEvidence = identity.crimes.filter(c => Array.isArray(c.evidence) && c.evidence.length > 0);
  if (crimesWithEvidence.length === 0) {
    await interaction.reply({ content: 'لا توجد جرائم تحتوي على أدلة.', ephemeral: true });
    return;
  }
  const pageSize = 23;
  const totalPages = Math.ceil(crimesWithEvidence.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageCrimes = crimesWithEvidence.slice(start, end);
  const options = pageCrimes.map((c, idx) => ({
    label: `${c.title} - ${c.desc || ''}`.slice(0, 90),
    value: `delete_evidence_crime_${c.id}_${userId}_${page}`
  }));
  if (page < totalPages) {
    options.push({ label: 'رؤية المزيد', value: `delete_evidence_more_${userId}_${page+1}` });
  }
      const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`delete_evidence_select_${userId}_${page}`)
    .setPlaceholder('اختر جريمة لحذف دليل منها')
    .addOptions(options);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
    .setTitle('حذف الأدلة')
    .setDescription('اختر جريمة من القائمة أدناه لحذف دليل منها')
    .setColor('#ff0000');
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

// عند اختيار جريمة لحذف دليل منها
if (interaction.isStringSelectMenu() && interaction.customId.startsWith('delete_evidence_select_') && interaction.values[0].startsWith('delete_evidence_crime_')) {
  const parts = interaction.values[0].split('_');
  const crimeId = parts[3];
  const userId = parts[4];
  const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
  const c = identity && identity.crimes ? identity.crimes.find(cc => cc.id === crimeId) : null;
  if (!identity || !c || !Array.isArray(c.evidence) || c.evidence.length === 0) {
    await interaction.reply({ content: 'تعذر العثور على الجريمة أو لا يوجد أدلة.', ephemeral: true });
        return;
      }
  // قائمة الأدلة
  const options = c.evidence.map((url, idx) => ({
    label: `دليل ${idx+1}`,
    value: `delete_evidence_url_${crimeId}_${userId}_${idx}`
  }));
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`delete_evidence_url_select_${crimeId}_${userId}`)
    .setPlaceholder('اختر الدليل الذي تريد حذفه')
    .addOptions(options);
  const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
    .setTitle('حذف دليل محدد')
    .setDescription(`**العنوان:** ${c.title}\n**الوصف:** ${c.desc || ''}\n**الحالة:** ${c.done ? 'منفذة' : 'غير منفذة'}`)
    .setColor('#ff0000');
  if (c.evidence[0]) embed.setImage(c.evidence[0]);
  embed.addFields({ name: 'روابط الأدلة', value: c.evidence.map((url, i) => `[دليل ${i+1}](${url})`).join('\n') });
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  return;
}

// عند اختيار دليل معين للحذف
if (interaction.isStringSelectMenu() && interaction.customId.startsWith('delete_evidence_url_select_')) {
  const parts = interaction.values[0].split('_');
  const crimeId = parts[3];
  const userId = parts[4];
  const evidenceIdx = parseInt(parts[5]);
  const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
  const c = identity && identity.crimes ? identity.crimes.find(cc => cc.id === crimeId) : null;
  if (!identity || !c || !Array.isArray(c.evidence) || c.evidence.length <= evidenceIdx) {
    await interaction.reply({ content: 'تعذر العثور على الدليل.', ephemeral: true });
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle('تأكيد حذف الدليل المحدد')
    .setDescription(`**العنوان:** ${c.title}\n**الوصف:** ${c.desc || ''}\n**الحالة:** ${c.done ? 'منفذة' : 'غير منفذة'}`)
    .setColor('#ff0000');
  embed.addFields({ name: 'رابط الدليل', value: `[دليل ${evidenceIdx+1}](${c.evidence[evidenceIdx]})` });
  embed.setImage(c.evidence[evidenceIdx]);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_delete_evidence_url_${userId}_${crimeId}_${evidenceIdx}`).setLabel('تأكيد حذف الدليل').setStyle(ButtonStyle.Danger)
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  return;
}

// عند تأكيد حذف الدليل المحدد
if (interaction.isButton() && interaction.customId.startsWith('confirm_delete_evidence_url_')) {
  if (!hasPoliceAdminRole(interaction.member, interaction.guildId)) {
    await interaction.reply({ content: '❌ هذا الزر مخصص فقط لمسؤول الشرطة.', ephemeral: true });
    return;
  }
  const parts = interaction.customId.split('_');
  const userId = parts[4];
  const crimeId = parts[5];
  const evidenceIdx = parseInt(parts[6]);
  const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
  const c = identity && identity.crimes ? identity.crimes.find(cc => cc.id === crimeId) : null;
  if (!identity || !c || !Array.isArray(c.evidence) || c.evidence.length <= evidenceIdx) {
    await interaction.reply({ content: 'تعذر العثور على الدليل.', ephemeral: true });
    return;
  }
  const removedUrl = c.evidence.splice(evidenceIdx, 1)[0];
  saveAllData();
  // إرسال لوق في روم اللوق
  const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
  if (logChannelId) {
    try {
      const logChannel = interaction.guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('🗑️ حذف دليل')
          .setDescription(`**تم حذف دليل بواسطة:** <@${interaction.user.id}>\n**للمستخدم:** <@${identity.userId}>\n**العنوان:** ${c.title}\n**رابط الدليل المحذوف:** ${removedUrl}`)
          .setColor('#ff0000')
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] });
      }
    } catch (e) { /* تجاهل الخطأ */ }
  }
  await interaction.reply({ content: '✅ تم حذف الدليل بنجاح!', ephemeral: true });
  return;
}
    // عند الضغط على زر إضافة مخالفة في إدارة النظام
    if (interaction.isButton() && interaction.customId.startsWith('add_violation_')) {
      const userId = interaction.customId.replace('add_violation_', '');
      // قائمة 24 عنوان مخالفة مرورية
      const violationTitles = [
        'تجاوز السرعة المحددة',
        'قطع إشارة المرور',
        'الوقوف الخاطئ',
        'عدم ربط حزام الأمان',
        'استخدام الجوال أثناء القيادة',
        'قيادة بدون رخصة',
        'انتهاء استمارة السيارة',
        'عدم وجود تأمين',
        'التفحيط',
        'التجاوز الخاطئ',
        'عدم إعطاء الأفضلية',
        'القيادة عكس السير',
        'عدم استخدام الإشارات',
        'الضوضاء المفرطة',
        'تحميل ركاب زيادة',
        'عدم وجود لوحات',
        'تظليل غير نظامي',
        'عدم وجود طفاية حريق',
        'عدم وجود مثلث عاكس',
        'عدم وجود إسعافات أولية',
        'عدم صلاحية الإطارات',
        'عدم وجود إنارة كافية',
        'عدم وجود مرايا جانبية',
        'عدم وجود مساحات زجاج'
      ];
      // قائمة منسدلة
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_violation_title_${userId}`)
        .setPlaceholder('اختر عنوان المخالفة')
        .addOptions(
          violationTitles.map((title, idx) => ({ label: title, value: `violation_${idx}` }))
        );
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('إضافة مخالفة مرورية')
        .setDescription('اختر عنوان المخالفة المرورية من القائمة أدناه:')
        .setColor('#ff0000');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
    // عند اختيار عنوان المخالفة من القائمة المنسدلة
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_violation_title_')) {
      const userId = interaction.customId.replace('select_violation_title_', '');
      const idx = parseInt(interaction.values[0].replace('violation_', ''));
      // نفس العناوين
      const violationTitles = [
        'تجاوز السرعة المحددة',
        'قطع إشارة المرور',
        'الوقوف الخاطئ',
        'عدم ربط حزام الأمان',
        'استخدام الجوال أثناء القيادة',
        'قيادة بدون رخصة',
        'انتهاء استمارة السيارة',
        'عدم وجود تأمين',
        'التفحيط',
        'التجاوز الخاطئ',
        'عدم إعطاء الأفضلية',
        'القيادة عكس السير',
        'عدم استخدام الإشارات',
        'الضوضاء المفرطة',
        'تحميل ركاب زيادة',
        'عدم وجود لوحات',
        'تظليل غير نظامي',
        'عدم وجود طفاية حريق',
        'عدم وجود مثلث عاكس',
        'عدم وجود إسعافات أولية',
        'عدم صلاحية الإطارات',
        'عدم وجود إنارة كافية',
        'عدم وجود مرايا جانبية',
        'عدم وجود مساحات زجاج'
      ];
      const selectedTitle = violationTitles[idx] || 'مخالفة مرورية';
      // مودال وصف المخالفة
      const modal = new ModalBuilder()
        .setCustomId(`modal_violation_desc_${userId}_${idx}`)
        .setTitle('وصف المخالفة');
      const input = new TextInputBuilder()
        .setCustomId('input_violation_desc')
        .setLabel('وصف المخالفة')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('اكتب وصف المخالفة (أحرف فقط)')
        .setRequired(true)
        .setMaxLength(25);
      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }
    // عند حفظ مودال إضافة المخالفة
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_violation_desc_')) {
      console.log('تم استقبال مودال إضافة المخالفة:', interaction.customId);
      // استخراج userId وidx
      const parts = interaction.customId.split('_');
      const userId = parts[3];
      const idx = parseInt(parts[4]);
      // نفس عناوين المخالفات
      const violationTitles = [
        'تجاوز السرعة المحددة',
        'قطع إشارة المرور',
        'الوقوف الخاطئ',
        'عدم ربط حزام الأمان',
        'استخدام الجوال أثناء القيادة',
        'قيادة بدون رخصة',
        'انتهاء استمارة السيارة',
        'عدم وجود تأمين',
        'التفحيط',
        'التجاوز الخاطئ',
        'عدم إعطاء الأفضلية',
        'القيادة عكس السير',
        'عدم استخدام الإشارات',
        'الضوضاء المفرطة',
        'تحميل ركاب زيادة',
        'عدم وجود لوحات',
        'تظليل غير نظامي',
        'عدم وجود طفاية حريق',
        'عدم وجود مثلث عاكس',
        'عدم وجود إسعافات أولية',
        'عدم صلاحية الإطارات',
        'عدم وجود إنارة كافية',
        'عدم وجود مرايا جانبية',
        'عدم وجود مساحات زجاج'
      ];
      const selectedTitle = violationTitles[idx] || 'مخالفة مرورية';
      const desc = interaction.fields.getTextInputValue('input_violation_desc').trim();
      // أضف المخالفة إلى بيانات الشخص
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الشخص.', ephemeral: true });
        return;
      }
      if (!identity.violations) identity.violations = [];
      identity.violations.push({ id: Date.now().toString() + Math.random().toString().slice(2,8), name: selectedTitle, desc: desc, status: 'غير مسددة' });
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('📝 إضافة مخالفة')
              .setDescription(`**تمت إضافة مخالفة بواسطة:** <@${interaction.user.id}>\n**للمستخدم:** <@${identity.userId}>\n**العنوان:** ${selectedTitle}\n**الوصف:** ${desc}`)
              .setColor('#ff0000')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: `✅ تم إضافة المخالفة (${selectedTitle}) بنجاح!`, ephemeral: true });
      return;
    }
    // عند الضغط على زر تعديل مخالفة في إدارة النظام
if (interaction.isButton() && interaction.customId.startsWith('edit_violation_')) {
  if (!hasPoliceAdminRole(interaction.member, interaction.guildId)) {
    await interaction.reply({ content: '❌ هذا الزر مخصص فقط لمسؤول الشرطة.', ephemeral: true });
    return;
  }
  const userId = interaction.customId.replace('edit_violation_', '');
      const page = 1;
  const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
  if (!identity || !identity.violations || identity.violations.length === 0) {
    await interaction.reply({ content: 'لا توجد مخالفات لهذا الشخص.', ephemeral: true });
    return;
  }
  const pageSize = 23;
  const totalPages = Math.ceil(identity.violations.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageViolations = identity.violations.slice(start, end);
  const options = pageViolations.map((v, idx) => ({
    label: `${v.name} - ${v.desc || ''}`.slice(0, 90),
    value: `edit_violation_${v.id}_${userId}_${page}`
  }));
  if (totalPages > 1) {
    options.push({ label: 'رؤية المزيد', value: `edit_violation_more_${userId}_${page+1}` });
  }
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`edit_violation_select_${userId}_${page}`)
    .setPlaceholder('اختر مخالفة لتعديلها')
    .addOptions(options);
  const row = new ActionRowBuilder().addComponents(selectMenu);
  const embed = new EmbedBuilder()
    .setTitle('تعديل مخالفة')
    .setDescription('اختر مخالفة من القائمة أدناه لتعديلها')
    .setColor('#fbbf24');
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  return;
}
    // عند اختيار رؤية المزيد في قائمة تعديل المخالفة
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('edit_violation_select_') && interaction.values[0].startsWith('edit_violation_more_')) {
      const parts = interaction.values[0].split('_');
      const userId = parts[3];
      const page = parseInt(parts[4]);
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!identity || !identity.violations || identity.violations.length === 0) {
        await interaction.reply({ content: 'لا توجد مخالفات لهذا الشخص.', ephemeral: true });
        return;
      }
      const pageSize = 23;
      const totalPages = Math.ceil(identity.violations.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageViolations = identity.violations.slice(start, end);
      const options = pageViolations.map((v, idx) => ({
        label: `${v.name} - ${v.desc || ''}`.slice(0, 90),
        value: `edit_violation_${v.id}_${userId}_${page}`
      }));
      if (page < totalPages) {
        options.push({ label: 'رؤية المزيد', value: `edit_violation_more_${userId}_${page+1}` });
      }
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`edit_violation_select_${userId}_${page}`)
        .setPlaceholder('اختر مخالفة لتعديل حالتها')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('تعديل حالة مخالفة')
        .setDescription('اختر مخالفة من القائمة أدناه لتعديل حالتها (مسددة/غير مسددة)')
        .setColor('#fbbf24');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
    // عند اختيار مخالفة من القائمة المنسدلة
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('edit_violation_select_') && interaction.values[0].startsWith('edit_violation_')) {
      const parts = interaction.values[0].split('_');
      const violationId = parts[2];
      const userId = parts[3];
      const page = parseInt(parts[4]);
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      const idx = identity && identity.violations ? identity.violations.findIndex(v => v.id === violationId) : -1;
      if (!identity || !identity.violations || idx === -1) {
        await interaction.reply({ content: 'تعذر العثور على المخالفة.', ephemeral: true });
        return;
      }
      // أزرار مسددة/غير مسددة مع id
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`set_violation_status_${userId}_${violationId}_paid`).setLabel('مسددة').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`set_violation_status_${userId}_${violationId}_unpaid`).setLabel('غير مسددة').setStyle(ButtonStyle.Danger)
      );
      const embed = new EmbedBuilder()
        .setTitle('تعديل حالة المخالفة')
        .setDescription(`**العنوان:** ${identity.violations[idx].name}\n**الوصف:** ${identity.violations[idx].desc || ''}\n**الحالة الحالية:** ${identity.violations[idx].status}`)
        .setColor('#fbbf24');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
    // عند الضغط على زر مسددة/غير مسددة
    if (interaction.isButton() && interaction.customId.startsWith('set_violation_status_')) {
      const parts = interaction.customId.split('_');
      const userId = parts[3];
      const violationId = parts[4];
      const status = parts[5] === 'paid' ? 'مسددة' : 'غير مسددة';
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      console.log('جميع ids:', identity && identity.violations ? identity.violations.map(v => v.id) : []);
      console.log('violationId المطلوب:', violationId);
      const idx = identity && identity.violations ? identity.violations.findIndex(v => v.id === violationId) : -1;
      if (!identity || !identity.violations || idx === -1) {
        await interaction.reply({ content: 'تعذر العثور على المخالفة.', ephemeral: true });
        return;
      }
      identity.violations[idx].status = status;
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('✏️ تعديل حالة مخالفة')
              .setDescription(`**تم تعديل حالة مخالفة بواسطة:** <@${interaction.user.id}>\n**للمستخدم:** <@${identity.userId}>\n**العنوان:** ${identity.violations[idx].name}\n**الوصف:** ${identity.violations[idx].desc || ''}\n**الحالة الجديدة:** ${status}`)
              .setColor(status === 'مسددة' ? '#00ff00' : '#ff0000')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      // تحديث الرسالة مع تعطيل الأزرار
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`set_violation_status_${userId}_${violationId}_paid`).setLabel('مسددة').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId(`set_violation_status_${userId}_${violationId}_unpaid`).setLabel('غير مسددة').setStyle(ButtonStyle.Danger).setDisabled(true)
      );
          const embed = new EmbedBuilder()
        .setTitle('تعديل حالة المخالفة')
        .setDescription(`**العنوان:** ${identity.violations[idx].name}\n**الوصف:** ${identity.violations[idx].desc || ''}\n**الحالة الجديدة:** ${status}`)
        .setColor(status === 'مسددة' ? '#00ff00' : '#ff0000');
      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }
    // عند الضغط على زر إضافة جريمة في إدارة النظام
    if (interaction.isButton() && interaction.customId.startsWith('add_crime_')) {
      const userId = interaction.customId.replace('add_crime_', '');
      // قائمة 24 عنوان جريمة جنائية
      const crimeTitles = [
        'القتل العمد',
        'السرقة المسلحة',
        'السطو المسلح',
        'الخطف',
        'الاتجار بالمخدرات',
        'حيازة سلاح غير مرخص',
        'الاعتداء الجسدي',
        'التهديد بالقتل',
        'الاحتيال المالي',
        'الرشوة',
        'التزوير',
        'الهروب من العدالة',
        'إطلاق نار في الأماكن العامة',
        'تخريب الممتلكات العامة',
        'التحرش الجنسي',
        'الابتزاز',
        'التحريض على العنف',
        'غسيل الأموال',
        'التهريب',
        'الاعتداء على موظف حكومي',
        'إعاقة عمل الشرطة',
        'إخفاء أدلة',
        'الفرار من موقع الحادث',
        'التجمع غير القانوني'
      ];
      // قائمة منسدلة
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_crime_title_${userId}`)
        .setPlaceholder('اختر عنوان الجريمة')
        .addOptions(
          crimeTitles.map((title, idx) => ({ label: title, value: `crime_${idx}` }))
        );
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('إضافة جريمة جنائية')
        .setDescription('اختر عنوان الجريمة الجنائية من القائمة أدناه:')
        .setColor('#ff0000');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
    // عند اختيار عنوان الجريمة من القائمة المنسدلة
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_crime_title_')) {
      const userId = interaction.customId.replace('select_crime_title_', '');
      const idx = parseInt(interaction.values[0].replace('crime_', ''));
      // نفس عناوين الجرائم
      const crimeTitles = [
        'القتل العمد',
        'السرقة المسلحة',
        'السطو المسلح',
        'الخطف',
        'الاتجار بالمخدرات',
        'حيازة سلاح غير مرخص',
        'الاعتداء الجسدي',
        'التهديد بالقتل',
        'الاحتيال المالي',
        'الرشوة',
        'التزوير',
        'الهروب من العدالة',
        'إطلاق نار في الأماكن العامة',
        'تخريب الممتلكات العامة',
        'التحرش الجنسي',
        'الابتزاز',
        'التحريض على العنف',
        'غسيل الأموال',
        'التهريب',
        'الاعتداء على موظف حكومي',
        'إعاقة عمل الشرطة',
        'إخفاء أدلة',
        'الفرار من موقع الحادث',
        'التجمع غير القانوني'
      ];
      const selectedTitle = crimeTitles[idx] || 'جريمة جنائية';
      // مودال وصف الجريمة
      const modal = new ModalBuilder()
        .setCustomId(`modal_crime_desc_${userId}_${idx}`)
        .setTitle('وصف الجريمة');
      const input = new TextInputBuilder()
        .setCustomId('input_crime_desc')
        .setLabel('وصف الجريمة')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('اكتب وصف الجريمة (أحرف فقط)')
        .setRequired(true)
        .setMaxLength(30);
      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }
    // عند حفظ مودال إضافة الجريمة
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_crime_desc_')) {
      // استخراج userId وidx
      const parts = interaction.customId.split('_');
      const userId = parts[3];
      const idx = parseInt(parts[4]);
      // نفس عناوين الجرائم
      const crimeTitles = [
        'القتل العمد',
        'السرقة المسلحة',
        'السطو المسلح',
        'الخطف',
        'الاتجار بالمخدرات',
        'حيازة سلاح غير مرخص',
        'الاعتداء الجسدي',
        'التهديد بالقتل',
        'الاحتيال المالي',
        'الرشوة',
        'التزوير',
        'الهروب من العدالة',
        'إطلاق نار في الأماكن العامة',
        'تخريب الممتلكات العامة',
        'التحرش الجنسي',
        'الابتزاز',
        'التحريض على العنف',
        'غسيل الأموال',
        'التهريب',
        'الاعتداء على موظف حكومي',
        'إعاقة عمل الشرطة',
        'إخفاء أدلة',
        'الفرار من موقع الحادث',
        'التجمع غير القانوني'
      ];
      const selectedTitle = crimeTitles[idx] || 'جريمة جنائية';
      const desc = interaction.fields.getTextInputValue('input_crime_desc').trim();
      // أضف الجريمة إلى بيانات الشخص
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الشخص.', ephemeral: true });
        return;
      }
      if (!identity.crimes) identity.crimes = [];
      identity.crimes.push({ id: Date.now().toString() + Math.random().toString().slice(2,8), title: selectedTitle, desc: desc, done: false });
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('📝 إضافة جريمة')
              .setDescription(`**تمت إضافة جريمة بواسطة:** <@${interaction.user.id}>\n**للمستخدم:** <@${identity.userId}>\n**العنوان:** ${selectedTitle}\n**الوصف:** ${desc}`)
            .setColor('#ff0000')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: `✅ تم إضافة الجريمة (${selectedTitle}) بنجاح!`, ephemeral: true });
          return;
        }
    // عند الضغط على زر إضافة جريمة في إدارة النظام
    if (interaction.isButton() && interaction.customId.startsWith('add_crime_')) {
      const userId = interaction.customId.replace('add_crime_', '');
      // قائمة 24 عنوان جريمة جنائية
      const crimeTitles = [
        'القتل العمد',
        'السرقة المسلحة',
        'السطو المسلح',
        'الخطف',
        'الاتجار بالمخدرات',
        'حيازة سلاح غير مرخص',
        'الاعتداء الجسدي',
        'التهديد بالقتل',
        'الاحتيال المالي',
        'الرشوة',
        'التزوير',
        'الهروب من العدالة',
        'إطلاق نار في الأماكن العامة',
        'تخريب الممتلكات العامة',
        'التحرش الجنسي',
        'الابتزاز',
        'التحريض على العنف',
        'غسيل الأموال',
        'التهريب',
        'الاعتداء على موظف حكومي',
        'إعاقة عمل الشرطة',
        'إخفاء أدلة',
        'الفرار من موقع الحادث',
        'التجمع غير القانوني'
      ];
      // قائمة منسدلة
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_crime_title_${userId}`)
        .setPlaceholder('اختر عنوان الجريمة')
        .addOptions(
          crimeTitles.map((title, idx) => ({ label: title, value: `crime_${idx}` }))
        );
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('إضافة جريمة جنائية')
        .setDescription('اختر عنوان الجريمة الجنائية من القائمة أدناه:')
        .setColor('#ff0000');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
    // عند اختيار عنوان الجريمة من القائمة المنسدلة
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_crime_title_')) {
      const userId = interaction.customId.replace('select_crime_title_', '');
      const idx = parseInt(interaction.values[0].replace('crime_', ''));
      // نفس عناوين الجرائم
      const crimeTitles = [
        'القتل العمد',
        'السرقة المسلحة',
        'السطو المسلح',
        'الخطف',
        'الاتجار بالمخدرات',
        'حيازة سلاح غير مرخص',
        'الاعتداء الجسدي',
        'التهديد بالقتل',
        'الاحتيال المالي',
        'الرشوة',
        'التزوير',
        'الهروب من العدالة',
        'إطلاق نار في الأماكن العامة',
        'تخريب الممتلكات العامة',
        'التحرش الجنسي',
        'الابتزاز',
        'التحريض على العنف',
        'غسيل الأموال',
        'التهريب',
        'الاعتداء على موظف حكومي',
        'إعاقة عمل الشرطة',
        'إخفاء أدلة',
        'الفرار من موقع الحادث',
        'التجمع غير القانوني'
      ];
      const selectedTitle = crimeTitles[idx] || 'جريمة جنائية';
      // مودال وصف الجريمة
      const modal = new ModalBuilder()
        .setCustomId(`modal_crime_desc_${userId}_${idx}`)
        .setTitle('وصف الجريمة');
      const input = new TextInputBuilder()
        .setCustomId('input_crime_desc')
        .setLabel('وصف الجريمة')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('اكتب وصف الجريمة (أحرف فقط)')
        .setRequired(true)
        .setMaxLength(30);
      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }
    // عند حفظ مودال إضافة الجريمة
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_crime_desc_')) {
      // استخراج userId وidx
      const parts = interaction.customId.split('_');
      const userId = parts[3];
      const idx = parseInt(parts[4]);
      // نفس عناوين الجرائم
      const crimeTitles = [
        'القتل العمد',
        'السرقة المسلحة',
        'السطو المسلح',
        'الخطف',
        'الاتجار بالمخدرات',
        'حيازة سلاح غير مرخص',
        'الاعتداء الجسدي',
        'التهديد بالقتل',
        'الاحتيال المالي',
        'الرشوة',
        'التزوير',
        'الهروب من العدالة',
        'إطلاق نار في الأماكن العامة',
        'تخريب الممتلكات العامة',
        'التحرش الجنسي',
        'الابتزاز',
        'التحريض على العنف',
        'غسيل الأموال',
        'التهريب',
        'الاعتداء على موظف حكومي',
        'إعاقة عمل الشرطة',
        'إخفاء أدلة',
        'الفرار من موقع الحادث',
        'التجمع غير القانوني'
      ];
      const selectedTitle = crimeTitles[idx] || 'جريمة جنائية';
      const desc = interaction.fields.getTextInputValue('input_crime_desc').trim();
      // أضف الجريمة إلى بيانات الشخص
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الشخص.', ephemeral: true });
        return;
      }
      if (!identity.crimes) identity.crimes = [];
      identity.crimes.push({ id: Date.now().toString() + Math.random().toString().slice(2,8), title: selectedTitle, desc: desc, done: false });
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('📝 إضافة جريمة')
              .setDescription(`**تمت إضافة جريمة بواسطة:** <@${interaction.user.id}>\n**للمستخدم:** <@${identity.userId}>\n**العنوان:** ${selectedTitle}\n**الوصف:** ${desc}`)
              .setColor('#ff0000')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: `✅ تم إضافة الجريمة (${selectedTitle}) بنجاح!`, ephemeral: true });
      return;
    }
    // عند الضغط على زر إضافة مخالفة في إدارة النظام
    if (interaction.isButton() && interaction.customId.startsWith('add_violation_')) {
      const userId = interaction.customId.replace('add_violation_', '');
      // قائمة 24 عنوان مخالفة مرورية
      const violationTitles = [
        'تجاوز السرعة المحددة',
        'قطع إشارة المرور',
        'الوقوف الخاطئ',
        'عدم ربط حزام الأمان',
        'استخدام الجوال أثناء القيادة',
        'قيادة بدون رخصة',
        'انتهاء استمارة السيارة',
        'عدم وجود تأمين',
        'التفحيط',
        'التجاوز الخاطئ',
        'عدم إعطاء الأفضلية',
        'القيادة عكس السير',
        'عدم استخدام الإشارات',
        'الضوضاء المفرطة',
        'تحميل ركاب زيادة',
        'عدم وجود لوحات',
        'تظليل غير نظامي',
        'عدم وجود طفاية حريق',
        'عدم وجود مثلث عاكس',
        'عدم وجود إسعافات أولية',
        'عدم صلاحية الإطارات',
        'عدم وجود إنارة كافية',
        'عدم وجود مرايا جانبية',
        'عدم وجود مساحات زجاج'
      ];
      // قائمة منسدلة
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_violation_title_${userId}`)
        .setPlaceholder('اختر عنوان المخالفة')
        .addOptions(
          violationTitles.map((title, idx) => ({ label: title, value: `violation_${idx}` }))
        );
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('إضافة مخالفة مرورية')
        .setDescription('اختر عنوان المخالفة المرورية من القائمة أدناه:')
        .setColor('#ff0000');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
    // عند اختيار إيقاف | تشغيل البوت من قائمة المطور
    if (interaction.isStringSelectMenu() && interaction.customId === 'dev_menu' && interaction.values[0] === 'toggle_bot_status') {
      // تحقق من أن المستخدم مطور مصرح له
      if (!isDeveloper(interaction.user.id)) {
        await interaction.reply({ 
          content: '❌ هذا الأمر مخصص فقط للمطورين المصرح لهم.', 
          ephemeral: true 
        });
        return;
      }
      // جلب جميع السيرفرات التي يوجد فيها البوت
      const guilds = client.guilds.cache.map(g => g);
      const page = 1;
      const pageSize = 23;
      const totalPages = Math.ceil(guilds.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageGuilds = guilds.slice(start, end);
      
      // بناء الخيارات للقائمة المنسدلة
      const options = pageGuilds.map(guild => ({
        label: guild.name.slice(0, 90),
        value: `toggle_bot_guild_${guild.id}_1`
      }));
      
      if (totalPages > 1) {
        options.push({ label: 'رؤية المزيد', value: `toggle_bot_guilds_more_${page + 1}` });
      }
      
      const guildsMenu = new StringSelectMenuBuilder()
        .setCustomId('toggle_bot_guilds_menu_1')
        .setPlaceholder('اختر سيرفر...')
        .addOptions(options);
      
      const row = new ActionRowBuilder().addComponents(guildsMenu);
      
      const embed = new EmbedBuilder()
        .setTitle('إيقاف | تشغيل البوت')
        .setDescription('اختر سيرفر لإيقاف أو تشغيل البوت فيه.')
        .setColor('#00ff00');
      
      const components = addResetButton([row]);
      try {
        await interaction.reply({ embeds: [embed], components: components, ephemeral: true });
      } catch (error) {
        if (error.code === 10062) {
          // التفاعل انتهت صلاحيته، إرسال رسالة جديدة
          await interaction.followUp({ 
            content: '✅ تم فتح قائمة السيرفرات بنجاح!', 
            ephemeral: true 
          });
        } else {
          console.error('خطأ في إرسال التفاعل:', error);
        }
      }
      return;
    }

    // عند اختيار سيرفر لإيقاف | تشغيل البوت
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('toggle_bot_guilds_menu_') && interaction.values[0].startsWith('toggle_bot_guild_')) {
      const guildId = interaction.values[0].replace('toggle_bot_guild_', '').split('_')[0];
      const guild = client.guilds.cache.get(guildId);
      
      if (!guild) {
        await interaction.reply({ content: '❌ لم يتم العثور على السيرفر.', ephemeral: true });
        return;
      }
      
      // جلب معلومات السيرفر
      const memberCount = guild.memberCount;
      const owner = await guild.fetchOwner().catch(() => null);
      const invite = await guild.invites.fetch().then(invites => invites.first()?.url).catch(() => null);
      const botStatus = getBotStatus();
      
      const embed = new EmbedBuilder()
        .setTitle(`معلومات السيرفر: ${guild.name}`)
        .setDescription(`معلومات مفصلة عن السيرفر وحالة البوت`)
        .setColor('#00ff00')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
          { name: 'الاونر', value: owner ? `<@${owner.id}>` : 'غير متوفر', inline: true },
          { name: 'عدد الأعضاء', value: `${memberCount}`, inline: true },
          { name: 'ايدي السيرفر', value: guild.id, inline: true },
          { name: 'حالة البوت', value: `${botStatus === 'online' ? '🟢 متصل' : '🔴 غير متصل'}`, inline: true },
          { name: 'رابط السيرفر', value: invite || 'لا يوجد دعوة متاحة', inline: false }
        );
      
      // زر إيقاف/تشغيل البوت
      const toggleButton = new ButtonBuilder()
        .setCustomId(`toggle_bot_status_${guildId}`)
        .setLabel(botStatus === 'online' ? 'إيقاف البوت' : 'تشغيل البوت')
        .setStyle(botStatus === 'online' ? ButtonStyle.Danger : ButtonStyle.Success);
      
      const row = new ActionRowBuilder().addComponents(toggleButton);
      const components = addResetButton([row]);
      
      try {
        await interaction.reply({ embeds: [embed], components: components, ephemeral: true });
      } catch (error) {
        if (error.code === 10062) {
          // التفاعل انتهت صلاحيته، إرسال رسالة جديدة
          await interaction.followUp({ 
            content: '✅ تم فتح معلومات السيرفر بنجاح!', 
            ephemeral: true 
          });
        } else {
          console.error('خطأ في إرسال التفاعل:', error);
        }
      }
      return;
    }

    // معالجة الصفحات لقائمة إيقاف | تشغيل البوت
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('toggle_bot_guilds_menu_') && interaction.values[0].startsWith('toggle_bot_guilds_more_')) {
      const page = parseInt(interaction.values[0].replace('toggle_bot_guilds_more_', ''));
      const guilds = client.guilds.cache.map(g => g);
      const pageSize = 23;
      const totalPages = Math.ceil(guilds.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageGuilds = guilds.slice(start, end);
      
      const options = pageGuilds.map(guild => ({
        label: guild.name.slice(0, 90),
        value: `toggle_bot_guild_${guild.id}_${page}`
      }));
      
      if (page < totalPages) {
        options.push({ label: 'رؤية المزيد', value: `toggle_bot_guilds_more_${page + 1}` });
      }
      
      const guildsMenu = new StringSelectMenuBuilder()
        .setCustomId(`toggle_bot_guilds_menu_${page}`)
        .setPlaceholder('اختر سيرفر...')
        .addOptions(options);
      
      const row = new ActionRowBuilder().addComponents(guildsMenu);
      
      const embed = new EmbedBuilder()
        .setTitle('إيقاف | تشغيل البوت')
        .setDescription(`اختر سيرفر لإيقاف أو تشغيل البوت فيه. (صفحة ${page})`)
        .setColor('#00ff00');
      
      const components = addResetButton([row]);
      await interaction.update({ embeds: [embed], components: components });
      return;
    }

    // عند اختيار تغيير ايمبيد من قائمة المطور
    if (interaction.isStringSelectMenu() && interaction.customId === 'dev_menu' && interaction.values[0] === 'change_embed') {
      // تحقق من أن المستخدم مطور مصرح له
      if (!isDeveloper(interaction.user.id)) {
        await interaction.reply({ 
          content: '❌ هذا الأمر مخصص فقط للمطورين المصرح لهم.', 
          ephemeral: true 
        });
        return;
      }
      // جلب جميع السيرفرات التي يوجد فيها البوت
      const guilds = client.guilds.cache.map(g => g);
      const page = 1;
      const pageSize = 23;
      const totalPages = Math.ceil(guilds.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageGuilds = guilds.slice(start, end);
      // بناء الخيارات للقائمة المنسدلة
      const options = pageGuilds.map(guild => ({
        label: guild.name.slice(0, 90),
        value: `dev_select_guild_${guild.id}_1`
      }));
      if (totalPages > 1) {
        options.push({ label: 'رؤية المزيد', value: `dev_guilds_more_${page + 1}` });
      }
      const guildsMenu = new StringSelectMenuBuilder()
        .setCustomId('dev_guilds_menu_1')
        .setPlaceholder('اختر سيرفر...')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(guildsMenu);
      const embed = new EmbedBuilder()
        .setTitle('قائمة السيرفرات')
        .setDescription('اختر سيرفر لتغيير صورة الإيمبيد الخاصة به.')
        .setColor('#00ff00');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
    // عند الضغط على زر إضافة الأدلة
    if (interaction.isButton() && interaction.customId.startsWith('add_evidence_')) {
      const userId = interaction.customId.replace('add_evidence_', '');
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!identity || !identity.crimes || identity.crimes.length === 0) {
        await interaction.reply({ content: 'لا توجد جرائم لهذا الشخص.', ephemeral: true });
        return;
      }
      const page = 1;
      const pageSize = 23;
      const totalPages = Math.ceil(identity.crimes.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageCrimes = identity.crimes.slice(start, end);
      const options = pageCrimes.map((c, idx) => ({
        label: `${c.title} - ${c.desc || ''}`.slice(0, 90),
        value: `add_evidence_crime_${c.id}_${userId}_${page}`
      }));
      if (totalPages > 1) {
        options.push({ label: 'رؤية المزيد', value: `add_evidence_more_${userId}_${page+1}` });
      }
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`add_evidence_select_${userId}_${page}`)
        .setPlaceholder('اختر جريمة لإضافة دليل')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('إضافة دليل لجريمة')
        .setDescription('اختر جريمة من القائمة أدناه لإضافة دليل لها')
        .setColor('#00ff00');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // صفحات إضافة الأدلة
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('add_evidence_select_') && interaction.values[0].startsWith('add_evidence_more_')) {
      const parts = interaction.values[0].split('_');
      const userId = parts[3];
      const page = parseInt(parts[4]);
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!identity || !identity.crimes || identity.crimes.length === 0) {
        await interaction.reply({ content: 'لا توجد جرائم لهذا الشخص.', ephemeral: true });
        return;
      }
      const pageSize = 23;
      const totalPages = Math.ceil(identity.crimes.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageCrimes = identity.crimes.slice(start, end);
      const options = pageCrimes.map((c, idx) => ({
        label: `${c.title} - ${c.desc || ''}`.slice(0, 90),
        value: `add_evidence_crime_${c.id}_${userId}_${page}`
      }));
      if (page < totalPages) {
        options.push({ label: 'رؤية المزيد', value: `add_evidence_more_${userId}_${page+1}` });
      }
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`add_evidence_select_${userId}_${page}`)
        .setPlaceholder('اختر جريمة لإضافة دليل')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('إضافة دليل لجريمة')
        .setDescription('اختر جريمة من القائمة أدناه لإضافة دليل لها')
        .setColor('#00ff00');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // عند اختيار جريمة لإضافة دليل
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('add_evidence_select_') && interaction.values[0].startsWith('add_evidence_crime_')) {
      const parts = interaction.values[0].split('_');
      const crimeId = parts[3];
      const userId = parts[4];
      // مودال لإدخال رابط صورة الدليل
      const modal = new ModalBuilder()
        .setCustomId(`modal_add_evidence_${userId}_${crimeId}`)
        .setTitle('إضافة دليل للجريمة');
      const input = new TextInputBuilder()
        .setCustomId('input_evidence_url')
        .setLabel('رابط صورة الدليل')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ضع هنا رابط صورة الدليل (jpg/png/gif/webp)')
        .setRequired(true)
        .setMaxLength(300);
      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }

    // عند حفظ مودال إضافة الدليل
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_add_evidence_')) {
      const parts = interaction.customId.split('_');
      const userId = parts[3];
      const crimeId = parts[4];
      const url = interaction.fields.getTextInputValue('input_evidence_url').trim();
      // تحقق من صحة الرابط
      if (!/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(url)) {
        await interaction.reply({ content: '❌ الرابط المدخل ليس صورة صالحة (يجب أن ينتهي بـ jpg/png/gif/webp)', ephemeral: true });
        return;
      }
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      const idx = identity && identity.crimes ? identity.crimes.findIndex(c => c.id === crimeId) : -1;
      if (!identity || !identity.crimes || idx === -1) {
        await interaction.reply({ content: 'تعذر العثور على الجريمة.', ephemeral: true });
        return;
      }
      if (!identity.crimes[idx].evidence) identity.crimes[idx].evidence = [];
      identity.crimes[idx].evidence.push(url);
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('📎 إضافة دليل لجريمة')
              .setDescription(`**تمت إضافة دليل بواسطة:** <@${interaction.user.id}>\n**للمستخدم:** <@${identity.userId}>\n**العنوان:** ${identity.crimes[idx].title}\n**رابط الدليل:** ${url}`)
              .setColor('#00ff00')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      await interaction.reply({ content: '✅ تم إضافة الدليل بنجاح!', ephemeral: true });
      return;
    }

    // منطق زر رؤية التفاصيل
    if (interaction.isButton() && interaction.customId.startsWith('view_evidence_details_')) {
      const userId = interaction.customId.replace('view_evidence_details_', '');
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!identity || !identity.crimes) {
        await interaction.reply({ content: 'لا توجد جرائم لهذا الشخص.', ephemeral: true });
        return;
      }
      // فقط الجرائم التي تحتوي على أدلة
      const crimesWithEvidence = identity.crimes.filter(c => Array.isArray(c.evidence) && c.evidence.length > 0);
      if (crimesWithEvidence.length === 0) {
        await interaction.reply({ content: 'لا توجد جرائم تحتوي على أدلة.', ephemeral: true });
        return;
      }
      const page = 1;
      const pageSize = 23;
      const totalPages = Math.ceil(crimesWithEvidence.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageCrimes = crimesWithEvidence.slice(start, end);
      const options = pageCrimes.map((c, idx) => ({
        label: `${c.title} - ${c.desc || ''}`.slice(0, 90),
        value: `view_evidence_crime_${c.id}_${userId}_${page}`
      }));
      if (totalPages > 1) {
        options.push({ label: 'رؤية المزيد', value: `view_evidence_more_${userId}_${page+1}` });
      }
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`view_evidence_select_${userId}_${page}`)
        .setPlaceholder('اختر جريمة لرؤية تفاصيلها')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('رؤية تفاصيل الأدلة')
        .setDescription('اختر جريمة من القائمة أدناه لرؤية تفاصيلها مع الأدلة')
        .setColor('#00ff00');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // صفحات رؤية التفاصيل
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('view_evidence_select_') && interaction.values[0].startsWith('view_evidence_more_')) {
      const parts = interaction.values[0].split('_');
      const userId = parts[3];
      const page = parseInt(parts[4]);
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      if (!identity || !identity.crimes) {
        await interaction.reply({ content: 'لا توجد جرائم لهذا الشخص.', ephemeral: true });
        return;
      }
      const crimesWithEvidence = identity.crimes.filter(c => Array.isArray(c.evidence) && c.evidence.length > 0);
      if (crimesWithEvidence.length === 0) {
        await interaction.reply({ content: 'لا توجد جرائم تحتوي على أدلة.', ephemeral: true });
        return;
      }
      const pageSize = 23;
      const totalPages = Math.ceil(crimesWithEvidence.length / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const pageCrimes = crimesWithEvidence.slice(start, end);
      const options = pageCrimes.map((c, idx) => ({
        label: `${c.title} - ${c.desc || ''}`.slice(0, 90),
        value: `view_evidence_crime_${c.id}_${userId}_${page}`
      }));
      if (page < totalPages) {
        options.push({ label: 'رؤية المزيد', value: `view_evidence_more_${userId}_${page+1}` });
      }
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`view_evidence_select_${userId}_${page}`)
        .setPlaceholder('اختر جريمة لرؤية تفاصيلها')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(selectMenu);
      const embed = new EmbedBuilder()
        .setTitle('رؤية تفاصيل الأدلة')
        .setDescription('اختر جريمة من القائمة أدناه لرؤية تفاصيلها مع الأدلة')
        .setColor('#00ff00');
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // عند اختيار جريمة لرؤية تفاصيلها
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('view_evidence_select_') && interaction.values[0].startsWith('view_evidence_crime_')) {
      const parts = interaction.values[0].split('_');
      const crimeId = parts[3];
      const userId = parts[4];
      const identity = identities.find(i => i.userId === userId && i.guildId === interaction.guildId);
      const c = identity && identity.crimes ? identity.crimes.find(cc => cc.id === crimeId) : null;
      if (!identity || !c || !Array.isArray(c.evidence) || c.evidence.length === 0) {
        await interaction.reply({ content: 'تعذر العثور على الجريمة أو لا يوجد أدلة.', ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('تفاصيل الجريمة مع الأدلة')
        .setDescription(`**العنوان:** ${c.title}\n**الوصف:** ${c.desc || ''}\n**الحالة:** ${c.done ? 'منفذة' : 'غير منفذة'}`)
        .setColor('#00ff00');
      // أضف أول صورة كصورة للإيمبيد
      if (c.evidence[0]) embed.setImage(c.evidence[0]);
      // أضف قائمة روابط الأدلة في الحقول
      embed.addFields({ name: 'روابط الأدلة', value: c.evidence.map((url, i) => `[دليل ${i+1}](${url})`).join('\n') });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // عند حفظ التعديل (مودال تعديل الهوية)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('edit_identity_modal_')) {
      const userId = interaction.customId.replace('edit_identity_modal_', '');
      const fullName = interaction.fields.getTextInputValue(`edit_full_name_${userId}`);
      const identity = identities.find(i => i.userId === userId);
      if (!identity) {
        await interaction.reply({ content: '❌ لم يتم العثور على الهوية.', ephemeral: true });
        return;
      }
      const oldName = identity.fullName;
      identity.fullName = fullName;
      saveAllData();
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[interaction.guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('✏️ تم تعديل هوية')
              .setDescription(`**تم تعديل هوية المستخدم:** <@${identity.userId}>
**الاسم السابق:** ${oldName}
**الاسم الجديد:** ${identity.fullName}

**تم التعديل من قبل:** <@${interaction.user.id}>`)
              .setColor('#fbbf24')
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
    }

    // عند اختيار 'رؤية المزيد' في قائمة السيرفرات
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('dev_guilds_menu_') && interaction.values[0].startsWith('dev_guilds_more_')) {
      const nextPage = parseInt(interaction.values[0].split('_').pop());
      const guilds = client.guilds.cache.map(g => g);
      const pageSize = 23;
      const totalPages = Math.ceil(guilds.length / pageSize);
      const start = (nextPage - 1) * pageSize;
      const end = start + pageSize;
      const pageGuilds = guilds.slice(start, end);
      const options = pageGuilds.map(guild => ({
        label: guild.name.slice(0, 90),
        value: `dev_select_guild_${guild.id}_${nextPage}`
      }));
      if (nextPage < totalPages) {
        options.push({ label: 'رؤية المزيد', value: `dev_guilds_more_${nextPage + 1}` });
      }
      const guildsMenu = new StringSelectMenuBuilder()
        .setCustomId(`dev_guilds_menu_${nextPage}`)
        .setPlaceholder('اختر سيرفر...')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(guildsMenu);
      const embed = new EmbedBuilder()
        .setTitle('قائمة السيرفرات')
        .setDescription('اختر سيرفر لتغيير صورة الإيمبيد الخاصة به.')
        .setColor('#00ff00');
      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }

    // عند اختيار سيرفر من القائمة
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('dev_guilds_menu_') && interaction.values[0].startsWith('dev_select_guild_')) {
      const parts = interaction.values[0].split('_');
      const guildId = parts[3];
      const page = parts[4];
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        await interaction.update({ content: 'تعذر العثور على السيرفر.', components: [], embeds: [] });
        return;
      }
      try {
        // جلب معلومات السيرفر
        const owner = await guild.fetchOwner().catch(() => null);
        const memberCount = guild.memberCount;
        const botStatus = guild.members.me ? (guild.members.me.presence ? guild.members.me.presence.status : 'غير معروف') : 'غير معروف';
        const iconURL = guild.iconURL({ dynamic: true, size: 256 }) || undefined;
        let invite = null;
        try {
          invite = await guild.invites.fetch().then(invites => invites.first()?.url).catch(() => null);
        } catch { invite = null; }
        // بناء الإيمبيد
        const embed = new EmbedBuilder()
          .setTitle(`معلومات السيرفر: ${guild.name}`)
          .setColor('#00ff00');
        if (iconURL) {
          embed.setThumbnail(iconURL).setImage(iconURL);
        }
        embed.addFields(
          { name: 'الاونر', value: owner ? `<@${owner.id}>` : 'غير متوفر', inline: true },
          { name: 'عدد الأعضاء', value: `${memberCount}`, inline: true },
          { name: 'ايدي السيرفر', value: guild.id, inline: true },
          { name: 'حالة البوت', value: `${getBotStatus() === 'online' ? '🟢 متصل' : '🔴 غير متصل'}`, inline: true },
          { name: 'رابط السيرفر', value: invite || 'لا يوجد دعوة متاحة', inline: false }
        );
        // زر تغيير ايمبيد وزر إعادة تعيين الايمبيد
        const changeEmbedBtn = new ButtonBuilder()
          .setCustomId(`dev_change_embed_${guild.id}`)
          .setLabel('تغيير ايمبيد')
          .setStyle(ButtonStyle.Primary);
        const resetEmbedBtn = new ButtonBuilder()
          .setCustomId(`dev_reset_embed_${guild.id}`)
          .setLabel('إعادة تعيين الايمبيد')
          .setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder().addComponents(changeEmbedBtn, resetEmbedBtn);
        await interaction.update({ embeds: [embed], components: [row] });
      } catch (err) {
        console.error('Dev Guild Info Error:', err);
        await interaction.update({ content: `حدث خطأ غير متوقع أثناء جلب معلومات السيرفر: ${err.message || err}`, components: [], embeds: [] });
      }
      return;
    }

    // عند الضغط على زر تغيير ايمبيد في معلومات السيرفر
    if (interaction.isButton() && interaction.customId.startsWith('dev_change_embed_')) {
      const guildId = interaction.customId.replace('dev_change_embed_', '');
      // مودال لإدخال رابط صورة الايمبيد
      const modal = new ModalBuilder()
        .setCustomId(`dev_modal_embed_url_${guildId}`)
        .setTitle('تغيير صورة الايمبيد');
      const input = new TextInputBuilder()
        .setCustomId('input_embed_url')
        .setLabel('رابط صورة الايمبيد')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ضع هنا رابط صورة الايمبيد (jpg/png/gif/webp)')
        .setRequired(true)
        .setMaxLength(300);
      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }

    // عند حفظ مودال تغيير صورة الايمبيد
    if (interaction.isModalSubmit() && interaction.customId.startsWith('dev_modal_embed_url_')) {
      const guildId = interaction.customId.replace('dev_modal_embed_url_', '');
      const url = interaction.fields.getTextInputValue('input_embed_url').trim();
      // تحقق من صحة الرابط
      if (!/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(url)) {
        await interaction.reply({ content: '❌ الرابط المدخل ليس صورة صالحة (يجب أن ينتهي بـ jpg/png/gif/webp)', ephemeral: true });
        return;
      }
      // حفظ الرابط في إعدادات السيرفر
      if (!guildSettings[guildId]) guildSettings[guildId] = {};
      guildSettings[guildId].customEmbedImage = url;
      saveGuildSettings();
      await interaction.reply({ content: '✅ تم تغيير صورة الايمبيد بنجاح لجميع أوامر السيرفر!', ephemeral: true });
      return;
    }

    // معالجة أمر /المطور
    if (interaction.isChatInputCommand() && interaction.commandName === 'المطور') {
      // تحقق من أن المستخدم مطور مصرح له
      if (!isDeveloper(interaction.user.id)) {
        await interaction.reply({ 
          content: '❌ هذا الأمر مخصص فقط للمطورين المصرح لهم.', 
          ephemeral: true 
        });
        return;
      }
      const customImage = guildSettings[interaction.guildId]?.customEmbedImage || 'https://media.discordapp.net/attachments/1388450262628176034/1396257833506443375/image.png?ex=687d6df0&is=687c1c70&hm=111158be2d0bb467417eff40ae5788bd1200cb333942e37dbe281653754dd614&=&format=webp&quality=lossless';
      const embed = new EmbedBuilder()
        .setTitle('بطاقة الهوية')
        .setDescription('اضغط على القائمة أدناه لاختيار إجراء المطور.')
        .setImage(customImage)
        .setColor('#00ff00');
      // قائمة منسدلة بخيار تغيير ايمبيد
      const menuOptions = [
        { label: 'تغيير ايمبيد', value: 'change_embed' },
        { label: 'إيقاف | تشغيل البوت', value: 'toggle_bot_status' }
      ];
      const devMenu = new StringSelectMenuBuilder()
        .setCustomId('dev_menu')
        .setPlaceholder('اختر إجراء...')
        .addOptions(addResetOption(menuOptions));
      const row = new ActionRowBuilder().addComponents(devMenu);
      try {
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (error) {
        if (error.code === 10062) {
          // التفاعل انتهت صلاحيته، إرسال رسالة جديدة
          await interaction.followUp({ 
            content: '✅ تم فتح قائمة المطور بنجاح!', 
            ephemeral: true 
          });
        } else {
          console.error('خطأ في إرسال التفاعل:', error);
        }
      }
      return;
    }
    // عند الضغط على زر إيقاف | تشغيل البوت من معلومات السيرفر
    if (interaction.isButton() && interaction.customId.startsWith('toggle_bot_status_')) {
      // تحقق من أن المستخدم مطور مصرح له
      if (!isDeveloper(interaction.user.id)) {
        await interaction.reply({ 
          content: '❌ هذا الأمر مخصص فقط للمطورين المصرح لهم.', 
          ephemeral: true 
        });
        return;
      }
      const guildId = interaction.customId.replace('toggle_bot_status_', '');
      const guild = client.guilds.cache.get(guildId);
      
      if (!guild) {
        await interaction.reply({ content: '❌ لم يتم العثور على السيرفر.', ephemeral: true });
        return;
      }
      
      const newStatus = await toggleBotStatus();
      
      // تحديث معلومات السيرفر
      const memberCount = guild.memberCount;
      const owner = await guild.fetchOwner().catch(() => null);
      const invite = await guild.invites.fetch().then(invites => invites.first()?.url).catch(() => null);
      
      const embed = new EmbedBuilder()
        .setTitle(`معلومات السيرفر: ${guild.name}`)
        .setDescription(`معلومات مفصلة عن السيرفر وحالة البوت`)
        .setColor(newStatus === 'online' ? '#00ff00' : '#ff0000')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
          { name: 'الاونر', value: owner ? `<@${owner.id}>` : 'غير متوفر', inline: true },
          { name: 'عدد الأعضاء', value: `${memberCount}`, inline: true },
          { name: 'ايدي السيرفر', value: guild.id, inline: true },
          { name: 'حالة البوت', value: `${newStatus === 'online' ? '🟢 متصل' : '🔴 غير متصل'}`, inline: true },
          { name: 'رابط السيرفر', value: invite || 'لا يوجد دعوة متاحة', inline: false }
        );
      
      // إضافة رسالة تحذير إذا كان البوت متوقف
      if (newStatus === 'offline') {
        embed.addFields(
          { name: '⚠️ تحذير', value: 'البوت متوقف حالياً. لن يتم الرد على أي أوامر أخرى حتى يتم تشغيله مرة أخرى.', inline: false }
        );
      }
      
      // تحديث الزر
      const toggleButton = new ButtonBuilder()
        .setCustomId(`toggle_bot_status_${guildId}`)
        .setLabel(newStatus === 'online' ? 'إيقاف البوت' : 'تشغيل البوت')
        .setStyle(newStatus === 'online' ? ButtonStyle.Danger : ButtonStyle.Success);
      
      const row = new ActionRowBuilder().addComponents(toggleButton);
      const components = addResetButton([row]);
      
      // إرسال إشعار خاص لجميع المطورين المصرح لهم
      console.log('🔔 بدء إرسال الإشعارات للمطورين...');
      console.log('📋 قائمة المطورين:', DEVELOPER_IDS);
      
      try {
        for (const developerId of DEVELOPER_IDS) {
          try {
            console.log(`📤 محاولة إرسال إشعار للمطور: ${developerId}`);
            const developer = await client.users.fetch(developerId);
            
            if (developer) {
              console.log(`✅ تم العثور على المطور: ${developer.username} (${developer.id})`);
              
              if (developer.id !== interaction.user.id) { // لا ترسل للمطور الذي قام بالتغيير
                const notificationEmbed = new EmbedBuilder()
                  .setTitle(`🔧 تم تغيير حالة البوت`)
                  .setDescription(`**تم ${newStatus === 'online' ? 'تشغيل' : 'إيقاف'} بوت ال ام دي تي**`)
                  .addFields(
                    { name: '👤 المطور', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '🏠 السيرفر', value: guild.name, inline: true },
                    { name: '🆔 ايدي السيرفر', value: guild.id, inline: true },
                    { name: '📊 عدد الأعضاء', value: `${guild.memberCount}`, inline: true },
                    { name: '⏰ الوقت', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                  )
                  .setColor(newStatus === 'online' ? '#00ff00' : '#ff0000')
                  .setThumbnail(guild.iconURL({ dynamic: true }))
                  .setTimestamp();
                
                await developer.send({ embeds: [notificationEmbed] });
                console.log(`✅ تم إرسال إشعار بنجاح للمطور: ${developer.username}`);
              } else {
                console.log(`⏭️ تخطي إرسال إشعار للمطور الذي قام بالتغيير: ${developer.username}`);
              }
            } else {
              console.log(`❌ لم يتم العثور على المطور: ${developerId}`);
            }
          } catch (e) { 
            console.log(`❌ فشل إرسال إشعار للمطور ${developerId}:`, e.message);
          }
        }
        console.log('✅ انتهى إرسال الإشعارات');
      } catch (e) { 
        console.error('❌ خطأ في إرسال الإشعارات:', e);
      }
      
      try {
        await interaction.reply({ embeds: [embed], components: components, ephemeral: true });
      } catch (error) {
        if (error.code === 10062) {
          // التفاعل انتهت صلاحيته، إرسال رسالة جديدة
          await interaction.followUp({ 
            content: `✅ تم ${newStatus === 'online' ? 'تشغيل' : 'إيقاف'} البوت بنجاح!`, 
            ephemeral: true 
          });
        } else {
          console.error('خطأ في إرسال التفاعل:', error);
        }
      }
      return;
    }

    // عند الضغط على زر عرض الإحصائيات
    if (interaction.isButton() && interaction.customId === 'show_bot_stats') {
      const totalGuilds = client.guilds.cache.size;
      const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
      const totalIdentities = identities.length;
      const totalPendingRequests = pendingRequests.length;
      
      const statsEmbed = new EmbedBuilder()
        .setTitle('📊 إحصائيات البوت')
        .setDescription('إحصائيات عامة للبوت')
        .setColor('#0099ff')
        .addFields(
          { name: 'عدد السيرفرات', value: `${totalGuilds}`, inline: true },
          { name: 'عدد الأعضاء', value: `${totalUsers.toLocaleString()}`, inline: true },
          { name: 'الهويات المقبولة', value: `${totalIdentities}`, inline: true },
          { name: 'الطلبات المعلقة', value: `${totalPendingRequests}`, inline: true },
          { name: 'حالة البوت', value: `${getBotStatus() === 'online' ? '🟢 متصل' : '🔴 غير متصل'}`, inline: true },
          { name: 'وقت التشغيل', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [statsEmbed], ephemeral: true });
      return;
    }

    // عند الضغط على زر إعادة تعيين الايمبيد في معلومات السيرفر
    if (interaction.isButton() && interaction.customId.startsWith('dev_reset_embed_')) {
      const guildId = interaction.customId.replace('dev_reset_embed_', '');
      if (guildSettings[guildId] && guildSettings[guildId].customEmbedImage) {
        delete guildSettings[guildId].customEmbedImage;
        saveGuildSettings();
        await interaction.reply({ content: '✅ تم إعادة تعيين صورة الايمبيد إلى الافتراضية لهذا السيرفر!', ephemeral: true });
      } else {
        await interaction.reply({ content: '❗️ لا يوجد صورة مخصصة حالياً لهذا السيرفر.', ephemeral: true });
      }
      return;
    }
    
    // معالج زر حذف الطلب المعلق للكود العسكري
    if (interaction.isButton() && interaction.customId.startsWith('delete_pending_military_code_')) {
      const requestId = interaction.customId.replace('delete_pending_military_code_', '');
      const guildId = interaction.guildId;
      
      // البحث عن الطلب المعلق
      const pendingRequest = pendingMilitaryCodeRequests.find(req => 
        req.requestId === requestId && req.guildId === guildId
      );
      
      if (!pendingRequest) {
        await interaction.reply({ content: '❌ لم يتم العثور على الطلب المعلق.', ephemeral: true });
        return;
      }
      
      // حذف الطلب من القائمة المعلقة
      pendingMilitaryCodeRequests = pendingMilitaryCodeRequests.filter(req => req.requestId !== requestId);
      saveAllData();
      
      // إرسال لوق في روم اللوق
      const logChannelId = guildSettings[guildId]?.logChannelId;
      if (logChannelId) {
        try {
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('🗑️ تم حذف طلب كود عسكري معلق')
              .setDescription(`**المستخدم:** <@${pendingRequest.userId}> (${pendingRequest.username})\n**الاسم:** ${pendingRequest.fullName}\n**الكود:** \`${pendingRequest.code}\`\n**تم الحذف من قبل:** ${interaction.user}\n**معرف الطلب:** ${requestId}`)
              .setColor('#ff6b35')
              .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (e) { /* تجاهل الخطأ */ }
      }
      
      // إرسال رسالة للشخص في الخاص
      try {
        const user = await client.users.fetch(pendingRequest.userId);
        const deleteEmbed = new EmbedBuilder()
          .setTitle('🗑️ تم حذف طلب الكود العسكري')
          .setDescription(`**مرحباً ${user.username}!**\n\nتم حذف طلب الكود العسكري المعلق الخاص بك.\n\n**الكود:** \`${pendingRequest.code}\`\n**تم الحذف من قبل:** ${interaction.user}\n\nيمكنك تقديم طلب كود عسكري جديد مرة أخرى.`)
          .setColor('#ff6b35')
          .setTimestamp();
        await user.send({ embeds: [deleteEmbed] });
      } catch (err) { /* تجاهل الخطأ */ }
      
      await interaction.reply({ content: '✅ تم حذف الطلب المعلق بنجاح! يمكن للعسكري تقديم طلب جديد.', ephemeral: true });
      return;
    }

    // معالج زر تأكيد إضافة النقاط
    if (interaction.isButton() && interaction.customId.startsWith('confirm_add_points_')) {
      const parts = interaction.customId.replace('confirm_add_points_', '').split('_');
      const userId = parts[0];
      const pointsToAdd = parseInt(parts[1]);
      const guildId = interaction.guildId;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const currentPoints = getMilitaryPoints(userId, guildId);
        
        // إضافة النقاط
        addMilitaryPoints(userId, guildId, pointsToAdd);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ تم إضافة النقاط بنجاح')
          .setDescription('**تم إضافة النقاط رسمياً!**')
          .setColor('#00ff00')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '⭐ **النقاط**', value: `**النقاط السابقة:** \`${currentPoints} نقطة\`\n**النقاط المضافة:** \`+${pointsToAdd} نقطة\`\n**النقاط الإجمالية الجديدة:** \`${currentPoints + pointsToAdd} نقطة\``, inline: false },
            { name: '👮 **تم الإضافة بواسطة**', value: `${interaction.user}`, inline: false }
          )
          .setTimestamp();
        
        await interaction.update({ embeds: [embed], components: [] });
        
        // إرسال لوق في روم اللوق
        const logChannelId = guildSettings[guildId]?.logChannelId;
        if (logChannelId) {
          try {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
              const logEmbed = new EmbedBuilder()
                .setTitle('➕ تم إضافة نقاط عسكرية')
                .setDescription(`**المستخدم:** <@${userId}> (${targetUser.username})\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**النقاط المضافة:** +${pointsToAdd} نقطة\n**النقاط الإجمالية:** ${currentPoints + pointsToAdd} نقطة\n**تم الإضافة بواسطة:** ${interaction.user}`)
                .setColor('#00ff00')
                .setTimestamp();
              
              await logChannel.send({ embeds: [logEmbed] });
            }
          } catch (e) { /* تجاهل الخطأ */ }
        }
        
        // إرسال رسالة للشخص في الخاص
        try {
          const userEmbed = new EmbedBuilder()
            .setTitle('⭐ تم إضافة نقاط عسكرية لك!')
            .setDescription(`**مرحباً ${targetUser.username}!**\n\nتم إضافة نقاط عسكرية لحسابك!\n\n**النقاط المضافة:** +${pointsToAdd} نقطة\n**النقاط الإجمالية الجديدة:** ${currentPoints + pointsToAdd} نقطة\n**تم الإضافة بواسطة:** ${interaction.user}`)
            .setColor('#00ff00')
            .setTimestamp();
          await targetUser.send({ embeds: [userEmbed] });
        } catch (err) { /* تجاهل الخطأ */ }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في إضافة النقاط.', ephemeral: true });
      }
      return;
    }

    // معالج زر إلغاء إضافة النقاط
    if (interaction.isButton() && interaction.customId === 'cancel_add_points') {
      const embed = new EmbedBuilder()
        .setTitle('❌ تم إلغاء العملية')
        .setDescription('تم إلغاء إضافة النقاط العسكرية.')
        .setColor('#ff0000')
        .setTimestamp();
      
      await interaction.update({ embeds: [embed], components: [] });
      return;
    }

    // معالج زر تأكيد خصم النقاط
    if (interaction.isButton() && interaction.customId.startsWith('confirm_remove_points_')) {
      const parts = interaction.customId.replace('confirm_remove_points_', '').split('_');
      const userId = parts[0];
      const pointsToRemove = parseInt(parts[1]);
      const guildId = interaction.guildId;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const currentPoints = getMilitaryPoints(userId, guildId);
        
        // خصم النقاط
        removeMilitaryPoints(userId, guildId, pointsToRemove);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ تم خصم النقاط بنجاح')
          .setDescription('**تم خصم النقاط رسمياً!**')
          .setColor('#ff9900')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '⭐ **النقاط**', value: `**النقاط السابقة:** \`${currentPoints} نقطة\`\n**النقاط المخصومة:** \`-${pointsToRemove} نقطة\`\n**النقاط المتبقية:** \`${currentPoints - pointsToRemove} نقطة\``, inline: false },
            { name: '👮 **تم الخصم بواسطة**', value: `${interaction.user}`, inline: false }
          )
          .setTimestamp();
        
        await interaction.update({ embeds: [embed], components: [] });
        
        // إرسال لوق في روم اللوق
        const logChannelId = guildSettings[guildId]?.logChannelId;
        if (logChannelId) {
          try {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
              const logEmbed = new EmbedBuilder()
                .setTitle('➖ تم خصم نقاط عسكرية')
                .setDescription(`**المستخدم:** <@${userId}> (${targetUser.username})\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**النقاط المخصومة:** -${pointsToRemove} نقطة\n**النقاط المتبقية:** ${currentPoints - pointsToRemove} نقطة\n**تم الخصم بواسطة:** ${interaction.user}`)
                .setColor('#ff9900')
                .setTimestamp();
              
              await logChannel.send({ embeds: [logEmbed] });
            }
          } catch (e) { /* تجاهل الخطأ */ }
        }
        
        // إرسال رسالة للشخص في الخاص
        try {
          const userEmbed = new EmbedBuilder()
            .setTitle('⚠️ تم خصم نقاط عسكرية منك!')
            .setDescription(`**مرحباً ${targetUser.username}!**\n\nتم خصم نقاط عسكرية من حسابك!\n\n**النقاط المخصومة:** -${pointsToRemove} نقطة\n**النقاط المتبقية:** ${currentPoints - pointsToRemove} نقطة\n**تم الخصم بواسطة:** ${interaction.user}`)
            .setColor('#ff9900')
            .setTimestamp();
          await targetUser.send({ embeds: [userEmbed] });
        } catch (err) { /* تجاهل الخطأ */ }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في خصم النقاط.', ephemeral: true });
      }
      return;
    }

    // معالج زر إلغاء خصم النقاط
    if (interaction.isButton() && interaction.customId === 'cancel_remove_points') {
      const embed = new EmbedBuilder()
        .setTitle('❌ تم إلغاء العملية')
        .setDescription('تم إلغاء خصم النقاط العسكرية.')
        .setColor('#ff0000')
        .setTimestamp();
      
      await interaction.update({ embeds: [embed], components: [] });
      return;
    }

    // معالج مودال إدارة الأكواد العسكرية
    if (interaction.isModalSubmit() && interaction.customId === 'modal_manage_military_codes') {
      const searchTerm = interaction.fields.getTextInputValue('input_search_military_code');
      const guildId = interaction.guildId;
      
      // البحث عن الهوية بالاسم أو الرقم الوطني
      const foundIdentity = identities.find(id => 
        id.guildId === guildId && 
        (id.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
         id.nationalId === searchTerm)
      );
      
      if (!foundIdentity) {
        await interaction.reply({ content: '❌ لم يتم العثور على شخص بهذا الاسم أو الرقم الوطني.', ephemeral: true });
        return;
      }
      
      const userId = foundIdentity.userId;
      const militaryCode = getMilitaryCode(userId, guildId);
      
      try {
        const targetUser = await client.users.fetch(userId);
        const militaryUser = getMilitaryUser(userId, guildId);
        const points = getMilitaryPoints(userId, guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('🔐 معلومات الكود العسكري')
          .setDescription('**معلومات العسكري المطلوب:**')
          .setColor('#1e3a8a')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${foundIdentity.fullName}\n**الرقم الوطني:** ${foundIdentity.nationalId}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '🎖️ **المعلومات العسكرية**', value: `**الرتبة:** ${militaryUser?.rank || 'عسكري'}\n**النقاط العسكرية:** ${points} نقطة`, inline: false },
            { name: '🔐 **الكود العسكري**', value: militaryCode ? `\`${militaryCode}\`` : '**لا يوجد كود عسكري**', inline: false }
          )
          .setTimestamp();
        
        const buttons = [];
        
        // زر تعديل الكود العسكري (فقط إذا كان لديه كود)
        if (militaryCode) {
          const editButton = new ButtonBuilder()
            .setCustomId(`edit_military_code_${userId}`)
            .setLabel('✏️ تعديل الكود العسكري')
            .setStyle(ButtonStyle.Primary);
          buttons.push(editButton);
        }
        
        // زر إضافة رتبة عسكرية
        const rankButton = new ButtonBuilder()
          .setCustomId(`add_military_rank_${userId}`)
          .setLabel('🎖️ إضافة رتبة عسكرية')
          .setStyle(ButtonStyle.Secondary);
        buttons.push(rankButton);
        
        // زر إضافة تحذير عسكري
        const warningButton = new ButtonBuilder()
          .setCustomId(`add_military_warning_${userId}`)
          .setLabel('🚨 إضافة تحذير عسكري')
          .setStyle(ButtonStyle.Danger);
        buttons.push(warningButton);
        
        // زر استعلام تحذيرات العسكري
        const viewWarningsButton = new ButtonBuilder()
          .setCustomId(`view_military_warnings_${userId}`)
          .setLabel('📋 استعلام تحذيرات العسكري')
          .setStyle(ButtonStyle.Primary);
        buttons.push(viewWarningsButton);
        
        // زر إرسال تنبيه
        const warnButton = new ButtonBuilder()
          .setCustomId(`send_military_warning_${userId}`)
          .setLabel('⚠️ إرسال تنبيه')
          .setStyle(ButtonStyle.Danger);
        buttons.push(warnButton);
        
        const row = new ActionRowBuilder().addComponents(buttons);
        
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في جلب معلومات المستخدم.', ephemeral: true });
      }
      return;
    }

    // معالج مودال تعديل الكود العسكري
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_edit_military_code_')) {
      const userId = interaction.customId.replace('modal_edit_military_code_', '');
      const newCode = interaction.fields.getTextInputValue('input_new_military_code');
      const guildId = interaction.guildId;
      
      if (!newCode || newCode.trim() === '') {
        await interaction.reply({ content: '❌ يرجى إدخال كود عسكري صحيح.', ephemeral: true });
        return;
      }
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const oldCode = getMilitaryCode(userId, guildId);
        
        // تحديث الكود العسكري
        setMilitaryCode(userId, guildId, newCode);
        
        // تحديث الكود في militaryUsers أيضاً
        if (militaryUsers[userId]) {
          militaryUsers[userId].code = newCode;
          militaryUsers[userId].lastUpdate = new Date().toISOString();
          saveAllData();
        }
        
        // تحديث الصورة في روم مباشرة العسكر
        await updateMilitaryPageImage(guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ تم تعديل الكود العسكري بنجاح')
          .setDescription('**تم تحديث الكود العسكري رسمياً!**')
          .setColor('#00ff00')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '🔐 **الكود العسكري**', value: `**الكود القديم:** \`${oldCode || 'غير محدد'}\`\n**الكود الجديد:** \`${newCode}\``, inline: false },
            { name: '👮 **تم التعديل بواسطة**', value: `${interaction.user}`, inline: false }
          )
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        
        // إرسال لوق في روم اللوق
        const logChannelId = guildSettings[guildId]?.logChannelId;
        if (logChannelId) {
          try {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
              const logEmbed = new EmbedBuilder()
                .setTitle('✏️ تم تعديل كود عسكري')
                .setDescription(`**المستخدم:** <@${userId}> (${targetUser.username})\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الكود القديم:** \`${oldCode || 'غير محدد'}\`\n**الكود الجديد:** \`${newCode}\`\n**تم التعديل بواسطة:** ${interaction.user}`)
                .setColor('#00ff00')
                .setTimestamp();
              
              await logChannel.send({ embeds: [logEmbed] });
            }
          } catch (e) { /* تجاهل الخطأ */ }
        }
        
        // إرسال رسالة للشخص في الخاص
        try {
          const userEmbed = new EmbedBuilder()
            .setTitle('✏️ تم تعديل كودك العسكري!')
            .setDescription(`**مرحباً ${targetUser.username}!**\n\nتم تعديل كودك العسكري من قبل المسؤول!\n\n**الكود الجديد:** \`${newCode}\`\n**تم التعديل بواسطة:** ${interaction.user}`)
            .setColor('#00ff00')
            .setTimestamp();
          await targetUser.send({ embeds: [userEmbed] });
        } catch (err) { /* تجاهل الخطأ */ }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في تعديل الكود العسكري.', ephemeral: true });
      }
      return;
    }

    // معالج مودال إرسال تنبيه عسكري
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_send_military_warning_')) {
      const userId = interaction.customId.replace('modal_send_military_warning_', '');
      const warningMessage = interaction.fields.getTextInputValue('input_warning_message');
      const guildId = interaction.guildId;
      
      if (!warningMessage || warningMessage.trim() === '') {
        await interaction.reply({ content: '❌ يرجى إدخال رسالة تنبيه صحيحة.', ephemeral: true });
        return;
      }
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('⚠️ تم إرسال التنبيه العسكري بنجاح')
          .setDescription('**تم إرسال التنبيه للعسكري!**')
          .setColor('#ff9900')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '⚠️ **رسالة التنبيه**', value: warningMessage, inline: false },
            { name: '👮 **تم الإرسال بواسطة**', value: `${interaction.user}`, inline: false }
          )
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        
        // إرسال لوق في روم اللوق
        const logChannelId = guildSettings[guildId]?.logChannelId;
        if (logChannelId) {
          try {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
              const logEmbed = new EmbedBuilder()
                .setTitle('⚠️ تم إرسال تنبيه عسكري')
                .setDescription(`**المستخدم:** <@${userId}> (${targetUser.username})\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**رسالة التنبيه:** ${warningMessage}\n**تم الإرسال بواسطة:** ${interaction.user}`)
                .setColor('#ff9900')
                .setTimestamp();
              
              await logChannel.send({ embeds: [logEmbed] });
            }
          } catch (e) { /* تجاهل الخطأ */ }
        }
        
        // إرسال رسالة للشخص في الخاص
        try {
          const userEmbed = new EmbedBuilder()
            .setTitle('⚠️ لديك تنبيه عسكري!')
            .setDescription(`**مرحباً ${targetUser.username}!**\n\nلديك تنبيه عسكري من المسؤول!\n\n**المسؤول:** ${interaction.user}\n**سبب التنبيه:** ${warningMessage}`)
            .setColor('#ff9900')
            .setTimestamp();
          await targetUser.send({ embeds: [userEmbed] });
        } catch (err) { /* تجاهل الخطأ */ }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في إرسال التنبيه.', ephemeral: true });
      }
      return;
    }

    // معالج مودال إضافة رتبة عسكرية
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_add_military_rank_')) {
      const userId = interaction.customId.replace('modal_add_military_rank_', '');
      const newRank = interaction.fields.getTextInputValue('input_military_rank');
      const guildId = interaction.guildId;
      
      if (!newRank || newRank.trim() === '') {
        await interaction.reply({ content: '❌ يرجى إدخال رتبة عسكرية صحيحة.', ephemeral: true });
        return;
      }
      
      if (newRank.length > 15) {
        await interaction.reply({ content: '❌ يجب أن تكون الرتبة العسكرية 15 حرف كحد أقصى.', ephemeral: true });
        return;
      }
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const currentUser = getMilitaryUser(userId, guildId);
        const oldRank = currentUser?.rank || 'عسكري';
        
        // تحديث الرتبة العسكرية
        addOrUpdateMilitaryUser(userId, guildId, {
          fullName: identity?.fullName || targetUser.username,
          code: getMilitaryCode(userId, guildId) || '',
          rank: newRank,
          status: currentUser?.status || 'out',
          lastUpdate: Date.now()
        });
        
        // التأكد من حفظ الرتبة العسكرية
        if (militaryUsers[userId]) {
          militaryUsers[userId].rank = newRank;
          saveAllData();
        }
        
        // تحديث الصورة في روم مباشرة العسكر
        await updateMilitaryPageImage(guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('🎖️ تم إضافة الرتبة العسكرية بنجاح')
          .setDescription('**تم تحديث الرتبة العسكرية رسمياً!**')
          .setColor('#00ff00')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '🎖️ **الرتبة العسكرية**', value: `**الرتبة القديمة:** ${oldRank}\n**الرتبة الجديدة:** ${newRank}`, inline: false },
            { name: '👮 **تم الإضافة بواسطة**', value: `${interaction.user}`, inline: false }
          )
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        
        // إرسال لوق في روم اللوق
        const logChannelId = guildSettings[guildId]?.logChannelId;
        if (logChannelId) {
          try {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
              const logEmbed = new EmbedBuilder()
                .setTitle('🎖️ تم إضافة رتبة عسكرية')
                .setDescription(`**المستخدم:** <@${userId}> (${targetUser.username})\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرتبة القديمة:** ${oldRank}\n**الرتبة الجديدة:** ${newRank}\n**تم الإضافة بواسطة:** ${interaction.user}`)
                .setColor('#00ff00')
                .setTimestamp();
              
              await logChannel.send({ embeds: [logEmbed] });
            }
          } catch (e) { /* تجاهل الخطأ */ }
        }
        
        // إرسال رسالة للشخص في الخاص
        try {
          const userEmbed = new EmbedBuilder()
            .setTitle('🎖️ تم إضافة رتبة عسكرية لك!')
            .setDescription(`**مرحباً ${targetUser.username}!**\n\nتم إضافة رتبة عسكرية لحسابك!\n\n**الرتبة الجديدة:** ${newRank}\n**تم الإضافة بواسطة:** ${interaction.user}`)
            .setColor('#00ff00')
            .setTimestamp();
          await targetUser.send({ embeds: [userEmbed] });
        } catch (err) { /* تجاهل الخطأ */ }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في إضافة الرتبة العسكرية.', ephemeral: true });
      }
      return;
    }

    // معالج مودال إضافة تحذير عسكري
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_add_military_warning_')) {
      const userId = interaction.customId.replace('modal_add_military_warning_', '');
      const warningNumber = interaction.fields.getTextInputValue('input_warning_number');
      const warningReason = interaction.fields.getTextInputValue('input_warning_reason');
      const guildId = interaction.guildId;
      
      if (!warningNumber || !warningReason || warningNumber.trim() === '' || warningReason.trim() === '') {
        await interaction.reply({ content: '❌ يرجى إدخال جميع البيانات المطلوبة.', ephemeral: true });
        return;
      }
      
      // التحقق من رقم التحذير
      const validNumbers = ['1', '2', '3', '4', '5'];
      if (!validNumbers.includes(warningNumber.trim())) {
        await interaction.reply({ content: '❌ رقم التحذير يجب أن يكون 1 أو 2 أو 3 أو 4 أو 5.', ephemeral: true });
        return;
      }
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const adminIdentity = identities.find(id => id.userId === interaction.user.id && id.guildId === guildId);
        const adminRank = getMilitaryUser(interaction.user.id, guildId)?.rank || 'مسؤول';
        
        // إضافة التحذير
        const warning = addMilitaryWarning(
          userId, 
          guildId, 
          warningNumber.trim(), 
          warningReason.trim(), 
          interaction.user.id, 
          adminIdentity?.fullName || interaction.user.username,
          adminRank
        );
        
        const embed = new EmbedBuilder()
          .setTitle('🚨 تم إضافة التحذير العسكري بنجاح')
          .setDescription('**تم إضافة التحذير العسكري رسمياً!**')
          .setColor('#ff0000')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`, inline: false },
            { name: '🚨 **التحذير العسكري**', value: `**رقم التحذير:** ${warningNumber}\n**سبب التحذير:** ${warningReason}`, inline: false },
            { name: '👮 **تم الإضافة بواسطة**', value: `${interaction.user} (${adminRank})`, inline: false }
          )
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        
        // إرسال لوق في روم اللوق
        const logChannelId = guildSettings[guildId]?.logChannelId;
        if (logChannelId) {
          try {
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
              const logEmbed = new EmbedBuilder()
                .setTitle('🚨 تم إضافة تحذير عسكري')
                .setDescription(`**المستخدم:** <@${userId}> (${targetUser.username})\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**رقم التحذير:** ${warningNumber}\n**سبب التحذير:** ${warningReason}\n**تم الإضافة بواسطة:** ${interaction.user} (${adminRank})`)
                .setColor('#ff0000')
                .setTimestamp();
              
              await logChannel.send({ embeds: [logEmbed] });
            }
          } catch (e) { /* تجاهل الخطأ */ }
        }
        
        // إرسال رسالة للشخص في الخاص
        try {
          const userEmbed = new EmbedBuilder()
            .setTitle('🚨 تم إعطاؤك تحذير عسكري!')
            .setDescription(`**مرحباً ${targetUser.username}!**\n\nلقد تم إعطاؤك تحذير عسكري!\n\n**رقم التحذير:** ${warningNumber}\n**سبب التحذير:** ${warningReason}\n**من قبل:** ${adminRank} ${interaction.user}`)
            .setColor('#ff0000')
            .setTimestamp();
          await targetUser.send({ embeds: [userEmbed] });
        } catch (err) { /* تجاهل الخطأ */ }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في إضافة التحذير العسكري.', ephemeral: true });
      }
      return;
    }

    // معالج زر تعديل الكود العسكري
    if (interaction.isButton() && interaction.customId.startsWith('edit_military_code_')) {
      const userId = interaction.customId.replace('edit_military_code_', '');
      const guildId = interaction.guildId;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const currentCode = getMilitaryCode(userId, guildId);
        
        const modal = new ModalBuilder()
          .setCustomId(`modal_edit_military_code_${userId}`)
          .setTitle('تعديل الكود العسكري');
        
        const codeInput = new TextInputBuilder()
          .setCustomId('input_new_military_code')
          .setLabel('الكود العسكري الجديد')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب الكود العسكري الجديد')
          .setValue(currentCode || '')
          .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(codeInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في جلب معلومات المستخدم.', ephemeral: true });
      }
      return;
    }

    // معالج زر إضافة رتبة عسكرية
    if (interaction.isButton() && interaction.customId.startsWith('add_military_rank_')) {
      const userId = interaction.customId.replace('add_military_rank_', '');
      const guildId = interaction.guildId;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const currentRank = getMilitaryUser(userId, guildId)?.rank || 'عسكري';
        
        const modal = new ModalBuilder()
          .setCustomId(`modal_add_military_rank_${userId}`)
          .setTitle('إضافة رتبة عسكرية');
        
        const rankInput = new TextInputBuilder()
          .setCustomId('input_military_rank')
          .setLabel('اسم الرتبة العسكرية')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('اكتب اسم الرتبة العسكرية (15 حرف كحد أقصى)')
          .setValue(currentRank)
          .setMaxLength(15)
          .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(rankInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في جلب معلومات المستخدم.', ephemeral: true });
      }
      return;
    }

    // معالج زر إضافة تحذير عسكري
    if (interaction.isButton() && interaction.customId.startsWith('add_military_warning_')) {
      const userId = interaction.customId.replace('add_military_warning_', '');
      const guildId = interaction.guildId;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        
        const modal = new ModalBuilder()
          .setCustomId(`modal_add_military_warning_${userId}`)
          .setTitle('إضافة تحذير عسكري');
        
        const warningNumberInput = new TextInputBuilder()
          .setCustomId('input_warning_number')
          .setLabel('رقم التحذير')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('1 | 2 | 3 | 4 | 5')
          .setRequired(true);
        
        const warningReasonInput = new TextInputBuilder()
          .setCustomId('input_warning_reason')
          .setLabel('سبب التحذير')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('اكتب سبب التحذير')
          .setRequired(true);
        
        const row1 = new ActionRowBuilder().addComponents(warningNumberInput);
        const row2 = new ActionRowBuilder().addComponents(warningReasonInput);
        modal.addComponents(row1, row2);
        
        await interaction.showModal(modal);
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في جلب معلومات المستخدم.', ephemeral: true });
      }
      return;
    }

    // معالج زر استعلام تحذيرات العسكري
    if (interaction.isButton() && interaction.customId.startsWith('view_military_warnings_')) {
      const userId = interaction.customId.replace('view_military_warnings_', '');
      const guildId = interaction.guildId;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        const warnings = getMilitaryWarnings(userId, guildId);
        
        if (warnings.length === 0) {
          const embed = new EmbedBuilder()
            .setTitle('📋 تحذيرات العسكري')
            .setDescription(`**لا توجد تحذيرات عسكرية للعسكري:**\n\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`)
            .setColor('#00ff00')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
          
          await interaction.reply({ embeds: [embed], ephemeral: true });
          return;
        }
        
        const embed = new EmbedBuilder()
          .setTitle('📋 تحذيرات العسكري')
          .setDescription(`**تحذيرات العسكري:**\n\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}\n\n**عدد التحذيرات:** ${warnings.length}`)
          .setColor('#ff9900')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        // إضافة تفاصيل كل تحذير
        warnings.forEach((warning, index) => {
          let evidenceText = '❌ غير موجود';
          if (warning.evidence) {
            evidenceText = `[رابط الدليل](${warning.evidence})`;
          }
          embed.addFields({
            name: `🚨 التحذير رقم ${warning.warningNumber}`,
            value: `**التاريخ:** <t:${Math.floor(new Date(warning.date).getTime() / 1000)}:F>\n**السبب:** ${warning.reason}\n**من قبل:** ${warning.adminName} (${warning.adminRank})\n**الدليل:** ${evidenceText}`,
            inline: false
          });
        });
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في جلب معلومات المستخدم.', ephemeral: true });
      }
      return;
    }

    // معالج زر إرسال تنبيه عسكري
    if (interaction.isButton() && interaction.customId.startsWith('send_military_warning_')) {
      const userId = interaction.customId.replace('send_military_warning_', '');
      const guildId = interaction.guildId;
      
      try {
        const targetUser = await client.users.fetch(userId);
        const identity = identities.find(id => id.userId === userId && id.guildId === guildId);
        
        const modal = new ModalBuilder()
          .setCustomId(`modal_send_military_warning_${userId}`)
          .setTitle('إرسال تنبيه عسكري');
        
        const warningInput = new TextInputBuilder()
          .setCustomId('input_warning_message')
          .setLabel('رسالة التنبيه')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('اكتب رسالة التنبيه للعسكري')
          .setRequired(true);
        
        const row = new ActionRowBuilder().addComponents(warningInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في جلب معلومات المستخدم.', ephemeral: true });
      }
      return;
    }

    // معالج زر إضافة دليل تحذير
    if (interaction.isButton() && interaction.customId === 'add_warning_evidence') {
      const modal = new ModalBuilder()
        .setCustomId('modal_add_warning_evidence')
        .setTitle('إضافة دليل تحذير');
      
      const warningIdInput = new TextInputBuilder()
        .setCustomId('input_warning_id')
        .setLabel('معرف التحذير')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('اكتب معرف التحذير')
        .setRequired(true);
      
      const evidenceUrlInput = new TextInputBuilder()
        .setCustomId('input_evidence_url')
        .setLabel('رابط صورة الدليل')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ضع رابط صورة الدليل هنا')
        .setRequired(true);
      
      const row1 = new ActionRowBuilder().addComponents(warningIdInput);
      const row2 = new ActionRowBuilder().addComponents(evidenceUrlInput);
      modal.addComponents(row1, row2);
      
      await interaction.showModal(modal);
      return;
    }

    // معالج زر حذف تحذير
    if (interaction.isButton() && interaction.customId === 'remove_warning') {
      const modal = new ModalBuilder()
        .setCustomId('modal_remove_warning')
        .setTitle('حذف تحذير');
      
      const warningIdInput = new TextInputBuilder()
        .setCustomId('input_warning_id_to_remove')
        .setLabel('معرف التحذير')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('اكتب معرف التحذير المراد حذفه')
        .setRequired(true);
      
      const removalReasonInput = new TextInputBuilder()
        .setCustomId('input_removal_reason')
        .setLabel('سبب إزالة التحذير')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('اكتب سبب إزالة التحذير')
        .setRequired(true);
      
      const row1 = new ActionRowBuilder().addComponents(warningIdInput);
      const row2 = new ActionRowBuilder().addComponents(removalReasonInput);
      modal.addComponents(row1, row2);
      
      await interaction.showModal(modal);
      return;
    }

    // معالج مودال إضافة دليل تحذير
    if (interaction.isModalSubmit() && interaction.customId === 'modal_add_warning_evidence') {
      const warningId = interaction.fields.getTextInputValue('input_warning_id');
      const evidenceUrl = interaction.fields.getTextInputValue('input_evidence_url');
      const guildId = interaction.guildId;
      
      if (!warningId || !evidenceUrl || warningId.trim() === '' || evidenceUrl.trim() === '') {
        await interaction.reply({ content: '❌ يرجى إدخال جميع البيانات المطلوبة.', ephemeral: true });
        return;
      }
      
      try {
        // البحث عن التحذير في جميع التحذيرات
        let foundWarning = null;
        let foundUserId = null;
        
        if (militaryWarnings[guildId]) {
          Object.entries(militaryWarnings[guildId]).forEach(([userId, warnings]) => {
            const warning = warnings.find(w => w.id === warningId);
            if (warning) {
              foundWarning = warning;
              foundUserId = userId;
            }
          });
        }
        
        if (!foundWarning) {
          await interaction.reply({ content: '❌ لم يتم العثور على التحذير المحدد.', ephemeral: true });
          return;
        }
        
        // إضافة الدليل
        const success = addWarningEvidence(warningId, foundUserId, guildId, evidenceUrl.trim());
        
        if (success) {
          const targetUser = await client.users.fetch(foundUserId);
          const identity = identities.find(id => id.userId === foundUserId && id.guildId === guildId);
          
          const embed = new EmbedBuilder()
            .setTitle('✅ تم إضافة دليل التحذير بنجاح')
            .setDescription('**تم إضافة دليل التحذير رسمياً!**')
            .setColor('#00ff00')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`, inline: false },
              { name: '🚨 **التحذير**', value: `**رقم التحذير:** ${foundWarning.warningNumber}\n**السبب:** ${foundWarning.reason}`, inline: false },
              { name: '🔗 **الدليل**', value: `**الرابط:** ${evidenceUrl.trim()}`, inline: false },
              { name: '👮 **تم الإضافة بواسطة**', value: `${interaction.user}`, inline: false }
            )
            .setTimestamp();
          
          await interaction.reply({ embeds: [embed], ephemeral: true });
          
          // إرسال لوق في روم اللوق
          const logChannelId = guildSettings[guildId]?.logChannelId;
          if (logChannelId) {
            try {
              const logChannel = interaction.guild.channels.cache.get(logChannelId);
              if (logChannel) {
                const logEmbed = new EmbedBuilder()
                  .setTitle('🔗 تم إضافة دليل تحذير عسكري')
                  .setDescription(`**المستخدم:** <@${foundUserId}> (${targetUser.username})\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**رقم التحذير:** ${foundWarning.warningNumber}\n**سبب التحذير:** ${foundWarning.reason}\n**رابط الدليل:** ${evidenceUrl.trim()}\n**تم الإضافة بواسطة:** ${interaction.user}`)
                  .setColor('#00ff00')
                  .setTimestamp();
                
                await logChannel.send({ embeds: [logEmbed] });
              }
            } catch (e) { /* تجاهل الخطأ */ }
          }
          
          // إرسال رسالة للشخص في الخاص
          try {
            const userEmbed = new EmbedBuilder()
              .setTitle('🔗 تم إضافة دليل لتحذيرك العسكري!')
              .setDescription(`**مرحباً ${targetUser.username}!**\n\nتم إضافة دليل لتحذيرك العسكري!\n\n**رقم التحذير:** ${foundWarning.warningNumber}\n**سبب التحذير:** ${foundWarning.reason}\n**رابط الدليل:** ${evidenceUrl.trim()}\n**تم الإضافة بواسطة:** ${interaction.user}`)
              .setColor('#00ff00')
              .setTimestamp();
            await targetUser.send({ embeds: [userEmbed] });
          } catch (err) { /* تجاهل الخطأ */ }
          
        } else {
          await interaction.reply({ content: '❌ فشل في إضافة دليل التحذير.', ephemeral: true });
        }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في إضافة دليل التحذير.', ephemeral: true });
      }
      return;
    }

    // معالج مودال البحث عن تحذيرات العسكري
    if (interaction.isModalSubmit() && interaction.customId === 'modal_manage_military_warnings') {
      const searchValue = interaction.fields.getTextInputValue('input_search_military_warnings').trim();
      const guildId = interaction.guildId;
      
      if (!searchValue) {
        await interaction.reply({ content: '❌ يرجى إدخال اسم الشخص أو الرقم الوطني.', ephemeral: true });
        return;
      }
      
      try {
        // البحث عن الشخص بالاسم أو الرقم الوطني
        let foundIdentity = null;
        if (/^\d+$/.test(searchValue)) {
          // البحث بالرقم الوطني
          foundIdentity = identities.find(id => id.nationalId === searchValue && id.guildId === guildId);
        } else {
          // البحث بالاسم الكامل
          foundIdentity = identities.find(id => id.fullName === searchValue && id.guildId === guildId);
        }
        
        if (!foundIdentity) {
          await interaction.reply({ content: '❌ لم يتم العثور على شخص بهذا الاسم أو الرقم الوطني.', ephemeral: true });
          return;
        }
        
        const targetUser = await client.users.fetch(foundIdentity.userId);
        const warnings = getAllMilitaryWarnings(foundIdentity.userId, guildId);
        
        if (warnings.length === 0) {
          const embed = new EmbedBuilder()
            .setTitle('📋 تحذيرات العسكري')
            .setDescription(`**لا توجد تحذيرات عسكرية للشخص:**\n\n**الاسم:** ${foundIdentity.fullName}\n**الرقم الوطني:** ${foundIdentity.nationalId}\n**المستخدم:** ${targetUser}`)
            .setColor('#00ff00')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
          
          await interaction.reply({ embeds: [embed], ephemeral: true });
          return;
        }
        
        // ترتيب التحذيرات حسب التاريخ (الأحدث أولاً)
        warnings.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        const embed = new EmbedBuilder()
          .setTitle('📋 تحذيرات العسكري')
          .setDescription(`**تحذيرات العسكري:**\n\n**الاسم:** ${foundIdentity.fullName}\n**الرقم الوطني:** ${foundIdentity.nationalId}\n**المستخدم:** ${targetUser}\n\n**عدد التحذيرات:** ${warnings.length}`)
          .setColor('#ff9900')
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        
        // إضافة تفاصيل كل تحذير
        warnings.forEach((warning, index) => {
          embed.addFields({
            name: `🚨 التحذير رقم ${warning.warningNumber} - المعرف: ${warning.id} (${warning.removed ? 'محذوف' : 'نشط'})`,
            value: `**التاريخ:** <t:${Math.floor(new Date(warning.date).getTime() / 1000)}:F>\n**السبب:** ${warning.reason}\n**من قبل:** ${warning.adminName} (${warning.adminRank})\n**الدليل:** ${warning.evidence ? '✅ موجود' : '❌ غير موجود'}${warning.removed ? `\n**سبب الحذف:** ${warning.removalReason}\n**تاريخ الحذف:** <t:${Math.floor(new Date(warning.removalDate).getTime() / 1000)}:F>\n**تم الحذف بواسطة:** ${warning.removalAdminName}` : ''}`,
            inline: false
          });
        });
        
        // إضافة أزرار للتحكم
        const buttons = [];
        
        // زر إضافة دليل تحذير (فقط للتحذيرات النشطة)
        const activeWarnings = warnings.filter(w => !w.removed);
        if (activeWarnings.length > 0) {
          const addEvidenceButton = new ButtonBuilder()
            .setCustomId('add_warning_evidence')
            .setLabel('➕ إضافة دليل تحذير')
            .setStyle(ButtonStyle.Success);
          buttons.push(addEvidenceButton);
        }
        
        // زر حذف تحذير (فقط للتحذيرات النشطة)
        if (activeWarnings.length > 0) {
          const removeWarningButton = new ButtonBuilder()
            .setCustomId('remove_warning')
            .setLabel('🗑️ حذف تحذير')
            .setStyle(ButtonStyle.Danger);
          buttons.push(removeWarningButton);
        }
        
        if (buttons.length > 0) {
          const row = new ActionRowBuilder().addComponents(buttons);
          await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        } else {
          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في البحث عن تحذيرات العسكري.', ephemeral: true });
      }
      return;
    }

    // معالج مودال حذف تحذير
    if (interaction.isModalSubmit() && interaction.customId === 'modal_remove_warning') {
      const warningId = interaction.fields.getTextInputValue('input_warning_id_to_remove');
      const removalReason = interaction.fields.getTextInputValue('input_removal_reason');
      const guildId = interaction.guildId;
      
      if (!warningId || !removalReason || warningId.trim() === '' || removalReason.trim() === '') {
        await interaction.reply({ content: '❌ يرجى إدخال جميع البيانات المطلوبة.', ephemeral: true });
        return;
      }
      
      try {
        // البحث عن التحذير في جميع التحذيرات
        let foundWarning = null;
        let foundUserId = null;
        
        if (militaryWarnings[guildId]) {
          Object.entries(militaryWarnings[guildId]).forEach(([userId, warnings]) => {
            const warning = warnings.find(w => w.id === warningId);
            if (warning) {
              foundWarning = warning;
              foundUserId = userId;
            }
          });
        }
        
        if (!foundWarning) {
          await interaction.reply({ content: '❌ لم يتم العثور على التحذير المحدد.', ephemeral: true });
          return;
        }
        
        if (foundWarning.removed) {
          await interaction.reply({ content: '❌ هذا التحذير محذوف بالفعل.', ephemeral: true });
          return;
        }
        
        const adminIdentity = identities.find(id => id.userId === interaction.user.id && id.guildId === guildId);
        const adminRank = getMilitaryUser(interaction.user.id, guildId)?.rank || 'مسؤول';
        
        // حذف التحذير
        const success = removeMilitaryWarning(
          warningId, 
          foundUserId, 
          guildId, 
          removalReason.trim(), 
          interaction.user.id, 
          adminIdentity?.fullName || interaction.user.username
        );
        
        if (success) {
          const targetUser = await client.users.fetch(foundUserId);
          const identity = identities.find(id => id.userId === foundUserId && id.guildId === guildId);
          
          const embed = new EmbedBuilder()
            .setTitle('✅ تم حذف التحذير العسكري بنجاح')
            .setDescription('**تم حذف التحذير العسكري رسمياً!**')
            .setColor('#ff0000')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: '👤 **المعلومات الشخصية**', value: `**الاسم:** ${identity?.fullName || 'غير محدد'}\n**الرقم الوطني:** ${identity?.nationalId || 'غير محدد'}\n**المستخدم:** ${targetUser}`, inline: false },
              { name: '🚨 **التحذير المحذوف**', value: `**رقم التحذير:** ${foundWarning.warningNumber}\n**السبب الأصلي:** ${foundWarning.reason}`, inline: false },
              { name: '🗑️ **سبب الحذف**', value: `**السبب:** ${removalReason.trim()}`, inline: false },
              { name: '👮 **تم الحذف بواسطة**', value: `${interaction.user} (${adminRank})`, inline: false }
            )
            .setTimestamp();
          
          await interaction.reply({ embeds: [embed], ephemeral: true });
          
          // إرسال لوق في روم اللوق
          const logChannelId = guildSettings[guildId]?.logChannelId;
          if (logChannelId) {
            try {
              const logChannel = interaction.guild.channels.cache.get(logChannelId);
              if (logChannel) {
                const logEmbed = new EmbedBuilder()
                  .setTitle('🗑️ تم حذف تحذير عسكري')
                  .setDescription(`**المستخدم:** <@${foundUserId}> (${targetUser.username})\n**الاسم:** ${identity?.fullName || 'غير محدد'}\n**رقم التحذير:** ${foundWarning.warningNumber}\n**سبب التحذير الأصلي:** ${foundWarning.reason}\n**سبب الحذف:** ${removalReason.trim()}\n**تم الحذف بواسطة:** ${interaction.user} (${adminRank})`)
                  .setColor('#ff0000')
                  .setTimestamp();
                
                await logChannel.send({ embeds: [logEmbed] });
              }
            } catch (e) { /* تجاهل الخطأ */ }
          }
          
          // إرسال رسالة للشخص في الخاص
          try {
            const userEmbed = new EmbedBuilder()
              .setTitle('🗑️ تم حذف تحذيرك العسكري!')
              .setDescription(`**مرحباً ${targetUser.username}!**\n\nتم حذف تحذيرك العسكري!\n\n**رقم التحذير:** ${foundWarning.warningNumber}\n**سبب التحذير الأصلي:** ${foundWarning.reason}\n**سبب الحذف:** ${removalReason.trim()}\n**تم الحذف بواسطة:** ${adminRank} ${interaction.user}`)
              .setColor('#ff0000')
              .setTimestamp();
            await targetUser.send({ embeds: [userEmbed] });
          } catch (err) { /* تجاهل الخطأ */ }
          
        } else {
          await interaction.reply({ content: '❌ فشل في حذف التحذير.', ephemeral: true });
        }
        
      } catch (e) {
        await interaction.reply({ content: '❌ خطأ في حذف التحذير.', ephemeral: true });
      }
      return;
    }

    // معالج خيار إعادة تعيين الصفحة (للأوامر التي تبدأ بـ /)
    if (interaction.isStringSelectMenu() && interaction.values[0] === 'reset_page') {
      await interaction.deferUpdate();
      return;
    }
  } catch (e) {
    console.error('خطأ في التعامل مع التفاعلات:', e);
  }
});
client.login(config.DISCORD_TOKEN);
