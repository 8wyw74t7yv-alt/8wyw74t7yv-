const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

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

    // 1. Asosiy musiqani o'z holatida (tezligini o'zgartirmasdan) olamiz
    let filterString = `[${mainIndex}:a]${format}[main_clean];`;

    // Qiz bolaning ovozini yoqimli va ehtirosli qilish uchun parametrlar
    const voiceFxChain = `volume=1.5,asetrate=44100*1.12,atempo=0.89,aecho=0.8:0.9:350|700:0.4|0.2,${format}`;

    // OVOZ PASAYISHI VA KO'TARILISHI (Ducking)
    const duckParams = "sidechaincompress=threshold=0.03:ratio=8:attack=800:release=2000";

    // 2. Agar faqat boshiga tag qo'shilsa
    if (hasStartTag && !hasEndTag) {
      filterString += 
        `[0:a]${voiceFxChain},adelay=10000|10000,apad,asplit=2[tag_mix][tag_side];` +
        `[main_clean][tag_side]${duckParams}[main_ducked];` +
        `[main_ducked][tag_mix]amix=inputs=2:duration=first:weights=1 1:dropout_transition=2[outa]`;
    } 
    // 3. Agar faqat oxiriga tag qo'shilsa
    else if (!hasStartTag && hasEndTag) {
      const endTagIndex = mainIndex + 1;
      filterString += 
        `[${endTagIndex}:a]${voiceFxChain},adelay=10000|10000,apad,asplit=2[tag_mix][tag_side];` +
        `[main_clean][tag_side]${duckParams}[main_ducked];` +
        `[main_ducked][tag_mix]amix=inputs=2:duration=first:weights=1 1:dropout_transition=2[outa]`;
    } 
    // 4. Ham boshiga, ham oxiriga qo'shilsa
    else if (hasStartTag && hasEndTag) {
      const endTagIndex = mainIndex + 1;
      filterString += 
        `[0:a]${voiceFxChain},adelay=10000|10000,apad,asplit=2[tag_mix][tag_side];` +
        `[${endTagIndex}:a]anullsink;` +
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
 * Musiqani belgilangan vaqt oralig'ida kesish (Trim) va BARCHA METADATALARNI TOZALASH
 */
function trimAudio(inputPath, outputPath, startSeconds, duration) {
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

module.exports = {
  processAudioWithVoiceTag,
  trimAudio
};
