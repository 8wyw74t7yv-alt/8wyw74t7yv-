const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Musiqaning boshiga va oxiriga Voice Tag'ni professional studiya effektlari bilan mix qilish
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

    // 1. Agar faqat boshiga tag qo'shilsa
    if (hasStartTag && !hasEndTag) {
      // [0:a] - startTag, [1:a] - mainAudio
      filterComplex.push(
        // Tag ovoziga professional echo va biroz balandlik beramiz
        `[0:a]volume=1.2,aecho=0.8:0.88:80:0.3[tag_fx];` +
        // Asosiy musiqa ovozini o'z holatida ushlab, tag bilan mix qilamiz
        `[${mainIndex}:a][tag_fx]amix=inputs=2:duration=first:weights=1 0.7:dropout_transition=2[outa]`
      );
    }
    // 2. Agar faqat oxiriga tag qo'shilsa
    else if (!hasStartTag && hasEndTag) {
      const endTagInputIndex = mainIndex; // yoki oxirgi kiruvchi
      filterComplex.push(
        `[${endTagInputIndex}:a]volume=1.2,aecho=0.8:0.88:80:0.3[tag_fx];` +
        `[${mainIndex}:a][tag_fx]amix=inputs=2:duration=first:weights=1 0.7:dropout_transition=2[outa]`
      );
    }
    // 3. Ham boshiga, ham oxiriga qo'shilsa
    else if (hasStartTag && hasEndTag) {
      const endTagIndex = mainIndex + 1;
      filterComplex.push(
        // Start tag uchun effekt
        `[0:a]volume=1.2,aecho=0.8:0.88:80:0.3[s_tag];` +
        // End tag uchun effekt
        `[${endTagIndex}:a]volume=1.2,aecho=0.8:0.88:80:0.3[e_tag];` +
        // Hammasini asosiy musiqa bilan birga professional mix qilamiz
        `[${mainIndex}:a][s_tag][e_tag]amix=inputs=3:duration=first:weights=1 0.6 0.6:dropout_transition=2[outa]`
      );
    }

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
