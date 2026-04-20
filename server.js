const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// مجلد المخرجات
const outputDir = path.join(__dirname, 'public', 'outputs');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// مجلد الرفع المؤقت
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// أصوات القراء من API مجاني (mp3quran.net)
const RECITERS = {
  'sudais':    { id: 'ar.abdurrahmaansudais', name: 'عبدالرحمن السديس' },
  'shuraim':   { id: 'ar.saoodashuraym',      name: 'سعود الشريم' },
  'ghamdi':    { id: 'ar.saadalghamdi',        name: 'سعد الغامدي' },
  'afasy':     { id: 'ar.alafasy',             name: 'مشاري العفاسي' },
  'ajamy':     { id: 'ar.ahmadibnali',         name: 'أحمد العجمي' },
  'hudhaify':  { id: 'ar.abdullaahmaaz',       name: 'علي الحذيفي' },
  'husary':    { id: 'ar.husary',              name: 'محمود خليل الحصري' },
  'minshawi':  { id: 'ar.minshawi',            name: 'محمد صديق المنشاوي' },
};

// أرقام السور
const SURAS = {
  'الفاتحة':1,'البقرة':2,'آل عمران':3,'النساء':4,'المائدة':5,
  'الأنعام':6,'الأعراف':7,'يس':36,'الرحمن':55,'الملك':67,
  'الكهف':18,'الواقعة':56,'الإخلاص':112,'الفلق':113,'الناس':114,
};

// جلب رابط صوت الشيخ
async function getAudioUrl(reciterId, surahNumber) {
  const surah = String(surahNumber).padStart(3, '0');
  const url = `https://cdn.islamic.network/quran/audio-surah/128/${reciterId}/${surahNumber}.mp3`;
  return url;
}

// تحميل الصوت
async function downloadAudio(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('فشل تحميل الصوت');
  const buffer = await res.buffer();
  fs.writeFileSync(dest, buffer);
}

// API إنشاء الفيديو
app.post('/api/create-video', upload.single('image'), async (req, res) => {
  const { sheikh, sura, ayat, effect } = req.body;
  const imagePath = req.file?.path;

  if (!imagePath) return res.status(400).json({ error: 'الرجاء رفع صورة' });
  if (!sheikh || !RECITERS[sheikh]) return res.status(400).json({ error: 'اختر قارئاً صحيحاً' });

  const surahNum = SURAS[sura] || 1;
  const reciter = RECITERS[sheikh];
  const audioPath = path.join(uploadDir, `audio_${Date.now()}.mp3`);
  const outputName = `video_${Date.now()}.mp4`;
  const outputPath = path.join(outputDir, outputName);

  try {
    // تحميل الصوت
    const audioUrl = await getAudioUrl(reciter.id, surahNum);
    await downloadAudio(audioUrl, audioPath);

    // مدة الصوت (تقريبية بناءً على عدد الآيات)
    const duration = Math.min(parseInt(ayat) * 15, 300);

    // إنشاء الفيديو بـ FFmpeg
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop 1'])
        .input(audioPath)
        .outputOptions([
          '-c:v libx264',
          '-tune stillimage',
          '-c:a aac',
          '-b:a 192k',
          '-pix_fmt yuv420p',
          `-t ${duration}`,
          '-shortest',
          '-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
          '-movflags +faststart'
        ]);

      // تأثير الصورة
      if (effect === 'zoom') {
        cmd.outputOptions([
          '-vf',
          `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,zoompan=z='min(zoom+0.0005,1.5)':d=${duration*25}:s=1080x1920`
        ]);
      }

      cmd
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // تنظيف الملفات المؤقتة
    fs.unlinkSync(imagePath);
    fs.unlinkSync(audioPath);

    res.json({
      success: true,
      videoUrl: `/outputs/${outputName}`,
      message: 'تم إنشاء الفيديو بنجاح!'
    });

  } catch (err) {
    console.error(err);
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الفيديو: ' + err.message });
  }
});

// قائمة الفيديوهات السابقة
app.get('/api/videos', (req, res) => {
  const files = fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.mp4'))
    .map(f => ({
      name: f,
      url: `/outputs/${f}`,
      date: fs.statSync(path.join(outputDir, f)).mtime
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(files);
});

app.listen(PORT, () => console.log(`✅ السيرفر يعمل على http://localhost:${PORT}`));
