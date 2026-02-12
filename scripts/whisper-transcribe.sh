#!/usr/bin/env bash
set -euo pipefail

# Wrapper for whisper.cpp CLI that prints plain transcript to stdout.
# Usage: whisper-transcribe.sh /path/to/audio

AUDIO_PATH=${1:-}
if [[ -z "$AUDIO_PATH" || ! -f "$AUDIO_PATH" ]]; then
  echo "Missing audio file path" >&2
  exit 2
fi

WHISPER_CLI=${WHISPER_CLI:-/opt/homebrew/bin/whisper-cli}
MODEL_PATH=${WHISPER_CPP_MODEL:-$HOME/.clawdbot/models/whisper/ggml-small.bin}
LANG=${WHISPER_LANG:-auto}

if [[ ! -x "$WHISPER_CLI" ]]; then
  echo "whisper-cli not found at $WHISPER_CLI" >&2
  exit 3
fi
if [[ ! -f "$MODEL_PATH" ]]; then
  echo "Whisper model not found at $MODEL_PATH" >&2
  exit 4
fi

OUTDIR=$(mktemp -d)
trap 'rm -rf "$OUTDIR"' EXIT
OUTBASE="$OUTDIR/out"

INPUT_PATH="$AUDIO_PATH"

# whisper-cli supports flac, mp3, ogg, wav. iMessage voice notes are often .caf.
# Convert unsupported formats to wav via macOS afconvert.
case "${AUDIO_PATH##*.}" in
  wav|WAV|mp3|MP3|flac|FLAC|ogg|OGG) ;;
  *)
    if command -v /usr/bin/afconvert >/dev/null 2>&1; then
      INPUT_PATH="$OUTDIR/input.wav"
      # Convert to 16kHz mono PCM wav (good default for speech)
      /usr/bin/afconvert -f WAVE -d LEI16@16000 -c 1 "$AUDIO_PATH" "$INPUT_PATH" >/dev/null 2>&1 || {
        echo "Audio conversion failed" >&2
        exit 6
      }
    else
      echo "Unsupported audio format and afconvert not found" >&2
      exit 6
    fi
    ;;
esac

# -np: no progress
# -nt: no timestamps
# -otxt + -of: write transcript to OUTBASE.txt
"$WHISPER_CLI" \
  -m "$MODEL_PATH" \
  -l "$LANG" \
  -np -nt \
  -otxt -of "$OUTBASE" \
  "$INPUT_PATH" \
  >/dev/null 2>&1

if [[ ! -f "${OUTBASE}.txt" ]]; then
  echo "Transcription failed (no output)" >&2
  exit 5
fi

# Print transcript (strip BOM/CR)
LC_ALL=C sed 's/\r$//; 1s/^\xEF\xBB\xBF//' "${OUTBASE}.txt"
