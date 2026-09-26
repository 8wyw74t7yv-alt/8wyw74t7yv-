const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * 50 ta Professional Audio Effektlar Ro'yxati (O'zbek tilida va emojilar bilan)
 */
const AUDIO_EFFECTS_LIST = [
  // Standart va mashhur effektlar (1-23)
  { key: 'slowed', title: '🐌 Sekinlashtirilgan (Slowed)' },
  { key: 'bassBoost', title: '🔊 Kuchli Bass (Bass Boost)' },
  { key: 'ebuNormalization', title: '📊 Ovoz Balanslash (Normalization)' },
  { key: 'smoothFade', title: '🎚 Mayin Kirish va Chiqish (Fade)' },
  { key: 'voiceIsolator', title: '🎤 Vokalni Ajratish (Voice Isolator)' },
  { key: 'eightD', title: '🎧 8D Ovoz (8D Audio)' },
  { key: 'reverbEcho', title: '🏛 Aks-sado va Reverb' },
  { key: 'pure3D', title: '🌌 3D Fazo Ketma-ketligi' },
  { key: 'nightcore', title: '⚡️ Taym-ap va Pitchni Kotarish (Nightcore)' },
  { key: 'speedUp', title: '🚀 Tezlashtirilgan (Speed Up)' },
  { key: 'trebleBoost', title: '🎼 Yuqori Chastotalarni Kuchaytirish' },
  { key: 'vaporwave', title: '🌴 Retrowave / Vaporwave Style' },
  { key: 'stereoEnhancer', title: '↔️ Stereo Kengaytirgich' },
  { key: 'flanger', title: '🌊 Flanger Tolqin Effekti' },
  { key: 'chorus', title: '👥 Xor va Ko‘p Ovozli Effekt' },
  { key: 'telephoneFilter', title: '📞 Eski Telefon Efiri' },
  { key: 'muffledConcert', title: '🚪 Yopiq Zal / Eshik Ortidan' },
  { key: 'pitchShiftHigh', title: '🐿 Moylali Ovoz (Chipmunk)' },
  { key: 'pitchShiftLow', title: '👹 Maxluq Ovozi (Monster Deep)' },
  { key: 'phaser', title: '🛸 Kosmik Faza Siljishi' },
  { key: 'distortedOverdrive', title: '🎸 Kuchli Distorshn / Gitara' },
  { key: 'underwater', title: '🌊 Suv Osti Effekti' },
  { key: 'radioAM', title: '📻 AM Antikvar Radio' },

  // Yangi qo'shilgan 27 ta professional effektlar (24-50)
  { key: 'vinylCrackle', title: '🎛 Vinil Plastinka Shovqini' },
  { key: 'lofiChill', title: '☕️ Lo-Fi Chill Atmosfera' },
  { key: 'tapeSaturation', title: '📼 Analog Tasma Issiqligi' },
  { key: 'stutterGate', title: 'Ritmik Uzilish (Stutter Gate)' },
  { key: 'pingPongDelay', title: '🏓 Ping-Pong Sado (Chap-ōng)' },
  { key: 'subBassEnhancer', title: '🔉 Teratib Yuboruvchi Sub-Bass' },
  { key: 'airTreble', title: '✨ Kristal Tiniq Yuqori Chastota' },
  { key: 'bitcrusher', title: '👾 8-Bit Retro Oyin Ovozi' },
  { key: 'reverseReverb', title: '🔄 Teskari Reverb Kirish' },
  { key: 'robotVoice', title: '🤖 Robotik Ovoz (Ring Modulator)' },
  { key: 'autoWah', title: '🎷 Dinamik Auto-Wah Filtri' },
  { key: 'stereoTremolo', title: '📳 Titroq Ovoz (Tremolo)' },
  { key: 'dynamicCompressor', title: '🎙 Studiya Kompressori' },
  { key: 'deEsser', title: '🔕 "S" Shovqinini Bosish (De-Esser)' },
  { key: 'stadiumEcho', title: '🏟 Ulkan Stadion Aks-sadosi' },
  { key: 'megaBassDrive', title: '💥 Ekstremal Avto-Bass' },
  { key: 'alienPitch', title: 'Ozga Sayyoralik Ovoz' },
  { key: 'slowedReverb', title: '🌧 Sekinlashtirilgan + Reverb (Sad Vibes)' },
  { key: 'drill808', title: '🎤 Drill Style 808 Bass' },
  { key: 'cinemaTrailer', title: '🎬 Kinematik Treyler Atmosferasi' },
  { key: 'wideSpreader', title: '🎛 Ota Keng Stereo Maydon' },
  { key: 'tunnelReverb', title: '🚇 Tonnell Ichidagi Ovoz' },
  { key: 'tapeStop', title: '⏸ Kassetani Toxtatish Effekti' },
  { key: 'exciterMix', title: '🔥 Yorqinlik va Tiniqlik Qoshish' },
  { key: 'psychedelicPan', title: '🌀 Psixodelik Aylanish' },
  { key: 'megaphone', title: '📣 Megafon / Ropor Ovozi' },
  { key: 'ambientPad', title: '☁️ Yumshoq Ambiant Atmosfera' }
];

/**
 * Tag ovozini belgilangan aniq vaqtda (sekund) qo'shish va fon musiqasini pasaytirish (Ducking)
 */
function processAudioWithVoiceTag(inputPath, outputPath, tagPath, tagTimeSeconds = 0) {
  return new Promise((resolve, reject) => {
    if (!tagPath || !fs.existsSync(tagPath)) {
      fs.copyFileSync(inputPath, outputPath);
      return resolve(outputPath);
    }

    const tagDelayMs = Math.max(0, Math.round(tagTimeSeconds * 1000));
    const format = "aformat=sample_rates=44100:channel_layouts=stereo";

    // Tag ovozini ishlov berish va kerakli vaqtga ko'chirish
    const filterComplex = [
      `[0:a]${format}[main_clean];`,
      `[1:a]volume=1.5,asetrate=44100*1.08,atempo=0.93,aecho=0.8:0.88:200:0.3,${format},adelay=${tagDelayMs}|${tagDelayMs},apad,asplit=2[tag_mix][tag_side];`,
      `[main_clean][tag_side]sidechaincompress=threshold=0.03:ratio=8:attack=600:release=1500[main_ducked];`,
      `[main_ducked][tag_mix]amix=inputs=2:duration=first:weights=1 1:dropout_transition=2[outa]`
    ].join('');

    ffmpeg()
      .input(inputPath)
      .input(tagPath)
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
 * Musiqani kesish (Trim) va metadatasini tozalash
 */
function trimAudio(inputPath, outputPath, startSeconds = 0, duration = 30) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startSeconds)
      .setDuration(duration)
      .outputOptions(['-map_metadata -1'])
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

/**
 * 50 ta Effektni intensivlikka (0-100%) qarab dinamik qo'llash
 */
function applyCustomAudioEffects(inputPath, outputPath, effectIntensities = {}, duration = 180) {
  return new Promise((resolve, reject) => {
    let filters = [];

    // 1. Slowed
    if (effectIntensities.slowed > 0) {
      const val = effectIntensities.slowed;
      const speed = (1.0 - (val / 100) * 0.45).toFixed(2);
      filters.push(`atempo=${speed}`);
    }
    // 2. Bass Boost
    if (effectIntensities.bassBoost > 0) {
      const gain = Math.round((effectIntensities.bassBoost / 100) * 25);
      filters.push(`equalizer=f=60:width_type=h:width=50:g=${gain}`);
    }
    // 3. EBU Normalization
    if (effectIntensities.ebuNormalization > 0) {
      const lufs = (-24 + (effectIntensities.ebuNormalization / 100) * 16).toFixed(1);
      filters.push(`loudnorm=I=${lufs}:LRA=11:TP=-1.5`);
    }
    // 4. Smooth Fade
    if (effectIntensities.smoothFade > 0) {
      const fadeDur = Math.max(0.5, ((effectIntensities.smoothFade / 100) * 10)).toFixed(1);
      const fadeOutStart = Math.max(0, duration - fadeDur).toFixed(1);
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
      const hz = (0.05 + (effectIntensities.eightD / 100) * 0.75).toFixed(3);
      filters.push(`apulsator=hz=${hz}:amount=1`);
    }
    // 7. Reverb Echo
    if (effectIntensities.reverbEcho > 0) {
      const val = effectIntensities.reverbEcho;
      const delay = Math.round(20 + (val / 100) * 180);
      const decay = (0.1 + (val / 100) * 0.75).toFixed(2);
      filters.push(`aecho=0.8:0.88:${delay}:${decay}`);
    }
    // 8. Pure 3D
    if (effectIntensities.pure3D > 0) {
      const val = effectIntensities.pure3D;
      const hz = (0.03 + (val / 100) * 0.4).toFixed(3);
      const width = (1.0 + (val / 100) * 2.0).toFixed(2);
      filters.push(`apulsator=hz=${hz}:amount=0.85,extrastereo=m=${width}`);
    }
    // 9. Nightcore
    if (effectIntensities.nightcore > 0) {
      const speed = (1.05 + (effectIntensities.nightcore / 100) * 0.55).toFixed(2);
      filters.push(`asetrate=44100*${speed},aresample=44100,atempo=1.0`);
    }
    // 10. Speed Up
    if (effectIntensities.speedUp > 0) {
      const speed = (1.05 + (effectIntensities.speedUp / 100) * 0.95).toFixed(2);
      filters.push(`atempo=${speed}`);
    }
    // 11. Treble Boost
    if (effectIntensities.trebleBoost > 0) {
      const gain = Math.round((effectIntensities.trebleBoost / 100) * 20);
      filters.push(`equalizer=f=10000:width_type=h:width=1000:g=${gain}`);
    }
    // 12. Vaporwave
    if (effectIntensities.vaporwave > 0) {
      const speed = (0.95 - (effectIntensities.vaporwave / 100) * 0.25).toFixed(2);
      filters.push(`asetrate=44100*${speed},aresample=44100,lowpass=f=3500`);
    }
    // 13. Stereo Enhancer
    if (effectIntensities.stereoEnhancer > 0) {
      const m = (1.1 + (effectIntensities.stereoEnhancer / 100) * 2.4).toFixed(1);
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
      const lp = Math.round(2000 - (effectIntensities.muffledConcert / 100) * 1600);
      filters.push(`lowpass=f=${lp},aecho=0.8:0.88:40:0.4`);
    }
    // 18. Pitch Shift High
    if (effectIntensities.pitchShiftHigh > 0) {
      const pitch = (1.05 + (effectIntensities.pitchShiftHigh / 100) * 0.95).toFixed(2);
      filters.push(`asetrate=44100*${pitch},aresample=44100`);
    }
    // 19. Pitch Shift Low
    if (effectIntensities.pitchShiftLow > 0) {
      const pitch = (0.95 - (effectIntensities.pitchShiftLow / 100) * 0.45).toFixed(2);
      filters.push(`asetrate=44100*${pitch},aresample=44100`);
    }
    // 20. Phaser
    if (effectIntensities.phaser > 0) {
      const val = effectIntensities.phaser;
      const speed = (0.1 + (val / 100) * 2.0).toFixed(1);
      const decay = (0.2 + (val / 100) * 0.7).toFixed(2);
      filters.push(`aphaser=in_gain=0.8:out_gain=0.74:delay=3:decay=${decay}:speed=${speed}`);
    }
    // 21. Distorted Overdrive
    if (effectIntensities.distortedOverdrive > 0) {
      const drive = Math.round(5 + (effectIntensities.distortedOverdrive / 100) * 80);
      filters.push(`acrusher=level_in=1:level_out=1:bits=16:mode=log:anti_aliasing=1,volume=${drive}dB`);
    }
    // 22. Underwater
    if (effectIntensities.underwater > 0) {
      const lp = Math.round(1200 - (effectIntensities.underwater / 100) * 900);
      filters.push(`lowpass=f=${lp},volume=1.5`);
    }
    // 23. AM Radio
    if (effectIntensities.radioAM > 0) {
      const val = effectIntensities.radioAM;
      const hp = Math.round(400 + (val / 100) * 400);
      const lp = Math.round(2500 - (val / 100) * 1000);
      filters.push(`highpass=f=${hp},lowpass=f=${lp},volume=1.3`);
    }

    // --- Yangi 27 ta professional effektlar mantiqi ---
    if (effectIntensities.vinylCrackle > 0) {
      filters.push(`highpass=f=200,lowpass=f=4500,aecho=0.8:0.7:10:0.2`);
    }
    if (effectIntensities.lofiChill > 0) {
      const lp = Math.round(3500 - (effectIntensities.lofiChill / 100) * 2000);
      filters.push(`lowpass=f=${lp},atempo=0.95`);
    }
    if (effectIntensities.tapeSaturation > 0) {
      filters.push(`volume=1.2,acrusher=level_in=1:level_out=1:bits=14:mode=lin`);
    }
    if (effectIntensities.stutterGate > 0) {
      const hz = Math.round(4 + (effectIntensities.stutterGate / 100) * 12);
      filters.push(`apulsator=hz=${hz}:mode=square:amount=1`);
    }
    if (effectIntensities.pingPongDelay > 0) {
      const delay = Math.round(150 + (effectIntensities.pingPongDelay / 100) * 350);
      filters.push(`aecho=0.8:0.7:${delay}:0.5`);
    }
    if (effectIntensities.subBassEnhancer > 0) {
      const g = Math.round((effectIntensities.subBassEnhancer / 100) * 18);
      filters.push(`equalizer=f=40:width_type=h:width=30:g=${g}`);
    }
    if (effectIntensities.airTreble > 0) {
      const g = Math.round((effectIntensities.airTreble / 100) * 15);
      filters.push(`equalizer=f=14000:width_type=h:width=2000:g=${g}`);
    }
    if (effectIntensities.bitcrusher > 0) {
      const bits = Math.max(4, Math.round(12 - (effectIntensities.bitcrusher / 100) * 8));
      filters.push(`acrusher=bits=${bits}:mode=lin`);
    }
    if (effectIntensities.reverseReverb > 0) {
      filters.push(`areverse,aecho=0.8:0.88:150:0.6,areverse`);
    }
    if (effectIntensities.robotVoice > 0) {
      filters.push(`aeval=val(0)*sin(2*PI*440*t):c=same`);
    }
    if (effectIntensities.autoWah > 0) {
      const hz = (0.5 + (effectIntensities.autoWah / 100) * 4).toFixed(1);
      filters.push(`apulsator=hz=${hz}:amount=0.8`);
    }
    if (effectIntensities.stereoTremolo > 0) {
      const hz = (2 + (effectIntensities.stereoTremolo / 100) * 8).toFixed(1);
      filters.push(`apulsator=hz=${hz}:amount=0.7`);
    }
    if (effectIntensities.dynamicCompressor > 0) {
      filters.push(`acompressor=threshold=-18dB:ratio=4:attack=20:release=250`);
    }
    if (effectIntensities.deEsser > 0) {
      filters.push(`equalizer=f=7000:width_type=h:width=3000:g=-12`);
    }
    if (effectIntensities.stadiumEcho > 0) {
      filters.push(`aecho=0.8:0.9:400|800:0.5|0.3`);
    }
    if (effectIntensities.megaBassDrive > 0) {
      filters.push(`equalizer=f=50:width_type=h:width=40:g=20,volume=1.3`);
    }
    if (effectIntensities.alienPitch > 0) {
      filters.push(`asetrate=44100*1.35,aresample=44100,aphaser=speed=0.5`);
    }
    if (effectIntensities.slowedReverb > 0) {
      filters.push(`atempo=0.85,aecho=0.8:0.88:120:0.5`);
    }
    if (effectIntensities.drill808 > 0) {
      filters.push(`equalizer=f=55:width_type=h:width=35:g=18,acrusher=bits=14:mode=log`);
    }
    if (effectIntensities.cinemaTrailer > 0) {
      filters.push(`equalizer=f=60:width_type=h:width=40:g=10,aecho=0.8:0.88:200:0.4,extrastereo=m=1.8`);
    }
    if (effectIntensities.wideSpreader > 0) {
      filters.push(`extrastereo=m=2.5`);
    }
    if (effectIntensities.tunnelReverb > 0) {
      filters.push(`highpass=f=200,aecho=0.8:0.9:250|500:0.6|0.4`);
    }
    if (effectIntensities.tapeStop > 0) {
      filters.push(`asetrate=44100*0.6,aresample=44100`);
    }
    if (effectIntensities.exciterMix > 0) {
      filters.push(`equalizer=f=3000:width_type=h:width=1000:g=6,equalizer=f=12000:width_type=h:width=3000:g=8`);
    }
    if (effectIntensities.psychedelicPan > 0) {
      filters.push(`apulsator=hz=0.8:amount=1`);
    }
    if (effectIntensities.megaphone > 0) {
      filters.push(`highpass=f=800,lowpass=f=2000,volume=1.4`);
    }
    if (effectIntensities.ambientPad > 0) {
      filters.push(`lowpass=f=2500,aecho=0.8:0.88:180:0.5`);
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
