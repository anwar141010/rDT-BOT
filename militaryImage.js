const { createCanvas, loadImage } = require('canvas');

/**
 * توليد صورة عسكرية جماعية (جدول 10 عسكري)
 * @param {Array} users - مصفوفة العسكريين (max 10)
 *   كل عنصر: { fullName, code, rank, status } status: 'in' | 'out' | 'ended'
 * @param {Object} counters - { in: عدد, out: عدد, ended: عدد }
 * @returns {Promise<Buffer>} - صورة PNG
 */
async function generateMilitaryPageImage(users, counters) {
  // إعدادات الصورة
  const width = 1200;
  const height = 700;
  const rowHeight = 48;
  const tableTop = 170;
  const leftPad = 60;
  // توزيع الأعمدة: الحالة | الكود | الرتبة | الاسم (الاسم أكبر)
  const colWidths = [100, 170, 170, 600];
  const headerBg = '#1e293b';
  const tableBg = '#f1f5f9';
  const borderColor = '#64748b';
  const font = 'bold 26px Cairo, Arial';
  const fontSmall = '22px Cairo, Arial';

  // الألوان للحالات
  const statusColors = {
    in: '#22c55e',    // أخضر
    out: '#ef4444',   // أحمر
    ended: '#6b7280'  // رصاصي
  };

  // إنشاء canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // خلفية
  ctx.fillStyle = tableBg;
  ctx.fillRect(0, 0, width, height);

  // --- العدادات في الأعلى ---
  // دائرة خضراء (in)
  ctx.save();
  ctx.beginPath();
  ctx.arc(110, 70, 40, 0, 2 * Math.PI);
  ctx.fillStyle = statusColors.in;
  ctx.fill();
  ctx.font = 'bold 32px Cairo, Arial';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(counters.in || 0, 110, 70);
  ctx.restore();
  // دائرة حمراء (out)
  ctx.save();
  ctx.beginPath();
  ctx.arc(220, 70, 40, 0, 2 * Math.PI);
  ctx.fillStyle = statusColors.out;
  ctx.fill();
  ctx.font = 'bold 32px Cairo, Arial';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(counters.out || 0, 220, 70);
  ctx.restore();
  // دائرة رصاصية (ended)
  ctx.save();
  ctx.beginPath();
  ctx.arc(330, 70, 40, 0, 2 * Math.PI);
  ctx.fillStyle = statusColors.ended;
  ctx.fill();
  ctx.font = 'bold 32px Cairo, Arial';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(counters.ended || 0, 330, 70);
  ctx.restore();

  // --- عنوان الجدول ---
  ctx.font = 'bold 38px Cairo, Arial';
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'right';
  ctx.fillText('جدول مباشرة العسكر', width - 60, 60);

  // --- رأس الجدول ---
  ctx.fillStyle = headerBg;
  ctx.fillRect(leftPad, tableTop, width - 2 * leftPad, rowHeight);
  ctx.font = font;
  ctx.fillStyle = '#fff';
  // توزيع رؤوس الأعمدة: الحالة | الكود | الرتبة | الاسم
  let x = leftPad;
  // الحالة
  ctx.textAlign = 'center';
  ctx.fillText('الحالة', x + colWidths[0] / 2, tableTop + rowHeight / 2);
  x += colWidths[0];
  // الكود العسكري
  ctx.textAlign = 'center';
  ctx.fillText('الكود العسكري', x + colWidths[1] / 2, tableTop + rowHeight / 2);
  x += colWidths[1];
  // الرتبة العسكرية
  ctx.textAlign = 'center';
  ctx.fillText('الرتبة العسكرية', x + colWidths[2] / 2, tableTop + rowHeight / 2);
  x += colWidths[2];
  // الاسم (محاذاة أقصى اليمين)
  ctx.textAlign = 'right';
  ctx.fillText('الاسم', x + colWidths[3] - 16, tableTop + rowHeight / 2);

  // --- صفوف العسكريين ---
  for (let i = 0; i < 10; i++) {
    const y = tableTop + rowHeight * (i + 1);
    ctx.fillStyle = i % 2 === 0 ? '#e2e8f0' : '#f8fafc';
    ctx.fillRect(leftPad, y, width - 2 * leftPad, rowHeight);
    if (users[i]) {
      const user = users[i];
      let x = leftPad;
      // الحالة (دائرة ملونة)
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + colWidths[0] / 2, y + rowHeight / 2, 16, 0, 2 * Math.PI);
      ctx.fillStyle = statusColors[user.status] || '#d1d5db';
      ctx.fill();
      ctx.restore();
      x += colWidths[0];
      // الكود العسكري
      ctx.font = fontSmall;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.fillText(user.code || '-', x + colWidths[1] / 2, y + rowHeight / 2);
      x += colWidths[1];
      // الرتبة العسكرية
      ctx.textAlign = 'center';
      ctx.fillText(user.rank || '-', x + colWidths[2] / 2, y + rowHeight / 2);
      x += colWidths[2];
      // الاسم
      ctx.textAlign = 'right';
      ctx.fillText(user.fullName || '-', x + colWidths[3] - 16, y + rowHeight / 2);
    }
  }

  // --- حدود الجدول ---
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(leftPad, tableTop, width - 2 * leftPad, rowHeight * 11);

  return canvas.toBuffer('image/png');
}

module.exports = { generateMilitaryPageImage }; 