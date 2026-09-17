# backend/scripts/test_real_bhashini.py
import sys
import os
import struct
from dotenv import load_dotenv

load_dotenv()
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.ai.bhashini_client import transcribe_audio

def generate_1sec_wav() -> bytes:
    """Generates a valid 1-second 16kHz mono 16-bit PCM WAV byte stream."""
    sample_rate = 16000
    num_samples = sample_rate * 1
    data_size = num_samples * 2
    file_size = 36 + data_size
    
    header = struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF', file_size, b'WAVE',
        b'fmt ', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16,
        b'data', data_size
    )
    return header + (b'\x00' * data_size)

def main():
    try:
        print("Testing live Bhashini ASR connection with valid audio buffer...")
        audio_bytes = generate_1sec_wav()
        result = transcribe_audio(audio_bytes, source_language="hi")
        print(f"Success! Response transcript: '{result}'")
    except Exception as e:
        print(f"Bhashini API Output/Status: {e}")

if __name__ == "__main__":
    main()