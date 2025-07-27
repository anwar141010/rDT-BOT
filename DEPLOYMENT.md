# 🚀 دليل نشر بوت MDT على Render

## 📋 المتطلبات الأساسية

- حساب GitHub
- حساب Render.com
- Discord Bot Token

## 🔧 خطوات النشر

### 1. إعداد GitHub Repository

1. أنشئ repository جديد على GitHub
2. ارفع جميع ملفات المشروع:
   ```
   ├── index.js
   ├── config.js
   ├── package.json
   ├── render-build.sh
   ├── militaryImage.js
   ├── README.md
   ├── .gitignore
   └── DEPLOYMENT.md
   ```

### 2. إعداد Render

1. اذهب إلى [render.com](https://render.com)
2. سجل دخول أو أنشئ حساب جديد
3. اربط حساب GitHub

### 3. إنشاء Web Service

1. اضغط "New +" → "Web Service"
2. اختر repository الخاص بك
3. املأ الإعدادات:

```
Name: MDT-Bot
Environment: Node
Region: Frankfurt (EU Central)
Branch: main
Build Command: chmod +x render-build.sh && ./render-build.sh
Start Command: npm start
```

### 4. إعداد متغيرات البيئة

في Render، أضف هذه المتغيرات:

```
DISCORD_TOKEN=your_discord_bot_token_here
BOT_ID=your_bot_id_here
```

### 5. إعدادات إضافية

- **Auto-Deploy**: مفعل
- **Health Check Path**: `/`
- **Health Check Timeout**: 180

## 🔍 حل المشاكل الشائعة

### مشكلة Canvas
إذا واجهت مشاكل مع Canvas، تأكد من:
- وجود ملف `render-build.sh`
- تثبيت المكتبات المطلوبة

### مشكلة البيانات
- تأكد من أن `data.json` موجود في `.gitignore`
- البيانات ستُحفظ تلقائياً في Render

### مشكلة الأوامر
- تأكد من تسجيل الأوامر في Discord Developer Portal
- تأكد من صلاحيات البوت

## 📊 مراقبة البوت

### Logs في Render
- اذهب إلى Web Service
- اضغط على "Logs"
- راقب الأخطاء والرسائل

### حالة البوت
- استخدم أمر `/المطور` للتحقق من حالة البوت
- راقب رسائل التشغيل في Logs

## 🔄 التحديثات

للتحديث:
1. ارفع التغييرات إلى GitHub
2. Render سيقوم بالتحديث تلقائياً
3. راقب Logs للتأكد من نجاح التحديث

## 🛡️ الأمان

- لا تشارك Discord Token
- استخدم متغيرات البيئة
- راقب Logs بانتظام
- احتفظ بنسخة احتياطية من البيانات

## 📞 الدعم

إذا واجهت مشاكل:
1. راجع Logs في Render
2. تأكد من صحة الإعدادات
3. تحقق من صلاحيات البوت في Discord 