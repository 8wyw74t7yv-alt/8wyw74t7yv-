const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Audio effektlar ro'yxati va ularning standart ma'lumotlari
 */
const AUDIO_EFFECTS_LIST = [
  { key: 'bassBoost', title: '🔊 Bass Boost' },
  { key: 'slowed', title: '🐌 Slowed + Reverb' },
  { key: 'reverbEcho', title: '🏛 Reverb & Echo' },
  { key: 'binaural3d', title: '🎧 8D / Binaural 3D' },
  { key: 'eightD', title: '🔄 8D Pulsator' },
  { key: 'voiceIsolator', title: '🎤 Voice Isolator' },
  { key: 'noiseReduction', title: '🧹 Shovqinni tozalash' }
];

/**
 * Musiqaga yumshoq Echo va qiz bolaning yoqimli ovoziga o'zgartirilgan Voice Tag mix qilish 
 * (Asosiy musiqaning vaqti va tezligi o'zgartirilmaydi)
 */
function processAudioWithVoiceTag(inputPath, outputPath, startTagPath, endTagPath) {
  return new Promise((resolve, reject) => {
    const hasStartTag = startTagPath && fs.existsSync(startTagPath);
    const hasEndTag = endTagPath && fs.existsSync(endTagPath);

    if (!hasStartTag && !hasEndTag) {
      fs.copyFileSync(inputPath, outputPath);
      return resolve(outputPath);
    }

    let command = ffmpeg();
    let inputsCount = 0;

    if (hasStartTag) {
      command.input(startTagPath);
      inputsCount++;
    }

    command.input(inputPath);
    const mainIndex = inputsCount;
    inputsCount++;

    if (hasEndTag) {
      command.input(endTagPath);
      inputsCount++;
    }

    let filterComplex = [];

    // Ikkala audioning chastotasi bir xil bo'lishi uchun format
    const format = "aformat=sample_rates=44100:channel_layouts=stereo";

    // Voice tagni 01:00 daqiqada (60 soniya = 60000 millisekund) ijro etish sozlamasi
    const tagDelayMs = 60000;

    // 1. Asosiy musiqani o'z holatida (tezligini o'zgartirmasdan) olamiz
    let filterString = `[${mainIndex}:a]${format}[main_clean];`;

    // Qiz bolaning ovozini yoqimli va ehtirosli qilish uchun parametrlar
    const voiceFxChain = `volume=1.5,asetrate=44100*1.12,atempo=0.89,aecho=0.8:0.9:350|700:0.4|0.2,${format}`;

    // OVOZ PASAYISHI VA KO'TARILISHI (Ducking)
    const duckParams = "sidechaincompress=threshold=0.03:ratio=8:attack=800:release=2000";

    // 2. Agar faqat boshiga tag qo'shilsa
    if (hasStartTag && !hasEndTag) {
      filterString += 
        `[0:a]${voiceFxChain},adelay=${tagDelayMs}|${tagDelayMs},apad,asplit=2[tag_mix][tag_side];` +
        `[main_clean][tag_side]${duckParams}[main_ducked];` +
        `[main_ducked][tag_mix]amix=inputs=2:duration=first:weights=1 1:dropout_transition=2[outa]`;
    } 
    // 3. Agar faqat oxiriga tag qo'shilsa
    else if (!hasStartTag && hasEndTag) {
      const endTagIndex = mainIndex + 1;
      filterString += 
        `[${endTagIndex}:a]${voiceFxChain},adelay=${tagDelayMs}|${tagDelayMs},apad,asplit=2[tag_mix][tag_side];` +
        `[main_clean][tag_side]${duckParams}[main_ducked];` +
        `[main_ducked][tag_mix]amix=inputs=2:duration=first:weights=1 1:dropout_transition=2[outa]`;
    } 
    // 4. Ham boshiga, ham oxiriga qo'shilsa
    else if (hasStartTag && hasEndTag) {
      const endTagIndex = mainIndex + 1;
      filterString += 
        `[0:a]${voiceFxChain},adelay=0|0[start_tag];` +
        `[${endTagIndex}:a]${voiceFxChain},adelay=${tagDelayMs}|${tagDelayMs}[end_tag];` +
        `[start_tag][end_tag]amix=inputs=2[all_tags];` +
        `[all_tags]apad,asplit=2[tag_mix][tag_side];` +
        `[main_clean][tag_side]${duckParams}[main_ducked];` +
        `[main_ducked][tag_mix]amix=inputs=2:duration=first:weights=1 1:dropout_transition=2[outa]`;
    }

    filterComplex.push(filterString);

    command
      .complexFilter(filterComplex)
      .map('[outa]')
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

/**
 * Musiqani belgilangan vaqt oralig'ida kesish (Trim) va METADATALARNI TOZALASH
 * Sukut bo'yicha duration = 30 sekund.
 */
function trimAudio(inputPath, outputPath, startSeconds = 0, duration = 30) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startSeconds)
      .setDuration(duration)
      .outputOptions([
        '-map_metadata -1'
      ])
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

/**
 * Maxsus Audio Effektlarni Qo'llash
 * @param {string} inputPath - Kiruvchi audio manzili
 * @param {string} outputPath - Chiquvchi audio manzili
 * @param {Object} selectedEffects - Tanlangan effektlar darajasi (0-100 yoki boolean)
 * @param {number} duration - Audio davomiyligi (soniyada)
 */
function applyCustomAudioEffects(inputPath, outputPath, selectedEffects = {}, duration = 180) {
  return new Promise((resolve, reject) => {
    let filters = [];

    // 1. Shovqinni kamaytirish
    if (selectedEffects.noiseReduction) {
      filters.push("afftdn=nr=12:nf=-25");
    }

    // 2. Vokalni ajratish
    if (selectedEffects.voiceIsolator) {
      filters.push("pan=stereo|c0=c0-c1|c1=c0-c1");
    }

    // 3. Bass Boost
    if (selectedEffects.bassBoost) {
      const val = typeof selectedEffects.bassBoost === 'number' ? selectedEffects.bassBoost : 50;
      const gain = (val / 100) * 15; // 0-15 dB oralig'ida
      filters.push(`equalizer=f=60:width_type=h:width=50:g=${gain.toFixed(1)}`);
    }

    // 4. Slowed + Reverb
    if (selectedEffects.slowed) {
      filters.push("atempo=0.92,aecho=0.8:0.88:60|120:0.4|0.25");
    }

    // 5. Reverb & Echo
    if (selectedEffects.reverbEcho && !selectedEffects.slowed) {
      filters.push("aecho=0.8:0.88:60|120:0.4|0.25");
    }

    // 6. Binaural 3D Echo Chamber
    if (selectedEffects.binaural3d) {
      filters.push("aecho=0.8:0.9:1000|1800:0.3|0.25,apulsator=hz=0.08:amount=0.9");
    }

    // 7. 8D Audio
    if (selectedEffects.eightD && !selectedEffects.binaural3d) {
      filters.push("apulsator=hz=0.125:amount=1");
    }

    // 8. Mayin kirish va chiqish (Smooth Fade)
    if (selectedEffects.smoothFade !== false) {
      const fadeOutStart = Math.max(0, duration - 3);
      filters.push(`afade=t=in:ss=0:d=2,afade=t=out:st=${fadeOutStart}:d=3`);
    }

    // 9. EBU R128 Avtomatik Normalizatsiya
    if (selectedEffects.ebuNormalization !== false) {
      filters.push("loudnorm=I=-14:LRA=11:TP=-1.5");
    }

    let command = ffmpeg(inputPath);

    if (filters.length > 0) {
      command.audioFilters(filters.join(','));
    }

    command
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

module.exports = {
  AUDIO_EFFECTS_LIST,
  processAudioWithVoiceTag,
  trimAudio,
  applyCustomAudioEffects,
  processAdvancedEffects: applyCustomAudioEffects // Eskirgan nomlar mosligi uchun
};
