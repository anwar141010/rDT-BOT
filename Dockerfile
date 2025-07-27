# استخدم صورة Node.js أساسية
FROM node:20-slim

# تعيين دليل العمل داخل الحاوية
WORKDIR /app

# نسخ ملفات المشروع إلى دليل العمل
COPY . .

# تثبيت التبعيات المطلوبة لـ Canvas (التي كانت في render-build.sh)
# هذه الأوامر ستعمل كجذر داخل Dockerfile
RUN apt-get update && \
    apt-get install -y \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    build-essential \
    g++ && \
    rm -rf /var/lib/apt/lists/*

# تثبيت تبعيات Node.js
RUN npm install

# أمر بدء تشغيل البوت
CMD ["npm", "start"] 