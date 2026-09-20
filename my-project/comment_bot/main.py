import os
import time
from google import genai
from googleapiclient.discovery import build

# API Kalitlarni olish
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Gemini AI va YouTube client sozlamalari
client = genai.Client(api_key=GEMINI_API_KEY)
youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)

# Qidiruv uchun kalit so'zlar
SEARCH_KEYWORDS = ["pencil drawing", "3d art tutorial", "how to draw", "easy doodle art"]

def generate_reply(video_title):
    prompt = f"YouTube'dagi '{video_title}' nomli videoga xushmuomala, iliq va qisqa izoh (comment) yozing. Insho bo'lmasin, tabiiy va do'stona ko'rinsin."
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
    )
    return response.text

def search_and_comment():
    print("\n--- Yangi videolar qidirilmoqda... ---")
    
    for query in SEARCH_KEYWORDS:
        search_response = youtube.search().list(
            q=query,
            part="snippet",
            type="video",
            order="date",
            maxResults=2
        ).execute()

        for item in search_response.get("items", []):
            video_id = item["id"]["videoId"]
            video_title = item["snippet"]["title"]
            channel_name = item["snippet"]["channelTitle"]

            print("--------------------------------------------------")
            print(f"🔍 Qidiruv so'zi: {query}")
            print(f"📹 Topilgan video: {video_title}")
            print(f"📺 Kanal: {channel_name}")
            print(f"🔗 Video ID: {video_id}")

            # Gemini AI orqali izoh yaratish
            comment_text = generate_reply(video_title)
            print(f"🤖 Bot yaratgan izoh: {comment_text}")
            print("--------------------------------------------------")

if __name__ == "__main__":
    print("YouTube Comment Bot (Auto-Search) ishga tushdi...")
    while True:
        try:
            search_and_comment()
        except Exception as e:
            print(f"Xatolik yuz berdi: {e}")
        time.sleep(600)  # Har 10 daqiqada yangi videolar qidiradi
