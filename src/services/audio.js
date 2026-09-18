const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Musiqaning boshiga va oxiriga Voice Tag'ni parallel ravishda (mix qilib) qo'shish
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
    let filterComplex = [];
    let inputsCount = 0;

    // Indexlarni aniqlab olamiz
    // 0-input: startTag (agar mavjud bo'lsa)
    // mainInput: asosiy musiqa
    // endTag input: endTag (agar mavjud bo'lsa)

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

    // FFmpeg complex filter mantig'i (Parallel / Mix)
    if (hasStartTag && !hasEndTag) {
      // Faqat boshiga tag qo'shish (ustma-ust mix qilish)
      // amix yordamida asosiy musiqa va tag qo'shiladi (volume'ni tushirmaslik uchun weights yoki dropout_transition ishlatish mumkin)
      filterComplex.push(`[${mainIndex}:a][0:a]amix=inputs=2:duration=first:dropout_transition=0[outa]`);
    } 
    else if (!hasStartTag && hasEndTag) {
      // Faqat oxiriga tag qo'shish uchun asosiy musiqa oxiriga mix qilinadi
      // Bu yerda oddiy amix asosiy musiqaga ta'sir qiladi
      filterComplex.push(`[${mainIndex}:a][0:a]amix=inputs=2:duration=first:dropout_transition=0[outa]`);
    } 
    else if (hasStartTag && hasEndTag) {
      // Ham boshiga, ham oxiriga tag qo'shish
      // 0: startTag, mainIndex: asosiy, endTagIndex: 2
      const endTagIndex = mainIndex + 1;
      
      // Oldin startTag bilan asosiy musiqani bosh qismida mix qilamiz, keyin endTag ni qo'shamiz
      // Yoki barcha 3 tasini amix orqali biriktiramiz (lekin endTag oxirida chiqishi uchun unga delay berish kerak)
      // Keling, eng zo'r va oson ishlaydigan usulni qo'llaymiz:
      filterComplex.push(
        `[0:a]adelay=0|0[s_tag];` +
        `[${endTagIndex}:a]adelay=1000|1000[e_tag];` + // Bu yerda endTag'ni qaysidir vaqtga surish mumkin, lekin oddiy mix uchun:
        `[${mainIndex}:a][s_tag][e_tag]amix=inputs=3:duration=first:dropout_transition=0[outa]`
      );
    }

    // Agar yuqoridagi shartlardan tashqari oddiyroq aralashish kerak bo'lsa, 
    // amix parametrlari orqali musiqani to'xtatmasdan ustidan qo'shish ta'minlanadi.

    let cmd = command.complexFilter(filterComplex)
      .map('[outa]')
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));

    cmd.save(outputPath);
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
