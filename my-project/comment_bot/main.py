import os
import time
import json
from google import genai
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# Environment'dan kalitlar va OAuth ma'lumotlarini olish
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
CLIENT_SECRET_JSON = os.environ.get("CLIENT_SECRET_JSON")
REFRESH_TOKEN = os.environ.get("REFRESH_TOKEN")  # Fly secrets'dagi refresh token

client = genai.Client(api_key=GEMINI_API_KEY)

def get_authenticated_youtube_service():
    """OAuth 2.0 orqali YouTube API xizmatini yaratish"""
    secret_data = json.loads(CLIENT_SECRET_JSON)
    
    # client_secret.json ichidagi web yoki installed kalitini olish
    client_config = secret_data.get("installed") or secret_data.get("web")
    
    creds = Credentials(
        token=None,
        refresh_token=REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_config["client_id"],
        client_secret=client_config["client_secret"],
        scopes=["https://www.googleapis.com/auth/youtube.force-ssl"]
    )
    
    return build("youtube", "v3", credentials=creds)

youtube = get_authenticated_youtube_service()

SEARCH_KEYWORDS = ["pencil drawing tutorial", "how to draw 3d", "easy doodle art"]

def generate_reply(video_title):
    prompt = f"YouTube'dagi '{video_title}' nomli videoga xushmuomala va do'stona qisqa izoh yozing. Tabiiy ko'rinsin, insho bo'lmasin."
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
    )
    return response.text

def post_comment(video_id, comment_text):
    """Videoga haqiqiy izoh joylash"""
    body = {
        "snippet": {
            "videoId": video_id,
            "topLevelComment": {
                "snippet": {
                    "textOriginal": comment_text
                }
            }
        }
    }
    response = youtube.commentThreads().insert(
        part="snippet",
        body=body
    ).execute()
    return response

def search_and_comment():
    print("\n--- Yangi videolar qidirilmoqda va izoh yozilmoqda... ---")
    
    for query in SEARCH_KEYWORDS:
        search_response = youtube.search().list(
            q=query,
            part="snippet",
            type="video",
            order="date",
            maxResults=1
        ).execute()

        for item in search_response.get("items", []):
            video_id = item["id"]["videoId"]
            video_title = item["snippet"]["title"]
            channel_name = item["snippet"]["channelTitle"]

            print("--------------------------------------------------")
            print(f"🔍 Qidiruv: {query}")
            print(f"📹 Video: {video_title}")
            print(f"📺 Kanal: {channel_name}")

            # AI orqali izoh matnini yaratish
            comment_text = generate_reply(video_title)
            print(f"🤖 Yozilayotgan izoh: {comment_text}")

            # YouTube'ga izohni chop etish
            try:
                post_comment(video_id, comment_text)
                print("✅ Izoh muvaffaqiyatli chop etildi!")
            except Exception as comment_err:
                print(f"❌ Izoh joylashda xatolik: {comment_err}")
                
            print("--------------------------------------------------")

if __name__ == "__main__":
    print("YouTube Auto-Comment Bot (OAuth2) ishga tushdi...")
    while True:
        try:
            search_and_comment()
        except Exception as e:
            print(f"Xatolik yuz berdi: {e}")
        time.sleep(900)  # Har 15 daqiqada bir marta ishlaydi
