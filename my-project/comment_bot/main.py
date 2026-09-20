import os
import time
from google import genai
from googleapiclient.discovery import build

# API Kalit va Mijozni sozlash
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY)

def generate_reply(comment_text):
    prompt = f"YouTube izohiga xushmuomala va do'stona qisqa javob yozing: '{comment_text}'"
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
    )
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
