const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Musiqaning boshiga va oxiriga Voice Tag qo'shish va optimizatsiya qilish
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
    let inputIndex = 0;

    if (hasStartTag) {
      command.input(startTagPath);
      inputIndex++;
    }

    command.input(inputPath);
    const mainAudioIndex = inputIndex;
    inputIndex++;

    if (hasEndTag) {
      command.input(endTagPath);
    }

    let concatInputs = '';
    let totalStreams = 0;

    if (hasStartTag) {
      concatInputs += '[0:a]';
      totalStreams++;
    }
    concatInputs += `[${mainAudioIndex}:a]`;
    totalStreams++;

    if (hasEndTag) {
      concatInputs += `[${inputIndex}:a]`;
      totalStreams++;
    }

    filterComplex.push(`${concatInputs}concat=n=${totalStreams}:v=0:a=1[outa]`);

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
 * Musiqani belgilangan vaqt oralig'ida kesish (Trim)
 * @param {string} inputPath - Asl fayl yo'li
 * @param {string} outputPath - Kesilgan fayl saqlanadigan yo'l
 * @param {number} startSeconds - Boshlanish vaqti (sekundda)
 * @param {number} duration - Davomiyligi (sekundda: end - start)
 */
function trimAudio(inputPath, outputPath, startSeconds, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startSeconds)
      .setDuration(duration)
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

module.exports = { processAudioWithVoiceTag, trimAudio };
