const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Audio effektlar ro'yxati va ularning standart ma'lumotlari
 */
const AUDIO_EFFECTS_LIST = [
  { key: 'slowed', title: '🐌 Slowed' },
  { key: 'bassBoost', title: '🔊 Bass Boost' },
  { key: 'ebuNormalization', title: '📊 EBU Normalization' },
  { key: 'smoothFade', title: '🎚 Smooth Fade In & Out' },
  { key: 'voiceIsolator', title: '🎤 Voice Isolator' },
  { key: 'eightD', title: '🎧 8D Audio' },
  { key: 'reverbEcho', title: '🏛 Reverb & Echo' },
  { key: 'pure3D', title: '🌌 Pure 3D Spatial Audio' },
  { key: 'nightcore', title: '⚡️ Nightcore' },
  { key: 'speedUp', title: '🚀 Speed Up' },
  { key: 'trebleBoost', title: '🎼 Treble Boost' },
  { key: 'vaporwave', title: '🌴 Vaporwave' },
  { key: 'stereoEnhancer', title: '↔️ Stereo Enhancer' },
  { key: 'flanger', title: '🌊 Flanger Effect' },
  { key: 'chorus', title: '👥 Chorus Ensemble' },
  { key: 'telephoneFilter', title: '📞 Old Telephone' },
  { key: 'muffledConcert', title: '🚪 Concert Bathroom' },
  { key: 'pitchShiftHigh', title: '🐿 Chipmunk Pitch' },
  { key: 'pitchShiftLow', title: '👹 Deep Monster Voice' },
  { key: 'phaser', title: '🛸 Phaser Space Sweep' },
  { key: 'distortedOverdrive', title: '🎸 Heavy Distortion' },
  { key: 'underwater', title: '🌊 Deep Underwater' },
  { key: 'radioAM', title: '📻 AM Vintage Radio' }
];

/**
 * Musiqaga Voice Tag mix qilish va ducking (audio pasaytirish) effektini qo'llash
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
    const format = "aformat=sample_rates=44100:channel_layouts=stereo";
    const tagDelayMs = 60000; // 1 daqiqada ovoz tegini ijro etish

    let filterString = `[${mainIndex}:a]${format}[main_clean];`;
    const voiceFxChain = `volume=1.5,asetrate=44100*1.12,atempo=0.89,aecho=0.8:0.9:350|700:0.4|0.2,${format}`;
    const duckParams = "sidechaincompress=threshold=0.03:ratio=8:attack=800:release=2000";

    if (hasStartTag && !hasEndTag) {
      filterString += 
        `[0:a]${voiceFxChain},adelay=${tagDelayMs}|${tagDelayMs},apad,asplit=2[tag_mix][tag_side];` +
        `[main_clean][tag_side]${duckParams}[main_ducked];` +
        `[main_ducked][tag_mix]amix=inputs=2:duration=first:weights=1 1:dropout_transition=2[outa]`;
    } 
    else if (!hasStartTag && hasEndTag) {
      const endTagIndex = mainIndex + 1;
      filterString += 
        `[${endTagIndex}:a]${voiceFxChain},adelay=${tagDelayMs}|${tagDelayMs},apad,asplit=2[tag_mix][tag_side];` +
        `[main_clean][tag_side]${duckParams}[main_ducked];` +
        `[main_ducked][tag_mix]amix=inputs=2:duration=first:weights=1 1:dropout_transition=2[outa]`;
    } 
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
 * Musiqani kesish (Trim) va metadata tozalash
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
 * Maxsus Audio Effektlarni intensivlikka (0-100%) qarab dinamik qo'llash
 */
function applyCustomAudioEffects(inputPath, outputPath, effectIntensities = {}, duration = 180) {
  return new Promise((resolve, reject) => {
    let filters = [];

    // 1. Slowed
    if (effectIntensities.slowed > 0) {
      const val = effectIntensities.slowed;
      const speed = (1.0 - (val / 100) * 0.5).toFixed(2);
      filters.push(`atempo=${speed}`);
    }

    // 2. Bass Boost
    if (effectIntensities.bassBoost > 0) {
      const val = effectIntensities.bassBoost;
      const gain = Math.round((val / 100) * 25);
      filters.push(`equalizer=f=60:width_type=h:width=50:g=${gain}`);
    }

    // 3. EBU Normalization
    if (effectIntensities.ebuNormalization > 0) {
      const val = effectIntensities.ebuNormalization;
      const lufs = (-24 + (val / 100) * 16).toFixed(1);
      filters.push(`loudnorm=I=${lufs}:LRA=11:TP=-1.5`);
    }

    // 4. Smooth Fade
    if (effectIntensities.smoothFade > 0) {
      const val = effectIntensities.smoothFade;
      const dur = duration || 180;
      const fadeDur = Math.max(0.5, ((val / 100) * 10)).toFixed(1);
      const fadeOutStart = Math.max(0, dur - fadeDur).toFixed(1);
      filters.push(`afade=t=in:ss=0:d=${fadeDur},afade=t=out:st=${fadeOutStart}:d=${fadeDur}`);
    }

    // 5. Voice Isolator
    if (effectIntensities.voiceIsolator > 0) {
      const val = effectIntensities.voiceIsolator;
      const hp = Math.round(100 + (val / 100) * 200);
      const lp = Math.round(8000 - (val / 100) * 4000);
      filters.push(`highpass=f=${hp},lowpass=f=${lp}`);
    }

    // 6. 8D Audio
    if (effectIntensities.eightD > 0) {
      const val = effectIntensities.eightD;
      const hz = (0.05 + (val / 100) * 0.75).toFixed(3);
      filters.push(`apulsator=hz=${hz}:amount=1`);
    }

    // 7. Reverb & Echo
    if (effectIntensities.reverbEcho > 0) {
      const val = effectIntensities.reverbEcho;
      const delay = Math.round(20 + (val / 100) * 180);
      const decay = (0.1 + (val / 100) * 0.75).toFixed(2);
      filters.push(`aecho=0.8:0.88:${delay}:${decay}`);
    }

    // 8. Pure 3D Spatial Audio
    if (effectIntensities.pure3D > 0) {
      const val = effectIntensities.pure3D;
      const hz = (0.03 + (val / 100) * 0.4).toFixed(3);
      const width = (1.0 + (val / 100) * 2.0).toFixed(2);
      filters.push(`apulsator=hz=${hz}:amount=0.85,extrastereo=m=${width}`);
    }

    // 9. Nightcore
    if (effectIntensities.nightcore > 0) {
      const val = effectIntensities.nightcore;
      const speed = (1.05 + (val / 100) * 0.55).toFixed(2);
      filters.push(`asetrate=44100*${speed},aresample=44100,atempo=1.0`);
    }

    // 10. Speed Up
    if (effectIntensities.speedUp > 0) {
      const val = effectIntensities.speedUp;
      const speed = (1.05 + (val / 100) * 0.95).toFixed(2);
      filters.push(`atempo=${speed}`);
    }

    // 11. Treble Boost
    if (effectIntensities.trebleBoost > 0) {
      const val = effectIntensities.trebleBoost;
      const gain = Math.round((val / 100) * 20);
      filters.push(`equalizer=f=10000:width_type=h:width=1000:g=${gain}`);
    }

    // 12. Vaporwave
    if (effectIntensities.vaporwave > 0) {
      const val = effectIntensities.vaporwave;
      const speed = (0.95 - (val / 100) * 0.25).toFixed(2);
      filters.push(`asetrate=44100*${speed},aresample=44100,lowpass=f=3500`);
    }

    // 13. Stereo Enhancer
    if (effectIntensities.stereoEnhancer > 0) {
      const val = effectIntensities.stereoEnhancer;
      const m = (1.1 + (val / 100) * 2.4).toFixed(1);
      filters.push(`extrastereo=m=${m}`);
    }

    // 14. Flanger
    if (effectIntensities.flanger > 0) {
      const val = effectIntensities.flanger;
      const depth = (1 + (val / 100) * 9).toFixed(1);
      const speed = (0.1 + (val / 100) * 1.9).toFixed(1);
      filters.push(`flanger=delay=${depth}:speed=${speed}`);
    }

    // 15. Chorus
    if (effectIntensities.chorus > 0) {
      const val = effectIntensities.chorus;
      const delay = Math.round(20 + (val / 100) * 40);
      const decay = (0.2 + (val / 100) * 0.6).toFixed(2);
      filters.push(`chorus=0.7:0.9:${delay}:${decay}:0.25:2`);
    }

    // 16. Telephone Filter
    if (effectIntensities.telephoneFilter > 0) {
      const val = effectIntensities.telephoneFilter;
      const low = Math.round(300 + (val / 100) * 400);
      const high = Math.round(3400 - (val / 100) * 1400);
      filters.push(`highpass=f=${low},lowpass=f=${high}`);
    }

    // 17. Muffled Concert
    if (effectIntensities.muffledConcert > 0) {
      const val = effectIntensities.muffledConcert;
      const lp = Math.round(2000 - (val / 100) * 1600);
      filters.push(`lowpass=f=${lp},aecho=0.8:0.88:40:0.4`);
    }

    // 18. Pitch Shift High
    if (effectIntensities.pitchShiftHigh > 0) {
      const val = effectIntensities.pitchShiftHigh;
      const pitch = (1.05 + (val / 100) * 0.95).toFixed(2);
      filters.push(`asetrate=44100*${pitch},aresample=44100`);
    }

    // 19. Pitch Shift Low
    if (effectIntensities.pitchShiftLow > 0) {
      const val = effectIntensities.pitchShiftLow;
      const pitch = (0.95 - (val / 100) * 0.45).toFixed(2);
      filters.push(`asetrate=44100*${pitch},aresample=44100`);
    }

    // 20. Phaser
    if (effectIntensities.phaser > 0) {
      const val = effectIntensities.phaser;
      const speed = (0.1 + (val / 100) * 2.0).toFixed(1);
      const decay = (0.2 + (val / 100) * 0.7).toFixed(2);
      filters.push(`aphaser=in_gain=0.8:out_gain=0.74:delay=3:decay=${decay}:speed=${speed}`);
    }

    // 21. Heavy Distortion
    if (effectIntensities.distortedOverdrive > 0) {
      const val = effectIntensities.distortedOverdrive;
      const drive = Math.round(5 + (val / 100) * 80);
      filters.push(`acrusher=level_in=1:level_out=1:bits=16:mode=log:anti_aliasing=1,volume=${drive}dB`);
    }

    // 22. Deep Underwater
    if (effectIntensities.underwater > 0) {
      const val = effectIntensities.underwater;
      const lp = Math.round(1200 - (val / 100) * 900);
      filters.push(`lowpass=f=${lp},volume=1.5`);
    }

    // 23. AM Vintage Radio
    if (effectIntensities.radioAM > 0) {
      const val = effectIntensities.radioAM;
      const hp = Math.round(400 + (val / 100) * 400);
      const lp = Math.round(2500 - (val / 100) * 1000);
      filters.push(`highpass=f=${hp},lowpass=f=${lp},volume=1.3`);
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
  processAdvancedEffects: applyCustomAudioEffects
};
