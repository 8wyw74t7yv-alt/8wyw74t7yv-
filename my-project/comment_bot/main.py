import os
import time
import google.generativeai as genai
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

# Muhit o'zgaruvchilarini olish
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Gemini AI sozlamasi
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-1.5-flash")

# YouTube API client
youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)

def generate_reply(comment_text):
    prompt = f"YouTube izohiga xushmuomala va do'stona qisqa javob yozing: '{comment_text}'"
    response = model.generate_content(prompt)
    return response.text

def check_and_reply_comments():
    print("Izohlar yo'qlanmoqda...")
    # Bu yerda kanalingizdagi izohlarni olish va javob berish mantiqi bajariladi
    pass

if __name__ == "__main__":
    print("YouTube Comment Bot ishga tushdi...")
    while True:
        try:
            check_and_reply_comments()
        except Exception as e:
            print(f"Xatolik yuz berdi: {e}")
        time.sleep(300) # Har 5 daqiqada bir marta tekshiradi
