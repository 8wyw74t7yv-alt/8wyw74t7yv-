import os
import time
import json
import random
from datetime import datetime
from ai_service import AIService
from youtube_service import YouTubeService

# Sozlamalar va limitlar
MIN_DELAY_SECONDS = 5400   # Minimim kutish: 1.5 soat (5400 sek)
MAX_DELAY_SECONDS = 14400  # Maksimum kutish: 4 soat (14400 sek)
NIGHT_START_HOUR = 23      # Tungi rejim boshlanishi (23:00)
NIGHT_END_HOUR = 7         # Tungi rejim tugashi (07:00)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HISTORY_FILE = os.path.join(BASE_DIR, "commented_videos.json")

def load_history():
    """Ilgari izoh yozilgan video ID larini va kunlik statistikani yuklaydi."""
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                pass
    return {"commented_ids": [], "daily_count": 0, "last_date": ""}

def save_history(data):
    """Izohlar tarixini saqlaydi."""
    with open(HISTORY_FILE, "w") as f:
        json.dump(data, f, indent=4)

def is_night_time():
    """Toshkent vaqti bo'yicha tungi rejimni tekshiradi (23:00 - 07:00)."""
    current_hour = datetime.now().hour
    if NIGHT_START_HOUR <= current_hour or current_hour < NIGHT_END_HOUR:
        return True
    return False

def reset_daily_counter_if_new_day(history):
    """Yangi kun boshlanganda kunlik hisoblagichni yangilaydi."""
    today = datetime.now().strftime("%Y-%m-%d")
    if history.get("last_date") != today:
        history["last_date"] = today
        history["daily_count"] = 0
        # Yangi kun uchun tasodifiy limit (5 va 8 orasida)
        history["daily_limit"] = random.randint(5, 8)
        save_history(history)
    return history

def run_bot():
    print("=== YouTube Auto-Comment Bot Ishga Tushdi ===")
    
    # Servislarni rejimda chaqiramiz
    ai = AIService()
    youtube = YouTubeService()

    while True:
        try:
            history = load_history()
            history = reset_daily_counter_if_new_day(history)
            
            daily_limit = history.get("daily_limit", random.randint(5, 8))

            # 1. Tungi rejim tekshiruvi
            if is_night_time():
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Tungi rejim (23:00 - 07:00). Bot uxlash holatida.")
                time.sleep(1800) # 30 daqiqa kutib qayta tekshiradi
                continue

            # 2. Kunlik limit tekshiruvi
            if history["daily_count"] >= daily_limit:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Bugungi limit ({daily_limit} ta izoh) bajarildi. Ertagacha tanaffus.")
                time.sleep(3600) # 1 soat kutib qayta tekshiradi
                continue

            # 3. Videolarni qidirish
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Yangi va trenddagi musiqiy video/Shortslar qidirilmoqda...")
            videos = youtube.get_recent_popular_videos(max_results=15)
            
            target_video = None
            for video in videos:
                if video['id'] not in history["commented_ids"]:
                    target_video = video
                    break

            if not target_video:
                print("Yangi izoh yazilmagan video topilmadi. 30 daqiqadan so'ng qayta urinib ko'riladi.")
                time.sleep(1800)
                continue

            # 4. AI orqali izoh generatsiya qilish
            print(f"Tanlangan video: '{target_video['title']}' (ID: {target_video['id']})")
            comment_text = ai.generate_comment(
                video_title=target_video['title'],
                video_description=target_video['description']
            )
            print(f"Generatsiya qilingan izoh: \"{comment_text}\"")

            # 5. Izohni YouTube'ga joylash
            success = youtube.leave_comment(
                video_id=target_video['id'],
                comment_text=comment_text
            )

            if success:
                history["commented_ids"].append(target_video['id'])
                history["daily_count"] += 1
                save_history(history)
                
                print(f"Bugun yozilgan izohlar soni: {history['daily_count']}/{daily_limit}")

                # 6. Tasodifiy kutish (Random Delay)
                delay = random.randint(MIN_DELAY_SECONDS, MAX_DELAY_SECONDS)
                hours = round(delay / 3600, 2)
                print(f"Keyingi izohgacha {hours} soat ({delay} sekund) tasodifiy tanaffus kutilmoqda...\n")
                time.sleep(delay)
            else:
                print("Izoh joylab bo'lmadi. 15 daqiqadan so'ng qayta urunish bo'ladi.")
                time.sleep(900)

        except Exception as e:
            print(f"Bot ishida kutilmagan xatolik: {e}")
            time.sleep(1800)

if __name__ == "__main__":
    run_bot()
