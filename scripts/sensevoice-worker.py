"""Bounded, offline SenseVoice worker. WAV input is read from stdin."""
import array
import io
import json
import pathlib
import re
import sys
import wave


def transcribe(folder, language):
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError()
    with wave.open(io.BytesIO(raw), 'rb') as audio:
        rate = audio.getframerate()
        frames = audio.getnframes()
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or rate != 16000 or not 0 < frames <= rate * 60:
            raise ValueError()
        pcm = array.array('h', audio.readframes(frames))
    if len(pcm) != frames:
        raise ValueError()
    sys.path.insert(0, str(folder / 'site'))
    import sherpa_onnx
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(folder / 'model.int8.onnx'), tokens=str(folder / 'tokens.txt'),
        language=language, use_itn=True, provider='cpu', num_threads=2,
    )
    stream = recognizer.create_stream()
    stream.accept_waveform(rate, [sample / 32768 for sample in pcm])
    recognizer.decode_stream(stream)
    return re.sub(r'<\|[^|]{1,40}\|>', '', stream.result.text).strip()[:4000]


if __name__ == '__main__':
    try:
        if sys.argv[2] not in ('auto', 'zh', 'en', 'yue', 'ja', 'ko'):
            raise ValueError()
        text = transcribe(pathlib.Path(sys.argv[1]), sys.argv[2])
        print(json.dumps({'text': text}))
    except Exception:
        print('{"error":"VOICE_SENSEVOICE_FAILED"}')
        sys.exit(1)
