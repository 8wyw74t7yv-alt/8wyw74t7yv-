const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Musiqaga Slowed effekti, kuchli Echo va baland Voice Tag’ni professional darajada mix qilish
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

    // 1. Asosiy musiqani ozroq sekinlashtiramiz (Slowed effekti)
    let filterString = `[${mainIndex}:a]atempo=0.93[main_slow];`;

    // 2. Agar faqat boshiga tag qo'shilsa
    if (hasStartTag && !hasEndTag) {
      filterString += 
        `[0:a]volume=1.8,aecho=0.8:0.9:150|250:0.5|0.4[tag_fx];` +
        `[main_slow][tag_fx]amix=inputs=2:duration=first:weights=1 0.8:dropout_transition=2[outa]`;
    } 
    // 3. Agar faqat oxiriga tag qo'shilsa
    else if (!hasStartTag && hasEndTag) {
      const endTagInputIndex = mainIndex; 
      filterString += 
        `[${endTagInputIndex}:a]volume=1.8,aecho=0.8:0.9:150|250:0.5|0.4[tag_fx];` +
        `[main_slow][tag_fx]amix=inputs=2:duration=first:weights=1 0.8:dropout_transition=2[outa]`;
    } 
    // 4. Ham boshiga, ham oxiriga qo'shilsa
    else if (hasStartTag && hasEndTag) {
      const endTagIndex = mainIndex + 1;
      filterString += 
        `[0:a]volume=1.8,aecho=0.8:0.9:150|250:0.5|0.4[s_tag];` +
        `[${endTagIndex}:a]volume=1.8,aecho=0.8:0.9:150|250:0.5|0.4[e_tag];` +
        `[main_slow][s_tag][e_tag]amix=inputs=3:duration=first:weights=1 0.7 0.7:dropout_transition=2[outa]`;
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
